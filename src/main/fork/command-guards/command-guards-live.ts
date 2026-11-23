// Command guards (FORK.md, BAD-686): the rules wired to this process. The agent hook server asks
// `forkCommandGuardAnswer` before it answers a Claude Code PreToolUse post: a shell command that
// breaks a rule gets a `deny` with the reason (which Claude shows in the chat) and a line in the
// audit list. Everything else gets null and goes on as before. Nothing is ever run: the command
// is read as text. Not a sandbox. Keep electron out of this file.
import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename } from 'node:path'
import {
  COMMAND_GUARD_RULES,
  COMMAND_GUARD_RULE_TEXT,
  commandGuardCoverage,
  commandGuardSurfaceCoverage,
  commandGuardOffRules,
  isCommandGuardRule,
  parseCommandGuardRules,
  readCommandGuardConfig,
  type CommandGuardConfig,
  type CommandGuardRuleId,
  type ForkCommandGuardSettings
} from '../../../shared/fork/command-guards'
import { evaluateCommandGuard } from '../../../shared/fork/command-guards-rules'
import type {
  ForkCommandGuardsAllowResult,
  ForkCommandGuardsListResult,
  ForkCommandGuardsStatusResult
} from '../../../shared/fork/command-guards-wire'
import type { AgentHookSource } from '../../../shared/agent-hook-listener/transport/agent-hook-relay'
import type { Repo } from '../../../shared/repository/repo-types'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import {
  readAgentToolCall,
  type AgentToolCallOwner
} from '../../agent-hooks/tool-events/agent-tool-call-reader'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import {
  listCommandGuardAudit,
  openCommandGuardAudit,
  recordCommandGuardBlock
} from './command-guards-audit'
import { readCommandGuardGit } from './command-guards-git-state'

export type ForkCommandGuardsRuntime = {
  requireStore: () => {
    getSettings: () => unknown
    getRepos: () => Repo[]
    updateSettings?: (
      updates: Partial<ForkCommandGuardSettings>,
      options?: { notifyListeners?: boolean }
    ) => unknown
  }
}

const SHELL_TOOLS = /^(bash|shell|run_shell_command|execute_bash|exec_command)$/i
let runtime: ForkCommandGuardsRuntime | null = null

function settings(): unknown {
  try {
    return runtime?.requireStore().getSettings() ?? null
  } catch {
    return null
  }
}

function config(): CommandGuardConfig {
  return readCommandGuardConfig(settings())
}

/** Called once the runtime settles, in the desktop app and the headless server alike. */
export function startForkCommandGuards(next: ForkCommandGuardsRuntime): void {
  runtime = next
  if (process.env.VITEST) {
    return
  }
  try {
    openCommandGuardAudit(getProfileUserDataPath())
  } catch (error) {
    console.warn('[fork-command-guards] could not open audit', error)
  }
}

function tempRoots(): string[] {
  const roots = new Set(['/tmp', '/private/tmp', '/var/tmp', tmpdir()])
  for (const root of roots) {
    try {
      roots.add(realpathSync(root))
    } catch {
      // A folder that is not there needs no entry.
    }
  }
  return process.platform === 'win32' ? [tmpdir()] : [...roots]
}

function denyAnswer(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  })
}

/**
 * Hook (the hook server, before plugins): Claude Code's PreToolUse answer when the call breaks a
 * command guard, else null. `decides` is true when the hook script reads Orca's answer, so only
 * then is a block possible. Never throws: a fault in the guard lets the call through.
 */
export function forkCommandGuardAnswer(
  source: AgentHookSource,
  body: unknown,
  owner: AgentToolCallOwner,
  decides: boolean
): string | null {
  try {
    const settled = config()
    if (!decides || !settled.enabled || !owner.worktreeId) {
      return null
    }
    const call = readAgentToolCall(source, body, owner)
    const input = call?.payload.input
    const command =
      typeof input === 'object' && input !== null && 'command' in input ? input.command : null
    const root = splitWorktreeIdForFilesystem(owner.worktreeId)?.worktreePath
    if (
      call?.phase !== 'before' ||
      !SHELL_TOOLS.test(call.payload.tool) ||
      typeof command !== 'string' ||
      !root
    ) {
      return null
    }
    const verdict = evaluateCommandGuard(command, {
      workspaceRoot: root,
      home: homedir() || null,
      deleteRoots: [...settled.deleteRoots, ...(settled.allowTempDeletes ? tempRoots() : [])],
      protectedBranches: settled.protectedBranches,
      gitState: readCommandGuardGit,
      off: commandGuardOffRules(settled, getRepoIdFromWorktreeId(owner.worktreeId))
    })
    if (verdict.allowed) {
      return null
    }
    recordCommandGuardBlock(
      {
        at: Date.now(),
        agent: source,
        workspaceId: owner.worktreeId,
        rule: verdict.rule,
        reason: verdict.reason,
        command
      },
      settled.auditLimit
    )
    return denyAnswer(
      `Blocked by Orca's command guard (${verdict.rule}): ${verdict.reason} Do not retry this command or look for a way around it; tell the user what you wanted to do so they can do it or allow it.`
    )
  } catch (error) {
    console.warn('[fork-command-guards] check failed; the call goes through', error)
    return null
  }
}

export function forkCommandGuardList(): ForkCommandGuardsListResult {
  const limit = config().auditLimit
  return { entries: listCommandGuardAudit(limit), limit }
}

function repos(): Repo[] {
  try {
    return runtime?.requireStore().getRepos() ?? []
  } catch {
    return []
  }
}

const repoName = (repo: Repo): string => repo.displayName || repo.path

export function forkCommandGuardStatus(): ForkCommandGuardsStatusResult {
  const settled = config()
  const names = new Map(repos().map((repo) => [repo.id, repoName(repo)]))
  return {
    enabled: settled.enabled,
    rules: COMMAND_GUARD_RULES.map((rule) => ({
      rule,
      summary: COMMAND_GUARD_RULE_TEXT[rule],
      offEverywhere: settled.disabled.has(rule),
      allowedIn: Object.entries(settled.projectAllowed)
        .filter(([, rules]) => rules.has(rule))
        .map(([id]) => names.get(id) ?? id)
    })),
    agents: commandGuardCoverage(),
    surfaces: commandGuardSurfaceCoverage()
  }
}

function resolveProject(query: string): Repo {
  const lower = query.toLowerCase()
  const all = repos()
  const exact = all.filter(
    (repo) => repo.id === query || repo.path === query || repoName(repo).toLowerCase() === lower
  )
  const found =
    exact.length > 0 ? exact : all.filter((repo) => basename(repo.path).toLowerCase() === lower)
  if (found.length !== 1) {
    throw new Error(
      found.length === 0
        ? `No project "${query.slice(0, 80)}" on this host. Name it by its name, path or id.`
        : `"${query.slice(0, 80)}" names more than one project on this host; use its path or id.`
    )
  }
  return found[0]
}

function ruleList(rules: ReadonlySet<CommandGuardRuleId>): string {
  return COMMAND_GUARD_RULES.filter((rule) => rules.has(rule)).join(',')
}

/** `orca command-guards allow|disallow`: turns a rule off or on for one project, or for all. */
export function forkCommandGuardSetAllow(
  rule: string,
  project: string | undefined,
  allowed: boolean
): ForkCommandGuardsAllowResult {
  if (!runtime) {
    throw new Error('Command guards have not started on this host yet; try again in a moment.')
  }
  if (!isCommandGuardRule(rule)) {
    throw new Error(`No rule "${rule.slice(0, 60)}". Rules: ${COMMAND_GUARD_RULES.join(', ')}.`)
  }
  const store = runtime.requireStore()
  if (!store.updateSettings) {
    throw new Error('This host cannot change settings from here.')
  }
  const current = config()
  const toggle = (rules: ReadonlySet<CommandGuardRuleId>): string => {
    const next = new Set(rules)
    if (allowed) {
      next.add(rule)
    } else {
      next.delete(rule)
    }
    return ruleList(next)
  }
  if (!project) {
    store.updateSettings(
      { forkCommandGuardDisabledRules: toggle(current.disabled) },
      { notifyListeners: true }
    )
    return { rule, project: null, allowed }
  }
  const repo = resolveProject(project)
  const byProject: Record<string, string> = {}
  for (const [id, rules] of Object.entries(current.projectAllowed)) {
    byProject[id] = ruleList(rules)
  }
  byProject[repo.id] = toggle(parseCommandGuardRules(byProject[repo.id]))
  if (!byProject[repo.id]) {
    delete byProject[repo.id]
  }
  store.updateSettings({ forkCommandGuardProjectRules: byProject }, { notifyListeners: true })
  return { rule, project: repoName(repo), allowed }
}
