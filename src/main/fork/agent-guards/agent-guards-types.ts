// Agent guards (FORK.md, SLRM-2385): what the engine is given, and its per-agent lanes.
import type { AgentGuardEntry, AgentGuardSettings } from '../../../shared/fork/agent-guards'
import type { AgentGuardActPorts } from './agent-guards-act'
import type { AgentGuardMeta } from './agent-guards-entries'
import type { AgentGuardRecords } from './agent-guards-state'

export type AgentGuardAgentMeta = AgentGuardMeta

export type AgentGuardChatRow = AgentGuardAgentMeta & {
  kind: 'chat'
  sessionId: string
  working: boolean
}

export type AgentGuardSpend = {
  /** Estimated USD of everything the ledger kept for the chat, or null when it has no record. */
  totalUsd: number | null
  /** An orchestration worker: the default cap's 'workers' scope covers it. */
  isWorker: boolean
}

export type AgentGuardEngineDeps = {
  ports: AgentGuardActPorts
  records: AgentGuardRecords
  save: () => Promise<void>
  now: () => number
  settings: () => AgentGuardSettings
  spend: (sessionId: string) => AgentGuardSpend
  /** Told once per pause; never throws into the engine. */
  notify: (entry: AgentGuardEntry) => void
  /** The entries or the held set changed. */
  changed: () => void
  /** Rows observed before this are history: never counted. */
  startedAt: number
}

/** Runs each agent's steps one at a time, in order; a failed step is logged, never thrown. */
export class AgentGuardLanes {
  private readonly lanes = new Map<string, Promise<void>>()

  run(id: string, task: () => Promise<void>): Promise<void> {
    const next = (this.lanes.get(id) ?? Promise.resolve()).then(task).catch((error: unknown) => {
      console.warn('[fork-agent-guards] a guard step failed', error)
    })
    this.lanes.set(id, next)
    void next.finally(() => {
      if (this.lanes.get(id) === next) {
        this.lanes.delete(id)
      }
    })
    return next
  }
}
