// FORK.md "MCP profiles": per chat, how it was launched, the profile chosen for it (if any) and
// what its last start ran with. Kept in one small JSON file in the app's data folder so a
// chat's choice survives a restart and applies when it resumes.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  FORK_MCP_LAUNCH_KINDS,
  type ForkMcpLastLaunch,
  type ForkMcpLaunchKind
} from '../../../shared/fork/mcp-profiles'

export type ForkMcpChatState = {
  kind: ForkMcpLaunchKind
  provider?: string
  chosen?: string
  last?: ForkMcpLastLaunch
  updatedAt: number
}

const MAX_CHATS = 5000
const SAVE_DELAY_MS = 500

function isKind(value: unknown): value is ForkMcpLaunchKind {
  return FORK_MCP_LAUNCH_KINDS.some((kind) => kind === value)
}

function parseChats(text: string): Map<string, ForkMcpChatState> {
  const chats = new Map<string, ForkMcpChatState>()
  const parsed: unknown = JSON.parse(text)
  const raw = (parsed as { chats?: unknown })?.chats
  if (!raw || typeof raw !== 'object') {
    return chats
  }
  for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<ForkMcpChatState> | null
    if (!entry || !isKind(entry.kind)) {
      continue
    }
    chats.set(sessionId, {
      kind: entry.kind,
      ...(typeof entry.provider === 'string' ? { provider: entry.provider } : {}),
      ...(typeof entry.chosen === 'string' ? { chosen: entry.chosen } : {}),
      ...(entry.last && typeof entry.last === 'object' ? { last: entry.last } : {}),
      updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0
    })
  }
  return chats
}

export class ForkMcpChatStore {
  private chats = new Map<string, ForkMcpChatState>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<void> {
    if (!this.file) {
      return
    }
    try {
      this.chats = parseChats(await readFile(this.file, 'utf8'))
    } catch {
      this.chats = new Map()
    }
  }

  get(sessionId: string): ForkMcpChatState | undefined {
    return this.chats.get(sessionId)
  }

  update(sessionId: string, change: (current: ForkMcpChatState) => ForkMcpChatState): void {
    const current = this.chats.get(sessionId) ?? {
      kind: 'interactive',
      updatedAt: 0
    }
    this.chats.set(sessionId, { ...change(current), updatedAt: this.now() })
    this.prune()
    this.scheduleSave()
  }

  private prune(): void {
    if (this.chats.size <= MAX_CHATS) {
      return
    }
    const oldest = [...this.chats.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    for (const [sessionId] of oldest.slice(0, this.chats.size - MAX_CHATS)) {
      this.chats.delete(sessionId)
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, SAVE_DELAY_MS)
    this.timer.unref?.()
  }

  /** Writes now; one write at a time, each through a temp file. */
  flush(): Promise<void> {
    const file = this.file
    if (!file) {
      return Promise.resolve()
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const body = JSON.stringify({
      version: 1,
      chats: Object.fromEntries(this.chats)
    })
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 })
        const temp = `${file}.tmp`
        await writeFile(temp, body, { mode: 0o600 })
        await rename(temp, file)
      } catch (error) {
        console.warn('[fork-mcp-profiles] could not save chat profiles', String(error))
      }
    })
    return this.writing
  }
}
