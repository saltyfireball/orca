// SLRM-2265 (FORK.md): the settings of a workspace move to another host. Every behavior is a
// setting; unset keys take the defaults below.
import { WORKTREE_MOVE_DEFAULT_MAX_TOTAL_MB } from './worktree-move-wire'

export type ForkWorktreeMoveSettings = {
  /** Show "Move to Host" on the workspace menu; unset is on. */
  menu?: boolean
  /** A chat mid-turn: 'ask' offers to stop its turn first, 'refuse' never moves; unset is 'ask'. */
  whenBusy?: 'ask' | 'refuse'
  /** Uncommitted changes: 'patch' carries them as a patch, 'refuse' stops, 'leave' keeps them on the source only; unset is 'patch'. */
  uncommitted?: 'patch' | 'refuse' | 'leave'
  /** Push the branch to its remote before the target checks it out; unset is on. */
  push?: boolean
  /** Copy each native chat's transcript and reopen it on the target with its history; unset is on. */
  chats?: boolean
  /** Also rewrite the source home folder in transcripts to the target's; unset is on. */
  rewriteHome?: boolean
  /** Mark the source workspace as moved (its comment); unset is on. The source is never deleted. */
  markSource?: boolean
  /** Most megabytes of patch and chat transcripts one move carries, 1 to 2048; unset is 256. */
  maxTotalMb?: number
}

export type ResolvedWorktreeMoveSettings = Required<ForkWorktreeMoveSettings>

export const WORKTREE_MOVE_DEFAULTS: ResolvedWorktreeMoveSettings = {
  menu: true,
  whenBusy: 'ask',
  uncommitted: 'patch',
  push: true,
  chats: true,
  rewriteHome: true,
  markSource: true,
  maxTotalMb: WORKTREE_MOVE_DEFAULT_MAX_TOTAL_MB
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Settings as saved (possibly partial or hand-edited) to the full set the move uses. */
export function resolveWorktreeMoveSettings(
  value: ForkWorktreeMoveSettings | undefined | null
): ResolvedWorktreeMoveSettings {
  const d = WORKTREE_MOVE_DEFAULTS
  const v = value ?? {}
  return {
    menu: flag(v.menu, d.menu),
    whenBusy: pick(v.whenBusy, ['ask', 'refuse'], d.whenBusy),
    uncommitted: pick(v.uncommitted, ['patch', 'refuse', 'leave'], d.uncommitted),
    push: flag(v.push, d.push),
    chats: flag(v.chats, d.chats),
    rewriteHome: flag(v.rewriteHome, d.rewriteHome),
    markSource: flag(v.markSource, d.markSource),
    maxTotalMb:
      typeof v.maxTotalMb === 'number' &&
      Number.isInteger(v.maxTotalMb) &&
      v.maxTotalMb >= 1 &&
      v.maxTotalMb <= 2048
        ? v.maxTotalMb
        : d.maxTotalMb
  }
}
