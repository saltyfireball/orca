// Command guards (FORK.md, BAD-892): the facts behind "a bot may remove its own finished workspace",
// read from Orca's own state (the same rows `orca worktree ps` shows, the bot chat index) and from
// git in the workspace itself, never from the command text beyond the selector it names. Fails
// closed: a fact that cannot be read refuses the removal. Keep electron out of this file.
import { execFile } from 'node:child_process'
import { relative, isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { OwnWorktreeRemovalRequest } from '../../../shared/fork/command-guards-rules'
import {
  decideOwnWorktreeRemoval,
  OWN_WORKTREE_REMOVAL_TIMED_OUT,
  type OwnWorktreeRemovalDecision,
  type OwnWorktreeRemovalFacts
} from '../../../shared/fork/command-guards-own-removal'
import { readCommandGuardGit } from './command-guards-git-state'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
/** The hook script gives up after 8 s; a check not done by then refuses. */
const DEADLINE_MS = 6_000

/** The part of a `worktree ps` row this reads. */
export type OwnRemovalPsRow = { worktreeId: string; bot?: string; agents: readonly unknown[] }

export type OwnRemovalHost = {
  /** Every bot on this host. */
  bots: () => readonly { id: string; name: string }[]
  /** The bot id the bot chat index knows for a pane, a chat session, or a worktree a worker made. */
  botIdOfPane: (paneKey: string) => string | null
  botIdOfSession: (sessionId: string) => string | null
  botIdOfWorktree: (worktreeId: string) => string | null
  /** Orca's own resolution of a `--worktree` selector; throws when it names no git worktree. */
  resolveWorktree: (
    selector: string
  ) => Promise<{ id: string; path: string; branch: string; isMainWorktree: boolean }>
  /** `worktree ps` rows of one workspace. */
  psRows: (worktreeId: string) => Promise<readonly OwnRemovalPsRow[]>
}

export type OwnRemovalCaller = {
  workspaceId: string
  /** The folder the agent works in. */
  root: string
  paneKey?: string
  sessionId?: string
}

export type OwnRemovalOutcome = {
  decision: OwnWorktreeRemovalDecision
  /** The facts the decision read, for the audit line; null when none could be read. */
  workspace: { id: string; branch: string } | null
  branchDeleted: boolean
}

async function git(cwd: string, args: string[]): Promise<{ code: number; out: string } | null> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true })
    return { code: 0, out: stdout }
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
    return typeof code === 'number' ? { code, out: '' } : null
  }
}

/** True when `git status --porcelain` prints nothing (untracked files count); null when unreadable. */
export async function worktreeIsDirty(path: string): Promise<boolean | null> {
  const status = await git(path, ['status', '--porcelain', '--untracked-files=all'])
  return status && status.code === 0 ? status.out.trim().length > 0 : null
}

/** Whether `branch` is contained in the repo's default branch (or its remote copy); null if unknown. */
export async function branchIsMerged(
  path: string,
  branch: string,
  protectedBranches: readonly string[]
): Promise<boolean | null> {
  const known = readCommandGuardGit(path).defaultBranch
  const names = known ? [known] : ['main', 'master']
  if (names.includes(branch) || protectedBranches.includes(branch)) {
    return false
  }
  let sawNo = false
  for (const name of names) {
    for (const base of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
      const exists = await git(path, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
      if (exists?.code !== 0) {
        continue
      }
      const ancestor = await git(path, [
        'merge-base',
        '--is-ancestor',
        `refs/heads/${branch}`,
        base
      ])
      if (ancestor?.code === 0) {
        return true
      }
      sawNo = ancestor?.code === 1 || sawNo
    }
  }
  return sawNo ? false : null
}

function insidePath(inner: string, outer: string): boolean {
  const rel = relative(resolve(outer), resolve(inner))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Decides one lone `orca worktree rm` from the host's own state. Never throws; refuses on a timeout. */
export async function judgeOwnWorktreeRemoval(
  host: OwnRemovalHost,
  caller: OwnRemovalCaller,
  request: OwnWorktreeRemovalRequest,
  protectedBranches: readonly string[],
  deadlineMs = DEADLINE_MS
): Promise<OwnRemovalOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<OwnRemovalOutcome>((resolveLate) => {
    timer = setTimeout(
      () =>
        resolveLate({
          decision: OWN_WORKTREE_REMOVAL_TIMED_OUT,
          workspace: null,
          branchDeleted: request.deleteBranch
        }),
      deadlineMs
    )
  })
  try {
    return await Promise.race([readAndDecide(host, caller, request, protectedBranches), late])
  } finally {
    clearTimeout(timer)
  }
}

async function readAndDecide(
  host: OwnRemovalHost,
  caller: OwnRemovalCaller,
  request: OwnWorktreeRemovalRequest,
  protectedBranches: readonly string[]
): Promise<OwnRemovalOutcome> {
  const bots = host.bots()
  const nameOf = (id: string | null | undefined): string | null => {
    const found = id ? bots.filter((bot) => bot.id === id) : []
    const name = found[0]?.name
    return name && bots.filter((bot) => bot.name === name).length === 1 ? name : null
  }
  const ownerOf = async (worktreeId: string, rows: readonly OwnRemovalPsRow[]) => {
    const row = rows.find((candidate) => candidate.worktreeId === worktreeId)
    const named = row?.bot && bots.filter((bot) => bot.name === row.bot).length === 1
    return (named ? row.bot : null) ?? nameOf(host.botIdOfWorktree(worktreeId))
  }
  const facts: OwnWorktreeRemovalFacts = {
    callerBot: null,
    target: null,
    targetBot: null,
    callerInsideTarget: false,
    agentsRunning: 0,
    dirty: null,
    deleteBranch: request.deleteBranch,
    branchMerged: null
  }
  let workspace: OwnRemovalOutcome['workspace'] = null
  try {
    facts.callerBot =
      (caller.paneKey ? nameOf(host.botIdOfPane(caller.paneKey)) : null) ??
      (caller.sessionId ? nameOf(host.botIdOfSession(caller.sessionId)) : null) ??
      (await ownerOf(caller.workspaceId, await host.psRows(caller.workspaceId)))
    if (facts.callerBot !== null) {
      const target = await host.resolveWorktree(request.selector)
      if (!target.isMainWorktree) {
        const branch = target.branch.replace(/^refs\/heads\//, '')
        facts.target = { id: target.id, branch }
        workspace = { id: target.id, branch }
        const rows = await host.psRows(target.id)
        facts.targetBot = await ownerOf(target.id, rows)
        facts.callerInsideTarget =
          caller.workspaceId === target.id || insidePath(caller.root, target.path)
        facts.agentsRunning = rows
          .filter((row) => row.worktreeId === target.id)
          .reduce((sum, row) => sum + row.agents.length, 0)
        facts.dirty = await worktreeIsDirty(target.path)
        facts.branchMerged =
          request.deleteBranch && branch
            ? await branchIsMerged(target.path, branch, protectedBranches)
            : null
      }
    }
  } catch {
    // A fact Orca cannot read leaves the facts as they stand; the decision refuses on them.
  }
  return {
    decision: decideOwnWorktreeRemoval(facts),
    workspace,
    branchDeleted: request.deleteBranch
  }
}
