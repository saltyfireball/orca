// Digest (SLRM-2388, FORK.md): the whole digest. This host reads its own part and asks every
// paired server for its own (fork.digest.local) at once, the way auto placement probes them
// (SLRM-2266). A server that does not answer, or runs a build without the digest, is listed as such.
import { mapWithConcurrency } from '../../../shared/concurrency/map-with-concurrency'
import {
  FORK_DIGEST_LOCAL_METHOD,
  FORK_DIGEST_SERVER_TIMEOUT_MS,
  totalForkDigest,
  type ForkDigest,
  type ForkDigestHost,
  type ForkDigestLocalParams,
  type ForkDigestSection
} from '../../../shared/fork/digest'
import { parseForkDigestSection } from '../../../shared/fork/digest-schema'

const SERVER_CONCURRENCY = 4
export const FORK_DIGEST_LOCAL_NAME = 'This machine'

export type ForkDigestCollectDeps = {
  now: () => number
  local: (params: ForkDigestLocalParams) => Promise<ForkDigestSection>
  listEnvironments: () =>
    | readonly { id: string; name: string }[]
    | Promise<readonly { id: string; name: string }[]>
  callEnvironment: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  /** Paired servers this host's server health sees as not answering. */
  serversDown: () => { name: string; downSince: number }[]
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined
  }
  return undefined
}

async function serverPart(
  deps: ForkDigestCollectDeps,
  environment: { id: string; name: string },
  params: ForkDigestLocalParams
): Promise<ForkDigestHost> {
  const base = { hostKey: `runtime:${environment.id}`, name: environment.name }
  try {
    const answer = await deps.callEnvironment(
      environment.id,
      FORK_DIGEST_LOCAL_METHOD,
      params,
      FORK_DIGEST_SERVER_TIMEOUT_MS
    )
    const section = parseForkDigestSection(answer)
    return section
      ? { ...base, status: 'ok', section }
      : { ...base, status: 'unreachable', section: null }
  } catch (error) {
    const status = errorCode(error) === 'method_not_found' ? 'no-digest' : 'unreachable'
    return { ...base, status, section: null }
  }
}

/** Drops a pull request a host earlier in the list already showed (one repository, two clones). */
function dedupePullRequests(hosts: ForkDigestHost[]): void {
  const seen = new Set<string>()
  for (const host of hosts) {
    if (host.section) {
      host.section.pullRequests = host.section.pullRequests.filter((pr) => {
        const fresh = !seen.has(pr.url)
        seen.add(pr.url)
        return fresh
      })
    }
  }
}

export async function collectForkDigest(
  deps: ForkDigestCollectDeps,
  params: ForkDigestLocalParams
): Promise<ForkDigest> {
  const environments = await Promise.resolve(deps.listEnvironments()).catch(() => [])
  const [local, servers] = await Promise.all([
    deps.local(params).then(
      (section): ForkDigestHost => ({
        hostKey: 'local',
        name: FORK_DIGEST_LOCAL_NAME,
        status: 'ok',
        section
      }),
      (): ForkDigestHost => ({
        hostKey: 'local',
        name: FORK_DIGEST_LOCAL_NAME,
        status: 'unreachable',
        section: null
      })
    ),
    mapWithConcurrency(environments, SERVER_CONCURRENCY, (environment) =>
      serverPart(deps, environment, params)
    )
  ])
  const hosts = [local, ...servers]
  dedupePullRequests(hosts)
  let serversDown: ForkDigest['serversDown'] = []
  try {
    serversDown = deps.serversDown()
  } catch {
    // Server health is optional; the digest goes on without it.
  }
  return {
    since: params.since,
    until: deps.now(),
    hosts,
    serversDown,
    totals: totalForkDigest(hosts)
  }
}
