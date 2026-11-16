// SLRM-2265 (FORK.md): one host's half of a workspace move. As the source it reports the
// workspace and its chats and hands over a patch of the uncommitted changes and the chat
// transcripts; as the target it applies that patch and files the transcripts where its own
// provider stores look, so a create with `resumeFrom` adopts them. It never commits, resets or
// deletes anything on the source.
import { basename, join, resolve } from 'node:path'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import { agentSessionProviderHandleChainHead } from '../../../shared/agent-session/lifecycle/agent-session-provider-handle'
import type { RuntimeWorktreeRecord } from '../../../shared/runtime-worktree-contracts'
import {
  WORKTREE_MOVE_DEFAULT_MAX_TOTAL_MB,
  WORKTREE_MOVE_MAX_PATCH_BYTES,
  WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES,
  WORKTREE_MOVE_TRANSCRIPT_AGENTS,
  type WorktreeMoveExportResult,
  type WorktreeMoveInspectResult,
  type WorktreeMoveChat,
  type WorktreeMoveTranscriptAgent,
  type WorktreeMoveTranscriptWire
} from '../../../shared/fork/worktree-move/worktree-move-wire'
import { readBusyChat } from '../restart-guard/busy-chats'
import { worktreeMoveImport, type WorktreeMoveImportDeps } from './worktree-move-import'

export type WorktreeMoveGitOptions = { cwd: string; env?: NodeJS.ProcessEnv }

export type WorktreeMoveFs = {
  size(path: string): Promise<number | null>
  read(path: string): Promise<Buffer>
  write(path: string, data: Buffer | string): Promise<void>
  exists(path: string): Promise<boolean>
  rename(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  tempDir(): Promise<string>
  remove(path: string): Promise<void>
}

export type WorktreeMoveDeps = WorktreeMoveImportDeps & {
  showWorktree(selector: string): Promise<RuntimeWorktreeRecord>
  git(args: string[], options: WorktreeMoveGitOptions): Promise<string>
  gitBuffer(args: string[], options: WorktreeMoveGitOptions): Promise<Buffer>
  records(): readonly AgentSessionRecord[]
  summary(sessionId: string): AgentSessionStatusSummary | undefined
  stopTurn(sessionId: string): Promise<boolean>
  findTranscript(
    agent: WorktreeMoveTranscriptAgent,
    providerSessionId: string,
    cwd: string
  ): Promise<string | null>
  isWslPath(path: string): boolean
  sleep(ms: number): Promise<void>
}

/** Untracked file names a dry run lists; the rest are counted. */
const WORKTREE_MOVE_LISTED_UNTRACKED = 200
const STOP_WAIT_MS = 15_000
const STOP_POLL_MS = 250

function isCarriedAgent(agent: string): agent is WorktreeMoveTranscriptAgent {
  return (WORKTREE_MOVE_TRANSCRIPT_AGENTS as readonly string[]).includes(agent)
}

function chatIdentity(record: AgentSessionRecord): {
  agent: string
  providerSessionId: string | null
} {
  const head = agentSessionProviderHandleChainHead(record.providerHandleChain)
  return {
    agent: head?.handle.agent ?? record.provider,
    providerSessionId: head?.handle.nativeId ?? null
  }
}

/** Where a transcript sits below its provider store: Codex keeps its dated folders. */
export function transcriptRelPath(agent: WorktreeMoveTranscriptAgent, path: string): string {
  if (agent === 'codex') {
    const parts = path.split(/[\\/]/)
    const at = parts.lastIndexOf('sessions')
    if (at !== -1 && at < parts.length - 1) {
      return parts.slice(at + 1).join('/')
    }
  }
  return basename(path)
}

export class WorktreeMoveService {
  constructor(private readonly deps: WorktreeMoveDeps) {}

  private async optionalGit(args: string[], cwd: string): Promise<string | null> {
    try {
      return (await this.deps.git(args, { cwd })).trim() || null
    } catch {
      return null
    }
  }

  private async optionalGitRaw(args: string[], cwd: string): Promise<string | null> {
    try {
      return await this.deps.git(args, { cwd })
    } catch {
      return null
    }
  }

  private chatsOf(worktreeId: string): AgentSessionRecord[] {
    return this.deps.records().filter((record) => record.location.workspaceId === worktreeId)
  }

  private busy(sessionId: string): boolean {
    const summary = this.deps.summary(sessionId)
    return summary ? readBusyChat(summary) !== null : false
  }

  private name(record: AgentSessionRecord): string {
    const summary = this.deps.summary(record.sessionId)
    return summary?.conversationName?.trim() || record.conversationName?.trim() || record.sessionId
  }

  private async remoteOf(cwd: string, branch: string | null): Promise<string | null> {
    const configured = branch
      ? await this.optionalGit(['config', `branch.${branch}.remote`], cwd)
      : null
    if (configured && configured !== '.') {
      return configured
    }
    const remotes = (await this.optionalGit(['remote'], cwd))?.split('\n').filter(Boolean) ?? []
    if (remotes.includes('origin')) {
      return 'origin'
    }
    return remotes.length === 1 ? remotes[0] : null
  }

  async inspect(selector: string): Promise<WorktreeMoveInspectResult> {
    const worktree = await this.deps.showWorktree(selector)
    const cwd = worktree.git.path
    const branch = await this.optionalGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)
    const head = (await this.deps.git(['rev-parse', 'HEAD'], { cwd })).trim()
    const upstream = await this.optionalGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      cwd
    )
    const status = await this.deps.git(['status', '--porcelain', '--untracked-files=all'], { cwd })
    const untrackedAll = (
      (await this.optionalGitRaw(['ls-files', '--others', '--exclude-standard', '-z'], cwd)) ?? ''
    )
      .split('\0')
      .filter(Boolean)
    const chats: WorktreeMoveChat[] = []
    for (const record of this.chatsOf(worktree.id)) {
      const { agent, providerSessionId } = chatIdentity(record)
      let transcriptBytes: number | null = null
      if (providerSessionId && isCarriedAgent(agent)) {
        const path = await this.deps.findTranscript(agent, providerSessionId, cwd)
        transcriptBytes = path ? await this.deps.fs.size(path) : null
      }
      chats.push({
        sessionId: record.sessionId,
        agent,
        providerSessionId,
        name: this.name(record),
        busy: this.busy(record.sessionId),
        transcriptBytes
      })
    }
    return {
      worktreeId: worktree.id,
      displayName: worktree.displayName,
      path: cwd,
      branch,
      head,
      repoId: worktree.repoId,
      projectId: worktree.projectId ?? null,
      remote: await this.remoteOf(cwd, branch),
      upstream,
      dirty: status.trim().length > 0,
      untracked: untrackedAll.slice(0, WORKTREE_MOVE_LISTED_UNTRACKED),
      untrackedCount: untrackedAll.length,
      home: this.deps.home(),
      comment: worktree.comment,
      wsl: this.deps.isWslPath(cwd),
      chats
    }
  }

  private async stopTurns(sessionIds: readonly string[]): Promise<string[]> {
    const busy = sessionIds.filter((id) => this.busy(id))
    for (const id of busy) {
      if (!(await this.deps.stopTurn(id))) {
        throw new Error(`The host would not stop the running turn of ${id}.`)
      }
    }
    for (let waited = 0; busy.some((id) => this.busy(id)); waited += STOP_POLL_MS) {
      if (waited >= STOP_WAIT_MS) {
        throw new Error('A stopped turn is still winding down. Try again in a moment.')
      }
      await this.deps.sleep(STOP_POLL_MS)
    }
    return busy
  }

  /** A diff of everything uncommitted, built in a scratch index so the user's index is untouched. */
  private async buildPatch(cwd: string): Promise<Buffer> {
    const dir = await this.deps.fs.tempDir()
    try {
      const indexPath = resolve(
        cwd,
        (await this.deps.git(['rev-parse', '--git-path', 'index'], { cwd })).trim()
      )
      const scratch = join(dir, 'index')
      if (await this.deps.fs.exists(indexPath)) {
        await this.deps.fs.copy(indexPath, scratch)
      }
      const env = { ...process.env, GIT_INDEX_FILE: scratch }
      await this.deps.git(['add', '-A'], { cwd, env })
      return await this.deps.gitBuffer(['diff', '--binary', '--cached', 'HEAD'], { cwd, env })
    } finally {
      await this.deps.fs.remove(dir)
    }
  }

  async export(params: {
    worktree: string
    stopTurns?: boolean
    patch?: boolean
    sessionIds?: string[]
    maxTotalBytes?: number
  }): Promise<WorktreeMoveExportResult> {
    const worktree = await this.deps.showWorktree(params.worktree)
    const cwd = worktree.git.path
    const wanted = new Set(params.sessionIds ?? [])
    const records = this.chatsOf(worktree.id).filter((record) => wanted.has(record.sessionId))
    const ids = records.map((record) => record.sessionId)
    const stopped = params.stopTurns ? await this.stopTurns(ids) : []
    const busy = records.filter((record) => this.busy(record.sessionId))
    if (busy.length > 0) {
      throw new Error(`A chat is mid-turn: ${busy.map((record) => this.name(record)).join(', ')}.`)
    }
    const patch = params.patch ? await this.buildPatch(cwd) : null
    if (patch && patch.length > WORKTREE_MOVE_MAX_PATCH_BYTES) {
      throw new Error('The uncommitted changes are too large to carry as a patch.')
    }
    const budget = params.maxTotalBytes ?? WORKTREE_MOVE_DEFAULT_MAX_TOTAL_MB * 1024 * 1024
    if (patch && patch.length > budget) {
      throw new Error('The uncommitted changes pass the total size a move may carry.')
    }
    let carried = patch?.length ?? 0
    const transcripts: WorktreeMoveTranscriptWire[] = []
    const skipped: { sessionId: string; reason: string }[] = []
    for (const record of records) {
      const { agent, providerSessionId } = chatIdentity(record)
      const path =
        providerSessionId && isCarriedAgent(agent)
          ? await this.deps.findTranscript(agent, providerSessionId, cwd)
          : null
      if (!path || !providerSessionId || !isCarriedAgent(agent)) {
        skipped.push({ sessionId: record.sessionId, reason: 'its transcript was not found' })
        continue
      }
      const size = await this.deps.fs.size(path)
      if (size !== null && carried + size > budget) {
        skipped.push({
          sessionId: record.sessionId,
          reason: 'it would pass the total size a move may carry'
        })
        continue
      }
      const content = await this.deps.fs.read(path)
      if (carried + content.length > budget) {
        skipped.push({
          sessionId: record.sessionId,
          reason: 'it would pass the total size a move may carry'
        })
        continue
      }
      if (content.length > WORKTREE_MOVE_MAX_TRANSCRIPT_BYTES) {
        skipped.push({
          sessionId: record.sessionId,
          reason: 'its transcript is too large to carry'
        })
        continue
      }
      carried += content.length
      transcripts.push({
        sessionId: record.sessionId,
        agent,
        providerSessionId,
        name: this.name(record),
        relPath: transcriptRelPath(agent, path),
        content: content.toString('base64')
      })
    }
    return {
      head: (await this.deps.git(['rev-parse', 'HEAD'], { cwd })).trim(),
      patch: patch && patch.length > 0 ? patch.toString('base64') : null,
      patchBytes: patch?.length ?? 0,
      transcripts,
      skipped,
      stopped
    }
  }

  async import(params: Parameters<typeof worktreeMoveImport>[1]) {
    const worktree = await this.deps.showWorktree(params.worktree)
    return worktreeMoveImport(this.deps, params, worktree.git.path, (args, cwd) =>
      this.deps.git(args, { cwd })
    )
  }
}
