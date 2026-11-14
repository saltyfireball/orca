// SLRM-2175: what the lost work scan reads once per repository instead of once per branch. One
// `for-each-ref` says which branches are already on the base, and one `rev-list` holds every commit
// that is on no remote, so a repository with hundreds of merged branches costs two git processes
// where it used to cost several per branch. Read-only, like the rest of the scan.
import { isSafeRefName } from '../../../shared/fork/lost-work'
import { LOST_WORK_OID, tryGit, type LostWorkGit, type LostWorkLocalBranch } from './lost-work-git'

export type LostWorkBranchFact = LostWorkLocalBranch & {
  /** Commits the branch has that the base lacks; null when git could not say in one call. */
  ahead: number | null
  /** True when the branch's remote upstream is at the same commit, so nothing is unpushed. */
  upstreamInSync: boolean
}

export type LostWorkBranchFacts = {
  branches: LostWorkBranchFact[]
  /** By commit, so a worktree's HEAD finds its facts; branches on one commit are merged. */
  byHead: Map<string, LostWorkBranchFact>
}

const FIELDS = [
  '%(refname:short)',
  '%(objectname)',
  '%(committerdate:unix)',
  '%(upstream)',
  '%(upstream:track)'
]

function parseBranches(out: string, hasAhead: boolean): LostWorkBranchFact[] {
  const width = FIELDS.length + (hasAhead ? 1 : 0)
  const branches: LostWorkBranchFact[] = []
  for (const line of out.split('\n')) {
    const parts = line.split('\0')
    if (parts.length !== width || !parts[0] || !isSafeRefName(parts[0])) {
      continue
    }
    const [name, head, date, upstream, track] = parts
    const seconds = Number.parseInt(date, 10)
    // `%(ahead-behind:X)` prints "<ahead> <behind>".
    const ahead = hasAhead ? Number.parseInt(parts[FIELDS.length].split(' ')[0], 10) : Number.NaN
    branches.push({
      name,
      head,
      committedAt: Number.isFinite(seconds) ? seconds * 1000 : null,
      ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : null,
      // An empty track with a remote upstream means the same commit; "[gone]" and counts do not.
      upstreamInSync: upstream.startsWith('refs/remotes/') && track === ''
    })
  }
  return branches
}

function index(branches: LostWorkBranchFact[]): LostWorkBranchFacts {
  const byHead = new Map<string, LostWorkBranchFact>()
  for (const branch of branches) {
    const seen = byHead.get(branch.head)
    byHead.set(
      branch.head,
      seen ? { ...seen, upstreamInSync: seen.upstreamInSync || branch.upstreamInSync } : branch
    )
  }
  return { branches, byHead }
}

/**
 * Every local branch with how far it is ahead of `baseOid`, in one git call. Git older than 2.41
 * has no `ahead-behind`: there `--merged` names the branches with nothing ahead and the rest stay
 * unknown, so the scan asks about each of those the slow way. Without a base nothing is compared.
 */
export async function readBranchFacts(
  git: LostWorkGit,
  cwd: string,
  baseOid: string | undefined,
  signal?: AbortSignal
): Promise<LostWorkBranchFacts> {
  const format = (fields: string[]) => `--format=${fields.join('%00')}`
  if (baseOid && LOST_WORK_OID.test(baseOid)) {
    const fast = await tryGit(
      git,
      ['for-each-ref', format([...FIELDS, `%(ahead-behind:${baseOid})`]), 'refs/heads'],
      { cwd, signal }
    )
    if (fast !== null) {
      return index(parseBranches(fast, true))
    }
  }
  const branches = parseBranches(
    await git(['for-each-ref', format(FIELDS), 'refs/heads'], { cwd, signal }),
    false
  )
  if (baseOid && LOST_WORK_OID.test(baseOid)) {
    const merged = await tryGit(
      git,
      ['for-each-ref', `--merged=${baseOid}`, '--format=%(refname:short)', 'refs/heads'],
      { cwd, signal }
    )
    if (merged !== null) {
      const names = new Set(merged.split('\n').filter(Boolean))
      for (const branch of branches) {
        if (names.has(branch.name)) {
          branch.ahead = 0
        }
      }
    }
  }
  return index(branches)
}

/** Commit -> parents, for every commit that is on a branch or tip but on no remote or base. */
export type LostWorkUnpushedGraph = Map<string, string[]>

// Past these sizes the per-tip `rev-list --count` is the cheaper question.
const MAX_GRAPH_COMMITS = 20_000
const MAX_EXTRA_TIPS = 200

/**
 * One `rev-list` for the commits no remote has, over every local branch plus `extraTips` (detached
 * worktree HEADs). Null when git fails or the answer is too large; the scan then counts per tip.
 */
export async function readUnpushedGraph(
  git: LostWorkGit,
  cwd: string,
  base: string | null,
  extraTips: readonly string[],
  signal?: AbortSignal
): Promise<LostWorkUnpushedGraph | null> {
  const tips = [...new Set(extraTips)]
  if (tips.length > MAX_EXTRA_TIPS || tips.some((tip) => !LOST_WORK_OID.test(tip))) {
    return null
  }
  const out = await tryGit(
    git,
    ['rev-list', '--parents', ...tips, '--branches', '--not', ...(base ? [base] : []), '--remotes'],
    { cwd, signal }
  )
  if (out === null) {
    return null
  }
  const graph: LostWorkUnpushedGraph = new Map()
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const [commit, ...parents] = line.split(' ')
    graph.set(commit, parents)
    if (graph.size > MAX_GRAPH_COMMITS) {
      return null
    }
  }
  return graph
}

/**
 * Commits reachable from `tip` inside the graph: the same number `rev-list --count tip --not base
 * --remotes` prints, since a commit outside the graph is on a remote and so are its ancestors.
 */
export function countUnpushedInGraph(graph: LostWorkUnpushedGraph, tip: string): number {
  const seen = new Set<string>()
  const stack = [tip]
  while (stack.length > 0) {
    const commit = stack.pop() as string
    const parents = graph.get(commit)
    if (parents === undefined || seen.has(commit)) {
      continue
    }
    seen.add(commit)
    stack.push(...parents)
  }
  return seen.size
}
