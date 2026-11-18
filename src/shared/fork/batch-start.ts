// Batch start (FORK.md, SLRM-2395): a prompt box in the new-workspace composer (desktop and
// mobile) that turns each prompt into one worktree plus agent per chosen model, placed on the
// machine auto placement picks and started through the launch queue. Shared by main and clients.
import { z } from 'zod'
import { isTuiAgent } from '../agent-launch/catalog/tui-agent-config'
import type { TuiAgent } from '../agent-launch/catalog/tui-agent'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../execution-host/execution-host'
import type { Project, ProjectHostSetup } from '../project/project-types'
import { normalizeTypedName } from '../text/typed-name-normalization'

/** Most models one prompt may start: each is its own worktree and agent. */
export const FORK_BATCH_START_MAX_AGENTS = 6

/** Longest prompt the box sends. */
export const FORK_BATCH_START_MAX_PROMPT = 20_000

/** How long a client waits for one batch to be created on its machine. */
export const FORK_BATCH_START_TIMEOUT_MS = 180_000

const Selector = z.string().min(1).max(4096)

const Agent = z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown agent' })

const Text = z.string().max(4096)

export const ForkBatchStartParams = z
  .object({
    /** The project (its global identity key and display name); needed for auto placement. */
    project: z.object({ id: Selector, name: z.string().max(4096).optional() }).optional(),
    /** A repo selector on the machine that answers; used when no machine is picked. */
    repo: Selector.optional(),
    /** The repo's execution host on the machine that answers (an SSH host, say). */
    repoHostId: z.string().min(1).max(512).optional(),
    prompt: z
      .string()
      .max(FORK_BATCH_START_MAX_PROMPT)
      .refine((value) => value.trim().length > 0, 'Write a prompt first'),
    agents: z.array(Agent).min(1, 'Pick at least one model').max(FORK_BATCH_START_MAX_AGENTS),
    /** auto: the machine auto placement picks; here: the machine that answers. */
    placement: z.enum(['auto', 'here'])
  })
  .refine((value) => Boolean(value.project || value.repo), {
    message: 'Pass a project or a repo'
  })
  .refine((value) => value.placement === 'here' || Boolean(value.project), {
    message: 'Auto placement needs a project'
  })

export type ForkBatchStartRequest = z.infer<typeof ForkBatchStartParams>

/** The answer, parsed on every hop: a forwarded batch comes back from another machine. */
export const ForkBatchStartResultSchema = z.object({
  /** The machine that took the batch: 'local' on the answering machine, else `runtime:<id>`. */
  hostKey: z.string().max(512),
  hostLabel: z.string().max(512),
  tasks: z
    .array(
      z.discriminatedUnion('ok', [
        z.object({
          agent: Agent,
          ok: z.literal(true),
          worktreeId: Text,
          name: z.string().max(512),
          /** Set when the launch waits in that machine's agent queue. */
          queuedPosition: z.number().int().positive().optional(),
          warning: Text.optional()
        }),
        z.object({ agent: Agent, ok: z.literal(false), error: Text })
      ])
    )
    .max(FORK_BATCH_START_MAX_AGENTS)
})

export type ForkBatchStartResult = z.infer<typeof ForkBatchStartResultSchema>

export type ForkBatchStartTask = ForkBatchStartResult['tasks'][number]

export type ForkBatchStartSettings = {
  /** Fork (SLRM-2395): a Batch switch in the new-workspace composer for rapid prompts; unset is on. */
  forkBatchStart?: boolean
  /** Fork (SLRM-2395): the batch box starts with Keep open on; unset is on. */
  forkBatchStartKeepOpen?: boolean
  /** Fork (SLRM-2395): the batch box starts with Auto machine on; unset is on. */
  forkBatchStartAutoHost?: boolean
}

export type ForkBatchStartConfig = { enabled: boolean; keepOpen: boolean; autoHost: boolean }

export function readForkBatchStartSettings(
  settings: ForkBatchStartSettings | null | undefined
): ForkBatchStartConfig {
  return {
    enabled: settings?.forkBatchStart !== false,
    keepOpen: settings?.forkBatchStartKeepOpen !== false,
    autoHost: settings?.forkBatchStartAutoHost !== false
  }
}

/** The same, from a settings object read over RPC (a phone reading its host's settings). */
export function readForkBatchStartSettingsFrom(value: unknown): ForkBatchStartConfig {
  if (typeof value !== 'object' || value === null) {
    return readForkBatchStartSettings(null)
  }
  const flag = (key: keyof ForkBatchStartSettings): boolean | undefined => {
    const raw: unknown = Reflect.get(value, key)
    return typeof raw === 'boolean' ? raw : undefined
  }
  return readForkBatchStartSettings({
    forkBatchStart: flag('forkBatchStart'),
    forkBatchStartKeepOpen: flag('forkBatchStartKeepOpen'),
    forkBatchStartAutoHost: flag('forkBatchStartAutoHost')
  })
}

const SLUG_MAX = 32

/** Worktree name: the prompt's first words, the agent and a short random tail, so names never clash. */
export function forkBatchWorktreeName(prompt: string, agent: TuiAgent, tail: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
  const agentSlug = agent.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const cleanTail = tail.toLowerCase().replace(/[^a-z0-9]/g, '')
  return [slug || 'task', agentSlug, cleanTail].filter(Boolean).join('-')
}

const TITLE_MAX = 60

/** Display name: the prompt's first line, shortened. */
export function forkBatchDisplayName(prompt: string): string {
  const firstLine =
    prompt
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 3)}...` : firstLine
}

/**
 * The repo of a project's ready setup on this machine itself (id first, else a display name naming
 * exactly one project), as a selector for agent.launch. Setups kept for other hosts do not count.
 */
export function forkBatchLocalSetupRepo(
  projects: readonly Pick<Project, 'id' | 'displayName'>[],
  setups: readonly Pick<ProjectHostSetup, 'projectId' | 'hostId' | 'setupState' | 'repoId'>[],
  project: { id: string; name?: string }
): string | null {
  const local = setups.filter(
    (setup) =>
      setup.setupState === 'ready' &&
      normalizeExecutionHostId(setup.hostId) === LOCAL_EXECUTION_HOST_ID
  )
  const byId = local.find((setup) => setup.projectId === project.id)
  if (byId) {
    return `id:${byId.repoId}`
  }
  if (!project.name) {
    return null
  }
  const wanted = normalizeTypedName(project.name)
  const named = projects.filter((candidate) => normalizeTypedName(candidate.displayName) === wanted)
  const only = named.length === 1 ? named[0] : undefined
  const setup = only ? local.find((candidate) => candidate.projectId === only.id) : undefined
  return setup ? `id:${setup.repoId}` : null
}

/** Machines this one keeps a ready setup of the project for ('local', 'runtime:<id>'). */
export function forkBatchReadySetupHosts(
  setups: readonly Pick<ProjectHostSetup, 'projectId' | 'hostId' | 'setupState'>[],
  projectId: string
): string[] {
  const hosts = setups
    .filter((setup) => setup.projectId === projectId && setup.setupState === 'ready')
    .map((setup) => normalizeExecutionHostId(setup.hostId))
    .filter(
      (host): host is ExecutionHostId =>
        host === LOCAL_EXECUTION_HOST_ID || (host?.startsWith('runtime:') ?? false)
    )
  return [...new Set(hosts)]
}

export type ForkBatchOutcome = {
  /** Every model started: the box may clear. */
  allStarted: boolean
  /** The models to send again: the ones that failed, so a resend starts no duplicates. */
  retryAgents: TuiAgent[]
  /** Failure lines for the box, one per failed model. */
  errors: string[]
}

export function settleForkBatchOutcome(
  result: Pick<ForkBatchStartResult, 'tasks'>,
  labelOf: (agent: TuiAgent) => string
): ForkBatchOutcome {
  const failed = result.tasks.filter(
    (task): task is Extract<ForkBatchStartTask, { ok: false }> => !task.ok
  )
  return {
    allStarted: failed.length === 0 && result.tasks.length > 0,
    retryAgents: failed.map((task) => task.agent),
    errors: failed.map((task) => `${labelOf(task.agent)}: ${task.error}`)
  }
}

/** One acknowledgement line: what started where, and its queue place when it waits. */
export function describeForkBatchTask(
  task: Extract<ForkBatchStartTask, { ok: true }>,
  hostLabel: string,
  labelOf: (agent: TuiAgent) => string
): string {
  const queued = task.queuedPosition ? `, queued #${task.queuedPosition}` : ''
  return `${labelOf(task.agent)} on ${hostLabel}: ${task.name}${queued}`
}

/** Folds one answer into the box: what to show, which models stay picked, whether to clear. */
export function foldForkBatchAnswer(
  result: ForkBatchStartResult,
  labelOf: (agent: TuiAgent) => string
): { lines: string[]; retryAgents: TuiAgent[]; error: string | null; allStarted: boolean } {
  const outcome = settleForkBatchOutcome(result, labelOf)
  const lines = result.tasks.flatMap((task) =>
    task.ok ? [describeForkBatchTask(task, result.hostLabel, labelOf)] : []
  )
  return {
    lines,
    retryAgents: outcome.retryAgents,
    error: outcome.allStarted
      ? null
      : [
          ...outcome.errors,
          lines.length > 0 ? 'The rest started. Send again to retry the failed models.' : ''
        ]
          .filter(Boolean)
          .join('\n') || 'Nothing started.',
    allStarted: outcome.allStarted
  }
}

/** Shortens a prompt for the acknowledgement list. */
export function forkBatchPromptExcerpt(prompt: string): string {
  return forkBatchDisplayName(prompt) || '(empty)'
}
