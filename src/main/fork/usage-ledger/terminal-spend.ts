// BAD-679 (FORK.md "Spend caps for every agent"): the spend of terminal agents, read from the
// transcript file each agent names in its hook posts (Claude Code and Codex) and fed to the usage
// ledger under the pane key. Only usage from after `notBefore` (when Orca began watching) counts,
// so an agent resumed from a long transcript is not paused for what it spent last week.
import { isAbsolute } from 'node:path'
import type { ForkUsageTokens } from '../../../shared/fork/usage-ledger'
import {
  CodexRolloutReader,
  parseClaudeTranscriptRow,
  readTranscriptRows,
  type ClaudeTranscriptCall
} from './transcript-usage'

export type TerminalSpendSink = {
  call: (id: string, agent: string, call: ClaudeTranscriptCall['call']) => boolean
  delta: (id: string, agent: string, model: string | null, delta: ForkUsageTokens) => boolean
}

type Watched = {
  path: string
  agent: 'claude' | 'codex'
  offset: number
  codex: CodexRolloutReader | null
}

const MAX_PATH = 1000
const MAX_WATCHED = 500

/** A transcript path a hook post names: absolute, a .jsonl file, no control characters. */
export function terminalTranscriptPath(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= MAX_PATH &&
    value.endsWith('.jsonl') &&
    isAbsolute(value) &&
    // oxlint-disable-next-line no-control-regex -- refusing control characters is the point
    !/[\x00-\x1f]/.test(value)
    ? value
    : null
}

export class TerminalSpendTracker {
  private readonly watched = new Map<string, Watched>()

  constructor(
    private readonly sink: TerminalSpendSink,
    private readonly notBefore: number
  ) {}

  /** A terminal agent named its transcript; a new path (a new conversation) starts over. */
  note(id: string, agent: string, path: unknown): void {
    const file = terminalTranscriptPath(path)
    if ((agent !== 'claude' && agent !== 'codex') || !file) {
      return
    }
    const known = this.watched.get(id)
    if (known?.path === file && known.agent === agent) {
      return
    }
    if (!known && this.watched.size >= MAX_WATCHED) {
      return
    }
    this.watched.set(id, {
      path: file,
      agent,
      offset: 0,
      codex: agent === 'codex' ? new CodexRolloutReader() : null
    })
  }

  has(id: string): boolean {
    return this.watched.has(id)
  }

  ids(): string[] {
    return [...this.watched.keys()]
  }

  forget(id: string): void {
    this.watched.delete(id)
  }

  /** Reads what the transcript gained and feeds the ledger; true when any spend was added. */
  async read(id: string): Promise<boolean> {
    const watch = this.watched.get(id)
    if (!watch) {
      return false
    }
    let added = false
    for (;;) {
      const chunk = await readTranscriptRows(watch.path, watch.offset)
      watch.offset = chunk.offset
      for (const line of chunk.lines) {
        added = this.feed(id, watch, line) || added
      }
      if (chunk.lines.length === 0) {
        return added
      }
    }
  }

  private feed(id: string, watch: Watched, line: string): boolean {
    if (watch.codex) {
      const growth = watch.codex.row(line, this.notBefore)
      return growth ? this.sink.delta(id, watch.agent, growth.model, growth.delta) : false
    }
    const row = parseClaudeTranscriptRow(line)
    if (!row || (row.at !== null && row.at < this.notBefore)) {
      return false
    }
    return this.sink.call(id, watch.agent, row.call)
  }
}
