// Command guards (FORK.md, BAD-686): Orca's own deny rules for an agent's shell commands, run in
// the PreToolUse hook of agents whose hook can block a call. This file holds the rule ids, the
// settings, the audit entry and which agents are guarded. Pure. It is a safety net against
// mistakes, NOT a sandbox: it reads the command text, never runs it, and an agent that is set on
// getting around it can (a script written to disk, an unusual tool). Idea from Claude Code hooks,
// Codex execpolicy and Hermes guards; only the idea is ported.
import type { AgentHookSource } from '../agent-hook-listener/transport/agent-hook-relay'

export const COMMAND_GUARD_RULES = [
  'delete-outside-workspace',
  'force-push',
  'default-branch-rewrite',
  'remove-worktree',
  'guard-config',
  'unreadable-command'
] as const

export type CommandGuardRuleId = (typeof COMMAND_GUARD_RULES)[number]

export const COMMAND_GUARD_RULE_TEXT: Record<CommandGuardRuleId, string> = {
  'delete-outside-workspace':
    'rm, rmdir, unlink, shred and find -delete on a path outside the workspace (temp folders excepted)',
  'force-push': 'git push --force, --force-with-lease, --mirror or a +refspec',
  'default-branch-rewrite':
    'reset --hard, rebase, amend, force-move or delete of the default branch; filter-branch and filter-repo',
  'remove-worktree': 'git worktree remove and orca worktree rm',
  'guard-config': "changing these guards' own settings from an agent",
  'unreadable-command':
    'a command with an rm, git push or similar verb that the guard could not read (unbalanced quotes)'
}

export const COMMAND_GUARD_DEFAULT_AUDIT_LIMIT = 200
export const COMMAND_GUARD_MAX_AUDIT_LIMIT = 2000

export type ForkCommandGuardSettings = {
  /** Fork (BAD-686): deny an agent's destructive shell commands (a safety net, not a sandbox); unset is on. */
  forkCommandGuards?: boolean
  /** Fork (BAD-686): comma-separated rule ids to turn off everywhere: delete-outside-workspace, force-push, default-branch-rewrite, remove-worktree, guard-config, unreadable-command. */
  forkCommandGuardDisabledRules?: string
  /** Fork (BAD-686): rule ids a project allows, comma-separated, by project id; set with `orca command-guards allow`. */
  forkCommandGuardProjectRules?: Record<string, string>
  /** Fork (BAD-686): let deletes in the system temp folders through; unset is on. */
  forkCommandGuardAllowTempDeletes?: boolean
  /** Fork (BAD-686): extra absolute folders, comma-separated, where an agent may delete. */
  forkCommandGuardAllowedDeleteRoots?: string
  /** Fork (BAD-686): branch names, comma-separated, the history rules protect; empty finds each repo's default branch (main or master when unknown). */
  forkCommandGuardProtectedBranches?: string
  /** Fork (BAD-686): blocked commands kept in the audit list; unset is 200. */
  forkCommandGuardAuditLimit?: number
}

export type CommandGuardConfig = {
  enabled: boolean
  disabled: ReadonlySet<CommandGuardRuleId>
  projectAllowed: Readonly<Record<string, ReadonlySet<CommandGuardRuleId>>>
  allowTempDeletes: boolean
  deleteRoots: string[]
  protectedBranches: string[]
  auditLimit: number
}

export function isCommandGuardRule(value: unknown): value is CommandGuardRuleId {
  return COMMAND_GUARD_RULES.some((rule) => rule === value)
}

/** Rule ids in a comma list; names that are not rules are dropped. */
export function parseCommandGuardRules(value: unknown): Set<CommandGuardRuleId> {
  const rules = new Set<CommandGuardRuleId>()
  for (const part of typeof value === 'string' ? value.split(/[,\s]+/) : []) {
    if (isCommandGuardRule(part)) {
      rules.add(part)
    }
  }
  return rules
}

function list(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : []
}

export function readCommandGuardConfig(source: unknown): CommandGuardConfig {
  const raw: ForkCommandGuardSettings =
    typeof source === 'object' && source !== null ? { ...source } : {}
  const projects: Record<string, ReadonlySet<CommandGuardRuleId>> = {}
  const byProject = raw.forkCommandGuardProjectRules
  for (const [id, rules] of typeof byProject === 'object' && byProject
    ? Object.entries(byProject)
    : []) {
    projects[id] = parseCommandGuardRules(rules)
  }
  const limit = raw.forkCommandGuardAuditLimit
  return {
    enabled: raw.forkCommandGuards !== false,
    disabled: parseCommandGuardRules(raw.forkCommandGuardDisabledRules),
    projectAllowed: projects,
    allowTempDeletes: raw.forkCommandGuardAllowTempDeletes !== false,
    deleteRoots: list(raw.forkCommandGuardAllowedDeleteRoots).filter((root) =>
      root.startsWith('/')
    ),
    protectedBranches: list(raw.forkCommandGuardProtectedBranches),
    auditLimit:
      typeof limit === 'number' && Number.isFinite(limit) && limit >= 1
        ? Math.min(COMMAND_GUARD_MAX_AUDIT_LIMIT, Math.floor(limit))
        : COMMAND_GUARD_DEFAULT_AUDIT_LIMIT
  }
}

/** The rule ids off for one project: the global list plus what the project allows. */
export function commandGuardOffRules(
  config: CommandGuardConfig,
  projectId: string | null
): Set<CommandGuardRuleId> {
  return new Set([
    ...config.disabled,
    ...(projectId ? (config.projectAllowed[projectId] ?? []) : [])
  ])
}

export type CommandGuardAuditEntry = {
  id: string
  at: number
  agent: string
  /** Where the agent ran; absent on entries from before surfaces were told apart (a terminal). */
  surface?: CommandGuardSurface
  /** The workspace (worktree id) the agent runs in. */
  workspaceId: string
  rule: CommandGuardRuleId
  reason: string
  /** The command text, cut to 400 characters. */
  command: string
}

export type CommandGuardAgentCoverage = {
  agent: string
  guarded: boolean
  note: string
}

// Claude Code's script prints Orca's PreToolUse answer; the agents that reuse its script are not
// verified to honor it, and every other script discards Orca's reply.
const CLAUDE_COMPATIBLE = new Set(['qoder', 'qoder-cn', 'qwen-code', 'codebuddy'])

// A Record, so a new hook source is a type error here until someone says whether it can block.
const HOOK_SOURCES: Record<AgentHookSource, true> = {
  claude: true,
  codex: true,
  qoder: true,
  'qoder-cn': true,
  'qwen-code': true,
  codebuddy: true,
  antigravity: true,
  amp: true,
  opencode: true,
  opencode2: true,
  'mimo-code': true,
  cursor: true,
  pi: true,
  omp: true,
  'prime-agent': true,
  droid: true,
  'command-code': true,
  grok: true,
  copilot: true,
  hermes: true,
  devin: true,
  kimi: true,
  muse: true,
  zcode: true,
  dsh: true,
  jcode: true,
  kiro: true
}

/** Where an agent runs; each surface reaches the guard by its own path, so each is proven alone. */
export type CommandGuardSurface = 'terminal' | 'native-chat' | 'chat-worker'

export const COMMAND_GUARD_SURFACES: readonly CommandGuardSurface[] = [
  'terminal',
  'native-chat',
  'chat-worker'
]

/**
 * The test file that proves a deny on each surface (repo-relative); null means no proof, so the
 * surface is reported unguarded. A surface moves to guarded only together with its test.
 */
export const COMMAND_GUARD_SURFACE_PROOFS: Record<CommandGuardSurface, string | null> = {
  terminal: 'src/main/fork/command-guards/command-guards-live.test.ts',
  'native-chat': 'src/main/fork/command-guards/command-guards-native-chat.test.ts',
  'chat-worker': 'src/main/fork/command-guards/command-guards-native-chat.test.ts'
}

const SURFACE_NOTES: Record<CommandGuardSurface, { guarded: string; unguarded: string }> = {
  terminal: {
    guarded:
      'Claude Code in a terminal: PreToolUse hook (macOS and Linux; the Windows script and SSH or WSL hosts are not guarded)',
    unguarded: 'unguarded: no test proves a deny through the terminal hook'
  },
  'native-chat': {
    guarded: 'Claude native chat: PreToolUse hook answered inside Orca for each chat',
    unguarded:
      'unguarded: the chat drops the pane identity the terminal hook needs and no test proves the in-Orca hook'
  },
  'chat-worker': {
    guarded: 'Claude chat worker: the same in-Orca PreToolUse hook as a native chat',
    unguarded:
      'unguarded: the worker drops the pane identity the terminal hook needs and no test proves the in-Orca hook'
  }
}

/** The status's note for a surface with its proof, as an agent's guard line shows it. */
export function commandGuardSurfaceGuardedNote(surface: CommandGuardSurface): string {
  return SURFACE_NOTES[surface].guarded
}

export type CommandGuardSurfaceCoverage = {
  surface: CommandGuardSurface
  guarded: boolean
  note: string
  /** The test that proves a deny here; null while the surface is unguarded. */
  proof: string | null
  /** Chats of this surface started since this host launched, by whether a guard was attached. */
  chats?: { guarded: number; unguarded: number }
}

/** Claude Code's coverage per surface; a surface with no proving test is never guarded. */
export function commandGuardSurfaceCoverage(
  proofs: Record<CommandGuardSurface, string | null> = COMMAND_GUARD_SURFACE_PROOFS
): CommandGuardSurfaceCoverage[] {
  return COMMAND_GUARD_SURFACES.map((surface) => {
    const proof = proofs[surface]
    return {
      surface,
      guarded: proof !== null,
      note: proof !== null ? SURFACE_NOTES[surface].guarded : SURFACE_NOTES[surface].unguarded,
      proof
    }
  })
}

/** Which agents Orca can block for: only an agent whose hook script reads Orca's reply. */
export function commandGuardCoverage(
  proofs: Record<CommandGuardSurface, string | null> = COMMAND_GUARD_SURFACE_PROOFS
): CommandGuardAgentCoverage[] {
  const surfaces = commandGuardSurfaceCoverage(proofs)
  return Object.keys(HOOK_SOURCES).map((agent) => {
    if (agent === 'claude') {
      const open = surfaces.filter((row) => !row.guarded).map((row) => row.surface)
      return {
        agent,
        guarded: open.length === 0,
        note:
          open.length === 0
            ? 'guarded on every surface (see the surface list)'
            : `not guarded on: ${open.join(', ')} (see the surface list)`
      }
    }
    return {
      agent,
      guarded: false,
      note: CLAUDE_COMPATIBLE.has(agent)
        ? 'unguarded: uses the Claude script, but its honoring of the answer is unverified'
        : 'unguarded: its hook cannot block a call or Orca does not read its reply'
    }
  })
}
