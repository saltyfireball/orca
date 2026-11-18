// Chat handoff (FORK.md, SLRM-2391): which chat handed work to which, kept in
// `fork-chat-handoff.json` in the data folder (mode 0600). A link says how far into the source the
// handoff read, so handing back carries only what is new. An unreadable file starts empty.
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isChatHandoffAgent, type ChatHandoffAgent } from '../../../shared/fork/chat-handoff'

export const CHAT_HANDOFF_FILE = 'fork-chat-handoff.json'
/** Oldest links are dropped past this many. */
const MAX_LINKS = 1000

export type ChatHandoffLink = {
  from: string
  fromAgent: ChatHandoffAgent
  to: string
  toAgent: ChatHandoffAgent
  /** The source's newest entry number the handoff carried. */
  throughSeq: number
  at: number
}

const ID = /^[A-Za-z0-9_-]{8,128}$/

function parseLink(value: unknown): ChatHandoffLink | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const { from, to, fromAgent, toAgent, throughSeq, at } = raw
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !ID.test(from) ||
    !ID.test(to) ||
    !isChatHandoffAgent(fromAgent) ||
    !isChatHandoffAgent(toAgent) ||
    typeof throughSeq !== 'number' ||
    !Number.isInteger(throughSeq) ||
    throughSeq < 0 ||
    typeof at !== 'number' ||
    !Number.isFinite(at)
  ) {
    return null
  }
  return { from, fromAgent, to, toAgent, throughSeq, at }
}

export function parseChatHandoffLinks(text: string): ChatHandoffLink[] {
  const parsed: unknown = JSON.parse(text)
  const links =
    typeof parsed === 'object' && parsed !== null && 'links' in parsed ? parsed.links : null
  if (!Array.isArray(links)) {
    return []
  }
  return links
    .slice(-MAX_LINKS)
    .map(parseLink)
    .filter((link): link is ChatHandoffLink => link !== null)
}

/** Links in memory, saved after every change. Tests pass no path and nothing is written. */
export class ChatHandoffLinks {
  private links: ChatHandoffLink[] = []
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly path: string | null) {}

  static at(stateDirectory: string): ChatHandoffLinks {
    return new ChatHandoffLinks(join(stateDirectory, CHAT_HANDOFF_FILE))
  }

  async load(): Promise<void> {
    if (!this.path) {
      return
    }
    try {
      this.links = parseChatHandoffLinks(await readFile(this.path, 'utf8'))
    } catch {
      this.links = []
    }
  }

  all(): readonly ChatHandoffLink[] {
    return this.links
  }

  /**
   * The newest chat of `agent` on the other end of a handoff with `sessionId`, and how far into
   * `sessionId` that chat has already seen (0 when it never got anything from it).
   */
  partner(sessionId: string, agent: ChatHandoffAgent): { id: string; seenThrough: number } | null {
    for (let index = this.links.length - 1; index >= 0; index -= 1) {
      const link = this.links[index]
      const other =
        link.from === sessionId && link.toAgent === agent
          ? link.to
          : link.to === sessionId && link.fromAgent === agent
            ? link.from
            : null
      if (other) {
        return { id: other, seenThrough: this.seenThrough(sessionId, other) }
      }
    }
    return null
  }

  private seenThrough(from: string, to: string): number {
    for (let index = this.links.length - 1; index >= 0; index -= 1) {
      const link = this.links[index]
      if (link.from === from && link.to === to) {
        return link.throughSeq
      }
    }
    return 0
  }

  add(link: ChatHandoffLink): Promise<void> {
    this.links = [...this.links, link].slice(-MAX_LINKS)
    const path = this.path
    if (!path) {
      return Promise.resolve()
    }
    const snapshot = this.links
    this.saving = this.saving
      .then(() => writeLinks(path, snapshot))
      .catch((error: unknown) => {
        console.warn('[fork-chat-handoff] could not save links', error)
      })
    return this.saving
  }
}

async function writeLinks(path: string, links: readonly ChatHandoffLink[]): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify({ version: 1, links }, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
