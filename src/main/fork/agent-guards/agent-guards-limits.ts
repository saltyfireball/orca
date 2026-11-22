// Agent guards (FORK.md, BAD-679 "Spend caps for every agent"): which spend caps cover an agent
// and what is spent against each, and the cap records a Run's or an automation's resume and
// `orca guards cap --run` change. Split from the engine; it acts on the engine's records.
import {
  agentGuardCapFor,
  type AgentGuardCapScope,
  type AgentGuardLimit
} from '../../../shared/fork/agent-guards'
import { roundUsd } from './agent-guards-entries'
import type {
  AgentGuardAgentMeta,
  AgentGuardEngineDeps,
  AgentGuardRun,
  AgentGuardSpend
} from './agent-guards-types'
import { pruneAgentGuardRecords, type AgentGuardRecord } from './agent-guards-state'

/** Spend since the last resume or cap change set a baseline. */
export const spentSince = (record: AgentGuardRecord | undefined, spend: AgentGuardSpend): number =>
  Math.max(0, (spend.totalUsd ?? 0) - (record?.baselineUsd ?? 0))

export class AgentGuardLimits {
  constructor(
    private readonly deps: AgentGuardEngineDeps,
    /** The record of an agent, made when it has none. */
    private readonly recordOf: (id: string, meta?: AgentGuardAgentMeta) => AgentGuardRecord
  ) {}

  /**
   * Every cap that covers an agent with its spend: its own or the default cap, its Run's and its
   * automation's. Empty when none does. Each counts from its last resume.
   */
  of(id: string): { limits: AgentGuardLimit[]; run: AgentGuardRun | null } {
    const limits: AgentGuardLimit[] = []
    const record = this.deps.records.get(id)
    const settings = this.deps.settings()
    const spend = this.deps.spend(id)
    const own = agentGuardCapFor(record?.capUsd, spend.isWorker, settings)
    if (own !== null && spend.totalUsd !== null) {
      limits.push({ scope: 'chat', capUsd: own, spentUsd: roundUsd(spentSince(record, spend)) })
    }
    const run = this.deps.run?.(id) ?? null
    const runCap = run ? this.runCapOf(run.rootId) : null
    if (run && runCap !== null) {
      limits.push({
        scope: 'run',
        capUsd: runCap,
        spentUsd: this.runSpentOf(run.rootId, run.totalUsd)
      })
    }
    if (record?.automationId) {
      for (const limit of this.deps.automationLimits?.(id, record.automationId) ?? []) {
        const baseline = record.limitBaselines?.[limit.scope] ?? 0
        limits.push({
          scope: limit.scope,
          capUsd: limit.capUsd,
          spentUsd: roundUsd(Math.max(0, limit.spentUsd - baseline))
        })
      }
    }
    return { limits, run }
  }

  /** A Run's cap on its coordinator, or the setting's default, or null for none. */
  runCapOf(rootId: string): number | null {
    const own = this.deps.records.get(rootId)?.runCapUsd
    const fallback = this.deps.settings().runCapUsd
    return own ?? (fallback > 0 ? fallback : null)
  }

  /** What a Run spent since its cap counted from. */
  runSpentOf(rootId: string, totalUsd: number): number {
    const baseline = this.deps.records.get(rootId)?.limitBaselines?.run ?? 0
    return roundUsd(Math.max(0, totalUsd - baseline))
  }

  /** A resume counts a Run's or an automation's cap from what it has spent by now. */
  setBaseline(
    id: string,
    record: AgentGuardRecord,
    scope: AgentGuardCapScope | undefined,
    meta: (id: string) => AgentGuardAgentMeta
  ): void {
    if (scope === 'run') {
      const run = this.deps.run?.(id)
      if (run) {
        const root = this.recordOf(run.rootId, meta(run.rootId))
        root.limitBaselines = { ...root.limitBaselines, run: roundUsd(run.totalUsd) }
      }
    } else if (scope?.startsWith('automation') && record.automationId) {
      const spent = this.deps
        .automationLimits?.(id, record.automationId)
        .find((limit) => limit.scope === scope)?.spentUsd
      if (spent !== undefined) {
        record.limitBaselines = { ...record.limitBaselines, [scope]: roundUsd(spent) }
      }
    }
  }

  /**
   * A Run's own cap, kept on its coordinator (`orca guards cap --run`); 0 drops it so the default
   * applies again. The Run's spend counts from now.
   */
  async setRunCap(
    id: string,
    usd: number
  ): Promise<{ capUsd: number | null; spentUsd: number; rootId: string }> {
    const run = this.deps.run?.(id) ?? { rootId: id, memberIds: [id], totalUsd: 0 }
    const root = this.recordOf(run.rootId)
    if (usd > 0) {
      root.runCapUsd = roundUsd(usd)
      root.limitBaselines = { ...root.limitBaselines, run: roundUsd(run.totalUsd) }
    } else {
      delete root.runCapUsd
      if (root.limitBaselines) {
        delete root.limitBaselines.run
      }
    }
    root.at = this.deps.now()
    pruneAgentGuardRecords(this.deps.records, this.deps.now())
    await this.deps.save()
    this.deps.changed()
    return { capUsd: root.runCapUsd ?? null, spentUsd: 0, rootId: run.rootId }
  }

  /** An automation started this agent: its automation caps cover it from now. */
  async noteAutomation(id: string, automationId: string, meta: AgentGuardAgentMeta): Promise<void> {
    const record = this.recordOf(id, meta)
    if (record.automationId === automationId) {
      return
    }
    record.automationId = automationId
    record.at = this.deps.now()
    await this.deps.save()
    this.deps.changed()
  }

  /** A chat's own cap; 0 drops it so the default applies again. Its spend counts from now. */
  async setChatCap(
    id: string,
    usd: number,
    meta: AgentGuardAgentMeta
  ): Promise<{ capUsd: number | null; spentUsd: number }> {
    const record = this.recordOf(id, meta)
    if (usd > 0) {
      record.capUsd = roundUsd(usd)
      record.baselineUsd = roundUsd(this.deps.spend(id).totalUsd ?? 0)
    } else {
      delete record.capUsd
    }
    record.at = this.deps.now()
    pruneAgentGuardRecords(this.deps.records, this.deps.now())
    await this.deps.save()
    this.deps.changed()
    return {
      capUsd: record.capUsd ?? null,
      spentUsd: roundUsd(spentSince(record, this.deps.spend(id)))
    }
  }
}
