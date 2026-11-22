// Card routing (BAD-737, FORK.md): `fork.cardRoute.claims`, each bot's repos on this host, so a card
// nothing labels or maps goes to the bot whose repo it names. A bot claims the projects it loads
// skills from and the repos its SOUL.md names; a card's file paths are looked for in those repos.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type * as z from 'zod'
import type { Bot } from '../../../shared/bot-types'
import type { Repo } from '../../../shared/repository/repo-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../shared/execution-host/execution-host'
import type {
  CardBotClaims,
  ForkCardRouteClaimsParams,
  ForkCardRouteClaimsResult
} from '../../../shared/fork/card-routing'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { botHomeFolder, localBotHomeFilesystem } from '../../bots/bot-home'

type ClaimRepo = Pick<Repo, 'id' | 'displayName' | 'path'>

export type CardClaimsDeps = {
  bots: () => readonly Pick<Bot, 'name' | 'paused' | 'skillProjects' | 'folder'>[]
  repos: () => readonly ClaimRepo[]
  soul: (bot: Pick<Bot, 'folder'>) => Promise<string | null>
  exists: (path: string) => boolean
}

const MIN_NAME = 3

function repoNames(repo: ClaimRepo): string[] {
  const base = repo.path.split(/[\\/]/).findLast(Boolean) ?? ''
  return [...new Set([repo.displayName.trim(), base].filter((name) => name.length >= MIN_NAME))]
}

function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'iu').test(text)
}

/** Relative and inside the repo: a card's text never makes this look outside it. */
function safeRelative(path: string): string | null {
  const parts = path.split('/')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) {
    return null
  }
  return parts.every((part) => part && part !== '.' && part !== '..') ? parts.join('/') : null
}

export async function cardRouteClaims(
  deps: CardClaimsDeps,
  params: z.infer<typeof ForkCardRouteClaimsParams>
): Promise<ForkCardRouteClaimsResult> {
  const repos = deps.repos()
  const paths = (params.paths ?? []).flatMap((path) => {
    const safe = safeRelative(path)
    return safe ? [safe] : []
  })
  const bots = deps.bots().filter((bot) => !bot.paused)
  const claims = await Promise.all(
    bots.map(async (bot): Promise<CardBotClaims> => {
      const soul = (await deps.soul(bot).catch(() => null)) ?? ''
      const owned = repos.filter(
        (repo) =>
          bot.skillProjects?.includes(repo.id) ||
          (soul && repoNames(repo).some((name) => mentions(soul, name)))
      )
      const names = [...new Set(owned.flatMap(repoNames))]
      const pathRepos = owned
        .filter((repo) => paths.some((path) => deps.exists(join(repo.path, ...path.split('/')))))
        .map((repo) => repoNames(repo)[0] ?? repo.displayName)
      return { name: bot.name, repos: names, pathRepos }
    })
  )
  return { bots: claims }
}

export function runtimeCardRouteClaims(runtime: OrcaRuntimeService) {
  const filesystem = localBotHomeFilesystem
  return (params: z.infer<typeof ForkCardRouteClaimsParams>) =>
    cardRouteClaims(
      {
        bots: () => (runtime.bots.enabled() ? runtime.bots.list() : []),
        repos: () =>
          runtime
            .listRepos()
            .filter((repo) => getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID),
        soul: (bot) => filesystem.readText(join(botHomeFolder(bot), 'SOUL.md')),
        exists: existsSync
      },
      params
    )
}
