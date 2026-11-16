// SLRM-2265: what the source and target hosts of a workspace move send each other. Each host
// answers for its own workspace and chats; the CLI or desktop that runs the move only relays.
import { z } from 'zod'

/** Agents whose transcripts a move carries; each host adopts them by provider session id. */
export const WORKTREE_MOVE_TRANSCRIPT_AGENTS = ['claude', 'codex'] as const
export type WorktreeMoveTranscriptAgent = (typeof WORKTREE_MOVE_TRANSCRIPT_AGENTS)[number]

/** A transcript larger than this stays behind; the chat is reported as not carried. */
export const WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024
/** Uncommitted changes larger than this refuse the patch step. */
export const WORKTREE_MOVE_MAX_PATCH_BYTES = 64 * 1024 * 1024

const Selector = z.string().trim().min(1).max(4096)
const Id = z.string().trim().min(1).max(512)
/** Base64 text, bounded by the byte limits above (4/3 of the bytes, plus padding). */
const Base64 = z
  .string()
  .max(Math.ceil((WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES * 4) / 3) + 8)
  .regex(/^[A-Za-z0-9+/=]*$/, 'Expected base64')

export const ForkWorktreeMoveInspectParams = z.object({ worktree: Selector })

export const ForkWorktreeMoveExportParams = z.object({
  worktree: Selector,
  /** Stop running turns of the carried chats first; without it a busy chat refuses. */
  stopTurns: z.boolean().optional(),
  /** Build a patch of the uncommitted changes (the index and working tree are left as they are). */
  patch: z.boolean().optional(),
  /** The chats whose transcripts to send. */
  sessionIds: z.array(Id).max(500).optional()
})

export const WorktreeMoveTranscript = z.object({
  sessionId: Id,
  agent: z.enum(WORKTREE_MOVE_TRANSCRIPT_AGENTS),
  providerSessionId: Id,
  name: z.string().max(1000),
  /** Where it sits below the provider's store: a file name (Claude) or `YYYY/MM/DD/<file>` (Codex). */
  relPath: z.string().min(1).max(1024),
  content: Base64
})

export const ForkWorktreeMoveImportParams = z.object({
  worktree: Selector,
  patch: Base64.optional(),
  sourcePath: z.string().min(1).max(4096),
  sourceHome: z.string().min(1).max(4096),
  rewriteHome: z.boolean().optional(),
  transcripts: z.array(WorktreeMoveTranscript).max(500).optional()
})

export type WorktreeMoveTranscriptWire = z.infer<typeof WorktreeMoveTranscript>

export type WorktreeMoveChat = {
  sessionId: string
  agent: string
  providerSessionId: string | null
  name: string
  busy: boolean
  /** Size of its transcript on the source; null when none was found there. */
  transcriptBytes: number | null
}

export type WorktreeMoveInspectResult = {
  worktreeId: string
  displayName: string
  path: string
  /** Null on a detached HEAD. */
  branch: string | null
  head: string
  repoId: string
  projectId: string | null
  /** The remote the branch pushes to: its upstream's, else the only or `origin` remote. */
  remote: string | null
  upstream: string | null
  dirty: boolean
  /** The source host's home folder, for transcript path rewriting. */
  home: string
  comment: string
  /** The workspace runs inside WSL, which a move does not carry. */
  wsl: boolean
  chats: WorktreeMoveChat[]
}

export type WorktreeMoveExportResult = {
  head: string
  patch: string | null
  patchBytes: number
  transcripts: WorktreeMoveTranscriptWire[]
  skipped: { sessionId: string; reason: string }[]
  stopped: string[]
}

export type WorktreeMoveImportResult = {
  patch: { kind: 'none' } | { kind: 'applied' } | { kind: 'failed'; error: string; savedTo: string }
  transcripts: {
    sessionId: string
    providerSessionId: string
    agent: WorktreeMoveTranscriptAgent
    written: boolean
    reason?: string
  }[]
}

/** The comment prefix of a moved source workspace. */
export const WORKTREE_MOVED_MARK = '[moved to '

export function worktreeMovedComment(comment: string, targetLabel: string, at: Date): string {
  const mark = `${WORKTREE_MOVED_MARK}${targetLabel} on ${at.toISOString().slice(0, 10)}]`
  return comment.trim() ? `${mark} ${comment.trim()}` : mark
}

export function isWorktreeMovedComment(comment: string): boolean {
  return comment.trimStart().startsWith(WORKTREE_MOVED_MARK)
}
