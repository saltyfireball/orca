// Branch clashes (FORK.md, SLRM-2394): files that more than one unmerged worktree branch of a
// project changes, across this machine and its paired servers, and branches far behind the default
// branch. Each host reports its own branches; this file folds the reports into the warning list.
// Pure: the git reads are in src/main/fork/branch-clashes/, the chip in the renderer.

/** Commits behind before a branch counts as stale. Same value as the orchestrator's stale-base flag. */
export const FORK_CLASHES_DEFAULT_BEHIND = 20
export const FORK_CLASHES_DEFAULT_INTERVAL_MINUTES = 5
export const FORK_CLASHES_MIN_INTERVAL_MINUTES = 1
export const FORK_CLASHES_MAX_INTERVAL_MINUTES = 240
export const FORK_CLASHES_MAX_BEHIND = 100_000
/** Bounds that keep a report small however large a branch is; cut lists are marked. */
export const FORK_CLASHES_MAX_FILES_PER_BRANCH = 1000
export const FORK_CLASHES_MAX_FILES_PER_PROJECT = 200
export const FORK_CLASHES_MAX_BRANCHES_PER_FILE = 20

export type ForkBranchClashSettings = {
  /** Fork branch clashes (SLRM-2394): warn when parallel worktree branches change the same files; unset is on. */
  forkBranchClashes?: boolean
  /** Fork branch clashes: minutes between checks; unset is 5. */
  forkBranchClashesIntervalMinutes?: number
  /** Fork branch clashes: count uncommitted changes in each worktree too; unset is on. */
  forkBranchClashesUncommitted?: boolean
  /** Fork branch clashes: commits behind the default branch before a branch is flagged; unset is 20. */
  forkBranchClashesBehindThreshold?: number
  /** Fork branch clashes: ask paired servers for their branches too; unset is on. */
  forkBranchClashesPairedServers?: boolean
}

export type ForkBranchClashConfig = {
  enabled: boolean
  intervalMinutes: number
  uncommitted: boolean
  behindThreshold: number
  pairedServers: boolean
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export function readForkBranchClashConfig(settings: unknown): ForkBranchClashConfig {
  const s = (typeof settings === 'object' && settings !== null ? settings : {}) as Record<
    keyof ForkBranchClashSettings,
    unknown
  >
  return {
    enabled: s.forkBranchClashes !== false,
    intervalMinutes: wholeNumber(
      s.forkBranchClashesIntervalMinutes,
      FORK_CLASHES_DEFAULT_INTERVAL_MINUTES,
      FORK_CLASHES_MIN_INTERVAL_MINUTES,
      FORK_CLASHES_MAX_INTERVAL_MINUTES
    ),
    uncommitted: s.forkBranchClashesUncommitted !== false,
    behindThreshold: wholeNumber(
      s.forkBranchClashesBehindThreshold,
      FORK_CLASHES_DEFAULT_BEHIND,
      1,
      FORK_CLASHES_MAX_BEHIND
    ),
    pairedServers: s.forkBranchClashesPairedServers !== false
  }
}

/** One worktree branch with work not on the default branch, as its own host sees it. */
export type ForkClashBranch = {
  worktreeId: string
  path: string
  /** Short branch name; empty for a detached HEAD. */
  branch: string
  head: string
  ahead: number | null
  behind: number | null
  /** Changed files, committed and (when on) uncommitted, relative to the repository root. */
  files: string[]
  filesTruncated: boolean
}

export type ForkClashRepo = {
  repoId: string
  name: string
  /** `host/owner/repo` of the first remote, so one project matches across hosts; null without one. */
  projectKey: string | null
  baseRef: string | null
  branches: ForkClashBranch[]
  /** Why the repo or some of its branches could not be read. */
  incomplete?: string
}

/** What `fork.clashes.local` answers. */
export type ForkClashHostReport = { off?: boolean; repos: ForkClashRepo[] }

export type ForkClashHostStatus = 'ok' | 'off' | 'unreachable' | 'no-clashes'

export type ForkClashHostResult = {
  hostId: string
  hostName: string
  status: ForkClashHostStatus
  repos: ForkClashRepo[]
}

export type ForkClashParticipant = {
  hostId: string
  hostName: string
  worktreeId: string
  path: string
  branch: string
}

export type ForkClashFile = {
  file: string
  participants: ForkClashParticipant[]
  participantsTruncated: boolean
}

export type ForkClashBehind = ForkClashParticipant & { behind: number; stale: boolean }

export type ForkClashProject = {
  projectKey: string
  name: string
  files: ForkClashFile[]
  filesTruncated: boolean
  behind: ForkClashBehind[]
  incomplete: string[]
}

export type ForkClashResult = {
  scannedAt: number
  behindThreshold: number
  projects: ForkClashProject[]
  hosts: { hostId: string; hostName: string; status: ForkClashHostStatus }[]
}

/** `git@github.com:o/r.git`, `https://github.com/o/r` and `ssh://git@github.com:22/o/r` all match. */
export function normalizeForkRemoteUrl(url: string): string | null {
  const text = url.trim()
  let host: string
  let path: string
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(text)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const parsed = new URL(text)
      if (!parsed.hostname) {
        return null
      }
      host = parsed.hostname
      path = parsed.pathname
    } catch {
      return null
    }
  }
  const cleanPath = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  return cleanPath ? `${host}/${cleanPath}`.toLowerCase() : null
}

export function forkClashRowKey(hostId: string, path: string): string {
  return `${hostId}\u0000${path}`
}

function branchLabel(branch: ForkClashBranch): string {
  return branch.branch || `(detached ${branch.head.slice(0, 8)})`
}

type Group = {
  key: string
  name: string
  entries: { host: ForkClashHostResult; repo: ForkClashRepo }[]
}

function groupProjects(hosts: readonly ForkClashHostResult[]): Group[] {
  const groups = new Map<string, Group>()
  for (const host of hosts) {
    for (const repo of host.repos) {
      const key = repo.projectKey ?? `${host.hostId}\u0000${repo.repoId}`
      const group = groups.get(key) ?? { key, name: repo.name, entries: [] }
      group.entries.push({ host, repo })
      groups.set(key, group)
    }
  }
  return [...groups.values()]
}

function foldProject(group: Group, behindThreshold: number): ForkClashProject {
  const byFile = new Map<string, ForkClashParticipant[]>()
  const behind: ForkClashBehind[] = []
  const incomplete: string[] = []
  for (const { host, repo } of group.entries) {
    if (repo.incomplete) {
      incomplete.push(`${host.hostName}: ${repo.incomplete}`)
    }
    for (const branch of repo.branches) {
      const who: ForkClashParticipant = {
        hostId: host.hostId,
        hostName: host.hostName,
        worktreeId: branch.worktreeId,
        path: branch.path,
        branch: branchLabel(branch)
      }
      if (branch.filesTruncated) {
        incomplete.push(`${host.hostName}: ${who.branch} changes more files than are compared`)
      }
      for (const file of new Set(branch.files)) {
        const list = byFile.get(file) ?? []
        list.push(who)
        byFile.set(file, list)
      }
      if (branch.behind !== null && branch.behind > 0) {
        behind.push({ ...who, behind: branch.behind, stale: branch.behind >= behindThreshold })
      }
    }
  }
  const shared = [...byFile.entries()]
    .filter(([, participants]) => participants.length > 1)
    .sort(([a, pa], [b, pb]) => pb.length - pa.length || a.localeCompare(b))
  return {
    projectKey: group.key,
    name: group.name,
    files: shared.slice(0, FORK_CLASHES_MAX_FILES_PER_PROJECT).map(([file, participants]) => ({
      file,
      participants: participants.slice(0, FORK_CLASHES_MAX_BRANCHES_PER_FILE),
      participantsTruncated: participants.length > FORK_CLASHES_MAX_BRANCHES_PER_FILE
    })),
    filesTruncated: shared.length > FORK_CLASHES_MAX_FILES_PER_PROJECT,
    behind: behind.sort((a, b) => b.behind - a.behind),
    incomplete
  }
}

/** Folds every host's report into per-project clashes; projects with nothing to say are left out. */
export function buildForkClashes(
  hosts: readonly ForkClashHostResult[],
  behindThreshold: number,
  now: number
): ForkClashResult {
  const projects = groupProjects(hosts)
    .map((group) => foldProject(group, behindThreshold))
    .filter((p) => p.files.length > 0 || p.behind.some((b) => b.stale) || p.incomplete.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    scannedAt: now,
    behindThreshold,
    projects,
    hosts: hosts.map(({ hostId, hostName, status }) => ({ hostId, hostName, status }))
  }
}

/** What one workspace row shows: its shared files with the branches they clash with, and staleness. */
export type ForkClashRowMark = {
  files: { file: string; others: string[] }[]
  behind: number | null
  stale: boolean
}

export function forkClashRowMarks(result: ForkClashResult | null): Map<string, ForkClashRowMark> {
  const marks = new Map<string, ForkClashRowMark>()
  const mark = (who: ForkClashParticipant): ForkClashRowMark => {
    const key = forkClashRowKey(who.hostId, who.path)
    const found = marks.get(key) ?? { files: [], behind: null, stale: false }
    marks.set(key, found)
    return found
  }
  for (const project of result?.projects ?? []) {
    for (const entry of project.files) {
      for (const who of entry.participants) {
        const others = entry.participants
          .filter((other) => other !== who)
          .map((other) =>
            other.hostId === who.hostId ? other.branch : `${other.branch} @ ${other.hostName}`
          )
        mark(who).files.push({ file: entry.file, others })
      }
    }
    for (const entry of project.behind) {
      if (entry.stale) {
        const found = mark(entry)
        found.behind = entry.behind
        found.stale = true
      }
    }
  }
  return marks
}

/** Keeps the projects a `--project` filter names: display name, repo id or remote key. */
export function forkClashRepoMatches(
  repo: Pick<ForkClashRepo, 'repoId' | 'name' | 'projectKey'>,
  wanted: string
): boolean {
  const w = wanted.trim().toLowerCase()
  return (
    repo.repoId === wanted ||
    repo.name.toLowerCase() === w ||
    (repo.projectKey !== null && (repo.projectKey === w || repo.projectKey.endsWith(`/${w}`)))
  )
}
