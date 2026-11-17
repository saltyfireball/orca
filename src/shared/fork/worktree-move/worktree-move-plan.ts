// SLRM-2265: decide what a workspace move does, from what the source host reported and the move
// settings. Pure, so the CLI and the desktop refuse, ask and plan the same way.
import { parseExecutionHostId } from '../../execution-host/execution-host'
import type { ProjectHostSetup } from '../../project/project-types'
import type { ResolvedWorktreeMoveSettings } from './worktree-move-settings'
import { isSafeWorktreeMoveRef } from './worktree-move-ref'
import {
  isWorktreeMovedComment,
  WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES,
  WORKTREE_MOVE_MAX_TRANSCRIPTS,
  WORKTREE_MOVE_TRANSCRIPT_AGENTS,
  type WorktreeMoveChat,
  type WorktreeMoveInspectResult
} from './worktree-move-wire'

export type WorktreeMoveStep =
  | 'stop-turns'
  | 'export'
  | 'push'
  | 'create'
  | 'apply-patch'
  | 'copy-chats'
  | 'reopen-chats'
  | 'mark-source'

export type WorktreeMoveRefusalCode =
  | 'same-host'
  | 'ssh-host'
  | 'wsl'
  | 'detached'
  | 'no-remote'
  | 'unsafe-ref'
  | 'uncommitted'
  | 'busy'

export type WorktreeMovePlan =
  | { kind: 'refuse'; code: WorktreeMoveRefusalCode; message: string }
  | { kind: 'ask'; code: 'busy'; busy: WorktreeMoveChat[]; message: string }
  | {
      kind: 'move'
      steps: WorktreeMoveStep[]
      branch: string
      remote: string
      stopTurns: boolean
      carryPatch: boolean
      /** Uncommitted changes stay on the source only (setting 'leave'). */
      leftUncommitted: boolean
      push: boolean
      chats: WorktreeMoveChat[]
      skippedChats: { chat: WorktreeMoveChat; reason: string }[]
      warnings: string[]
    }

export type WorktreeMovePlanInput = {
  sourceHostId: string
  targetHostId: string
  facts: Pick<
    WorktreeMoveInspectResult,
    'branch' | 'remote' | 'dirty' | 'chats' | 'wsl' | 'comment'
  >
  settings: ResolvedWorktreeMoveSettings
  /** The user agreed to stop running turns (the CLI's --stop-turns, the dialog's confirm). */
  stopTurns: boolean
}

function refuse(code: WorktreeMoveRefusalCode, message: string): WorktreeMovePlan {
  return { kind: 'refuse', code, message }
}

function hostKey(hostId: string): string {
  return parseExecutionHostId(hostId)?.id ?? hostId.trim()
}

/** Why a chat stays behind, or null when its transcript can travel. */
function chatSkipReason(chat: WorktreeMoveChat): string | null {
  if (!(WORKTREE_MOVE_TRANSCRIPT_AGENTS as readonly string[]).includes(chat.agent)) {
    return `${chat.agent} chats are not carried yet`
  }
  if (!chat.providerSessionId) {
    return 'the chat has no conversation yet'
  }
  if (chat.transcriptBytes === null) {
    return 'its transcript was not found on the source'
  }
  if (chat.transcriptBytes > WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES) {
    return 'its transcript is too large to carry'
  }
  return null
}

export function planWorktreeMove(input: WorktreeMovePlanInput): WorktreeMovePlan {
  const { facts, settings } = input
  const source = hostKey(input.sourceHostId)
  const target = hostKey(input.targetHostId)
  if (source === target) {
    return refuse('same-host', 'The workspace is already on that host.')
  }
  if (source.startsWith('ssh:') || target.startsWith('ssh:')) {
    return refuse(
      'ssh-host',
      'SSH hosts are not served by a runtime here. Pair the machine as an Orca server (runtime:<id>) to move workspaces to or from it.'
    )
  }
  if (facts.wsl) {
    return refuse('wsl', 'Workspaces inside WSL cannot be moved yet.')
  }
  if (!facts.branch) {
    return refuse('detached', 'The workspace is on a detached HEAD. Check out a branch first.')
  }
  if (!facts.remote) {
    return refuse('no-remote', 'The branch has no remote to push to, so the target cannot get it.')
  }
  if (!isSafeWorktreeMoveRef(facts.branch) || !isSafeWorktreeMoveRef(facts.remote)) {
    return refuse(
      'unsafe-ref',
      'The source reported a branch or remote name that is not a safe git name, so nothing was moved.'
    )
  }
  if (facts.dirty && settings.uncommitted === 'refuse') {
    return refuse(
      'uncommitted',
      'The workspace has uncommitted changes. Commit or stash them first.'
    )
  }
  const carried = settings.chats ? facts.chats : []
  const busy = carried.filter((chat) => chat.busy)
  if (busy.length > 0 && !input.stopTurns) {
    const names = busy.map((chat) => chat.name).join(', ')
    return settings.whenBusy === 'refuse'
      ? refuse('busy', `A chat is mid-turn (${names}). Wait for it to finish.`)
      : { kind: 'ask', code: 'busy', busy, message: `Stop the running turn of: ${names}?` }
  }
  const chats: WorktreeMoveChat[] = []
  const skippedChats: { chat: WorktreeMoveChat; reason: string }[] = []
  const budget = settings.maxTotalMb * 1024 * 1024
  let carriedBytes = 0
  for (const chat of carried) {
    let reason = chatSkipReason(chat)
    if (!reason && chats.length >= WORKTREE_MOVE_MAX_TRANSCRIPTS) {
      reason = `a move carries at most ${WORKTREE_MOVE_MAX_TRANSCRIPTS} chats`
    }
    if (!reason && carriedBytes + (chat.transcriptBytes ?? 0) > budget) {
      reason = `it would pass the ${settings.maxTotalMb} MB total for a move`
    }
    if (reason) {
      skippedChats.push({ chat, reason })
    } else {
      carriedBytes += chat.transcriptBytes ?? 0
      chats.push(chat)
    }
  }
  const carryPatch = facts.dirty && settings.uncommitted === 'patch'
  const leftUncommitted = facts.dirty && settings.uncommitted === 'leave'
  const warnings: string[] = []
  if (isWorktreeMovedComment(facts.comment)) {
    warnings.push('This workspace was moved before; this makes another copy.')
  }
  if (!settings.push) {
    warnings.push('Push is off: the target gets the branch as the remote has it now.')
  }
  if (leftUncommitted) {
    warnings.push('Uncommitted changes stay on the source only.')
  }
  const steps: WorktreeMoveStep[] = [
    ...(busy.length > 0 ? (['stop-turns'] as const) : []),
    'export',
    ...(settings.push ? (['push'] as const) : []),
    'create',
    ...(carryPatch ? (['apply-patch'] as const) : []),
    ...(chats.length > 0 ? (['copy-chats', 'reopen-chats'] as const) : []),
    ...(settings.markSource ? (['mark-source'] as const) : [])
  ]
  return {
    kind: 'move',
    steps,
    branch: facts.branch,
    remote: facts.remote,
    stopTurns: busy.length > 0,
    carryPatch,
    leftUncommitted,
    push: settings.push,
    chats,
    skippedChats,
    warnings
  }
}

export type WorktreeMoveTargetRepo = { repo: string; repoHostId?: string }

/**
 * The target host's copy of the source project: its own setup of the same project, else the same
 * repo id (hosts that share a project catalog). Null when the target has no setup of the project.
 */
export function pickWorktreeMoveTargetRepo(
  setups: readonly ProjectHostSetup[],
  facts: Pick<WorktreeMoveInspectResult, 'projectId' | 'repoId'>,
  targetHostId: string
): WorktreeMoveTargetRepo | null {
  const ready = setups.filter((setup) => setup.setupState === 'ready')
  const sameProject = facts.projectId
    ? ready.filter((setup) => setup.projectId === facts.projectId)
    : []
  const target = hostKey(targetHostId)
  // A target answers for itself as `local`; a desktop that routes for it names it by runtime id.
  const own =
    sameProject.find((setup) => hostKey(setup.hostId) === 'local') ??
    sameProject.find((setup) => hostKey(setup.hostId) === target)
  if (own) {
    return { repo: `id:${own.repoId}`, repoHostId: own.hostId }
  }
  const sameRepo = ready.find((setup) => setup.repoId === facts.repoId)
  if (sameRepo) {
    return { repo: `id:${sameRepo.repoId}`, repoHostId: sameRepo.hostId }
  }
  return null
}
