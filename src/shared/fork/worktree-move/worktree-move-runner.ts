// SLRM-2265: run a workspace move between two hosts' runtimes. The CLI and the desktop each give
// it a `call` that reaches the source and the target; every step runs on the host that owns it.
// The source is never deleted or reset: at most its turns stop (when agreed) and it gets marked.
import type { ProjectHostSetup } from '../../project-types'
import type { RuntimeWorktreeCreateResult } from '../../runtime-worktree-contracts'
import {
  createStructuredAgentSessionId,
  structuredAgentSessionCreateParams
} from '../../agent-session/structured-agent-session-create'
import {
  pickWorktreeMoveTargetRepo,
  planWorktreeMove,
  type WorktreeMovePlan,
  type WorktreeMoveStep,
  type WorktreeMoveTargetRepo
} from './worktree-move-plan'
import { stripWorktreeMoveControlChars as clean } from './worktree-move-ref'
import type { ResolvedWorktreeMoveSettings } from './worktree-move-settings'
import {
  worktreeMovedComment,
  type WorktreeMoveExportResult,
  type WorktreeMoveImportResult,
  type WorktreeMoveInspectResult
} from './worktree-move-wire'

export type WorktreeMoveSide = 'source' | 'target'
export type WorktreeMoveCall = (
  side: WorktreeMoveSide,
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>

export type WorktreeMoveRunArgs = {
  call: WorktreeMoveCall
  /** The source workspace, as the source host's selector (`id:<worktree id>`, a path...). */
  worktree: string
  sourceHostId: string
  targetHostId: string
  /** The target's name, for the source's moved mark. */
  targetLabel: string
  settings: ResolvedWorktreeMoveSettings
  stopTurns: boolean
  dryRun?: boolean
  randomUuid: () => string
  now?: () => Date
  onStep?: (step: WorktreeMoveStep) => void
}

export type WorktreeMoveChatOutcome = {
  sessionId: string
  name: string
  /** The reopened chat on the target; null when it stayed behind. */
  targetSessionId: string | null
  reason?: string
}

export type WorktreeMoveRunResult =
  | { kind: 'refuse'; plan: Extract<WorktreeMovePlan, { kind: 'refuse' }> }
  | { kind: 'ask'; plan: Extract<WorktreeMovePlan, { kind: 'ask' }> }
  | {
      kind: 'dry-run'
      plan: Extract<WorktreeMovePlan, { kind: 'move' }>
      source: WorktreeMoveInspectResult
      targetRepo: WorktreeMoveTargetRepo
    }
  | {
      kind: 'moved'
      plan: Extract<WorktreeMovePlan, { kind: 'move' }>
      source: WorktreeMoveInspectResult
      target: { worktreeId: string; path: string; branch: string | null }
      pushed: boolean
      patch: WorktreeMoveImportResult['patch']
      chats: WorktreeMoveChatOutcome[]
      marked: boolean
      warnings: string[]
    }

/** A step failed; what ran before it stays done (nothing on the source is undone or removed). */
export class WorktreeMoveStepError extends Error {
  constructor(
    readonly step: WorktreeMoveStep | 'inspect' | 'target-repo',
    readonly cause: unknown,
    readonly done: readonly string[]
  ) {
    const reason = clean(cause instanceof Error ? cause.message : String(cause))
    const progress = done.length > 0 ? ` Done before it: ${done.join('; ')}.` : ''
    super(`Move stopped at ${step}: ${reason}${progress}`)
    this.name = 'WorktreeMoveStepError'
  }
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'workspace'
}

export async function runWorktreeMove(args: WorktreeMoveRunArgs): Promise<WorktreeMoveRunResult> {
  const done: string[] = []
  const step = async <T>(
    name: WorktreeMoveStep | 'inspect' | 'target-repo',
    run: () => Promise<T>
  ): Promise<T> => {
    if (name !== 'inspect' && name !== 'target-repo') {
      args.onStep?.(name)
    }
    try {
      return await run()
    } catch (error) {
      throw new WorktreeMoveStepError(name, error, done)
    }
  }
  const source = await step(
    'inspect',
    async () =>
      (await args.call('source', 'fork.worktreeMove.inspect', {
        worktree: args.worktree
      })) as WorktreeMoveInspectResult
  )
  const plan = planWorktreeMove({
    sourceHostId: args.sourceHostId,
    targetHostId: args.targetHostId,
    facts: source,
    settings: args.settings,
    stopTurns: args.stopTurns
  })
  if (plan.kind === 'refuse') {
    return { kind: 'refuse', plan }
  }
  if (plan.kind === 'ask') {
    return { kind: 'ask', plan }
  }
  const targetRepo = await step('target-repo', async () => {
    const listed = (await args.call('target', 'projectHostSetup.list', {})) as {
      setups?: ProjectHostSetup[]
    }
    const picked = pickWorktreeMoveTargetRepo(listed.setups ?? [], source, args.targetHostId)
    if (!picked) {
      throw new Error('The project is not set up on the target host. Set it up there first.')
    }
    return picked
  })
  if (args.dryRun) {
    return { kind: 'dry-run', plan, source, targetRepo }
  }
  const sourceSelector = `id:${source.worktreeId}`
  if (plan.stopTurns) {
    args.onStep?.('stop-turns')
  }
  const exported = await step(
    'export',
    async () =>
      (await args.call('source', 'fork.worktreeMove.export', {
        worktree: sourceSelector,
        stopTurns: plan.stopTurns,
        patch: plan.carryPatch,
        sessionIds: plan.chats.map((chat) => chat.sessionId),
        maxTotalBytes: args.settings.maxTotalMb * 1024 * 1024
      })) as WorktreeMoveExportResult
  )
  done.push('read the changes and chats')
  if (plan.push) {
    await step('push', () =>
      args.call('source', 'git.push', { worktree: sourceSelector, publish: true })
    )
    done.push(`pushed ${plan.branch}`)
  }
  const created = await step(
    'create',
    async () =>
      (await args.call('target', 'worktree.create', {
        ...targetRepo,
        name: folderName(source.path),
        displayName: source.displayName || folderName(source.path),
        displayNameKind: 'user',
        baseBranch: `${plan.remote}/${plan.branch}`,
        branchNameOverride: plan.branch,
        branchIntent: 'open-existing-v2'
      })) as RuntimeWorktreeCreateResult
  )
  const target = {
    worktreeId: created.worktree.id,
    path: created.worktree.git.path,
    branch: created.worktree.git.branch || null
  }
  done.push(`created ${target.path} on the target`)
  const targetSelector = `id:${target.worktreeId}`
  const imported = await step(
    exported.transcripts.length > 0 ? 'copy-chats' : 'apply-patch',
    async () =>
      (await args.call('target', 'fork.worktreeMove.import', {
        worktree: targetSelector,
        ...(exported.patch ? { patch: exported.patch } : {}),
        sourcePath: source.path,
        sourceHome: source.home,
        rewriteHome: args.settings.rewriteHome,
        maxTotalBytes: args.settings.maxTotalMb * 1024 * 1024,
        transcripts: exported.transcripts
      })) as WorktreeMoveImportResult
  )
  const chats = await reopenChats(args, plan, exported, imported, targetSelector, step)
  let marked = false
  if (args.settings.markSource) {
    await step('mark-source', () =>
      args.call('source', 'worktree.set', {
        worktree: sourceSelector,
        comment: worktreeMovedComment(
          source.comment,
          args.targetLabel,
          (args.now ?? (() => new Date()))()
        )
      })
    )
    marked = true
  }
  const warnings = [...plan.warnings]
  if (imported.patch.kind === 'failed') {
    warnings.push(
      `The uncommitted changes did not apply on the target (${clean(imported.patch.error)}); the patch is saved at ${clean(imported.patch.savedTo)} and the changes are still on the source.`
    )
  }
  return {
    kind: 'moved',
    plan,
    source,
    target,
    pushed: plan.push,
    patch:
      imported.patch.kind === 'failed'
        ? {
            kind: 'failed',
            error: clean(imported.patch.error),
            savedTo: clean(imported.patch.savedTo)
          }
        : imported.patch,
    chats,
    marked,
    warnings
  }
}

async function reopenChats(
  args: WorktreeMoveRunArgs,
  plan: Extract<WorktreeMovePlan, { kind: 'move' }>,
  exported: WorktreeMoveExportResult,
  imported: WorktreeMoveImportResult,
  targetSelector: string,
  step: <T>(name: WorktreeMoveStep, run: () => Promise<T>) => Promise<T>
): Promise<WorktreeMoveChatOutcome[]> {
  const outcomes: WorktreeMoveChatOutcome[] = plan.skippedChats.map(({ chat, reason }) => ({
    sessionId: chat.sessionId,
    name: chat.name,
    targetSessionId: null,
    reason
  }))
  const names = new Map(plan.chats.map((chat) => [chat.sessionId, chat.name]))
  for (const skipped of exported.skipped) {
    outcomes.push({
      sessionId: skipped.sessionId,
      name: clean(names.get(skipped.sessionId) ?? skipped.sessionId),
      targetSessionId: null,
      reason: clean(skipped.reason)
    })
  }
  const written = imported.transcripts.filter((entry) => entry.written)
  for (const entry of imported.transcripts.filter((item) => !item.written)) {
    outcomes.push({
      sessionId: entry.sessionId,
      name: clean(names.get(entry.sessionId) ?? entry.sessionId),
      targetSessionId: null,
      reason: clean(entry.reason ?? 'not written on the target')
    })
  }
  if (written.length === 0) {
    return outcomes
  }
  await step('reopen-chats', async () => {
    for (const entry of written) {
      const name = clean(names.get(entry.sessionId) ?? entry.sessionId)
      const sessionId = createStructuredAgentSessionId(entry.agent, args.randomUuid)
      try {
        const result = (await args.call(
          'target',
          'agentSession.create',
          structuredAgentSessionCreateParams({
            sessionId,
            worktree: targetSelector,
            agent: entry.agent,
            resumeFrom: { providerSessionId: entry.providerSessionId },
            randomUuid: args.randomUuid
          }) as unknown as Record<string, unknown>
        )) as { ok?: boolean; refusal?: { message?: string } } | null
        if (result?.ok === false) {
          throw new Error(result.refusal?.message ?? 'the target refused to reopen it')
        }
        outcomes.push({ sessionId: entry.sessionId, name, targetSessionId: sessionId })
      } catch (error) {
        // One chat that will not reopen leaves its transcript there to resume by hand.
        const reason = clean(error instanceof Error ? error.message : String(error))
        outcomes.push({ sessionId: entry.sessionId, name, targetSessionId: null, reason })
      }
    }
  })
  return outcomes
}
