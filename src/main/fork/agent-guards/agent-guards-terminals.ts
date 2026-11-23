// Agent guards (FORK.md, SLRM-2385, BAD-679): what the service knows of terminal agents: their
// titles from the agent rows, the agent and worktree each hook post named, and the transcripts
// their spend is read from. Keep electron out of this file.
import {
  forkUsageLedgerObserveTranscriptCall,
  forkUsageLedgerObserveTranscriptDelta
} from '../usage-ledger/usage-ledger-service'
import { TerminalSpendTracker } from '../usage-ledger/terminal-spend'
import type { AgentGuardEngine } from './agent-guards-engine'
import type { AgentGuardHookCall } from './agent-guards-hook-call'
import type { AgentGuardAgentMeta } from './agent-guards-types'

export class AgentGuardTerminals {
  /** Pane key to the title its agent row shows. */
  titles = new Map<string, string>()
  /** BAD-766: pane key to the orchestration handle of its terminal, for linking workers to Runs. */
  private readonly handles = new Map<string, string>()
  private readonly agents = new Map<string, { agent: string; worktreeId: string | null }>()
  private readonly tracker = new TerminalSpendTracker(
    {
      call: forkUsageLedgerObserveTranscriptCall,
      delta: forkUsageLedgerObserveTranscriptDelta
    },
    Date.now()
  )

  meta(paneKey: string): AgentGuardAgentMeta {
    const known = this.agents.get(paneKey)
    return {
      kind: 'terminal',
      agent: known?.agent ?? 'agent',
      title: this.titles.get(paneKey) ?? paneKey,
      worktreeId: known?.worktreeId ?? null
    }
  }

  handleOf = (paneKey: string): string | undefined => this.handles.get(paneKey)

  paneOf = (handle: string): string | undefined => {
    for (const [paneKey, known] of this.handles) {
      if (known === handle) {
        return paneKey
      }
    }
    return undefined
  }

  noteHandle(paneKey: string, handle: string | null | undefined): void {
    if (handle) {
      this.handles.set(paneKey, handle)
    }
  }

  /** A hook post named a terminal agent and, with it, the transcript its spend is in. */
  note(read: AgentGuardHookCall): void {
    this.agents.set(read.paneKey, {
      agent: read.agent,
      worktreeId: read.worktreeId
    })
    this.tracker.note(read.paneKey, read.agent, read.transcriptPath)
  }

  /** Brings the ledger up to date with what a terminal agent's transcript gained. */
  async read(paneKey: string): Promise<void> {
    await this.tracker.read(paneKey)
  }

  /** Reads each watched transcript that is still open; a closed pane's is forgotten. */
  async sweep(engine: AgentGuardEngine, live: ReadonlySet<string>, readSpend: boolean) {
    for (const paneKey of this.handles.keys()) {
      if (!live.has(paneKey)) {
        this.handles.delete(paneKey)
      }
    }
    for (const paneKey of this.tracker.ids()) {
      if (!live.has(paneKey)) {
        this.tracker.forget(paneKey)
        this.handles.delete(paneKey)
      } else if (readSpend) {
        // A terminal agent at rest spends nothing, but one thinking for a long time does.
        await engine.observeTerminalSpend(paneKey, this.meta(paneKey))
      }
    }
  }
}
