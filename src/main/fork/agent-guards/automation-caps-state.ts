// BAD-679 (FORK.md "Spend caps for every agent"): the caps set per automation (`orca guards
// automation-cap`), in `fork-automation-caps.json` in the data folder (mode 0600). An automation
// with none follows the settings' defaults. An unreadable file starts empty.
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENT_GUARD_MAX_CAP_USD } from '../../../shared/fork/agent-guards'
import type { AutomationCapOverride } from './automation-caps'

export const AUTOMATION_CAPS_FILE = 'fork-automation-caps.json'
const MAX_AUTOMATIONS = 2000
const MAX_ID = 200
const KEYS = ['runUsd', 'dayUsd', 'weekUsd'] as const

export type AutomationCapOverrides = Map<string, AutomationCapOverride>

export function automationCapsPath(stateDirectory: string): string {
  return join(stateDirectory, AUTOMATION_CAPS_FILE)
}

function readOverride(value: unknown): AutomationCapOverride | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const override: AutomationCapOverride = {}
  for (const key of KEYS) {
    const usd = raw[key]
    // 0 is a real value here: this automation has no cap of that kind.
    if (
      typeof usd === 'number' &&
      Number.isFinite(usd) &&
      usd >= 0 &&
      usd <= AGENT_GUARD_MAX_CAP_USD
    ) {
      override[key] = Math.round(usd * 100) / 100
    }
  }
  return Object.keys(override).length > 0 ? override : null
}

export function parseAutomationCapOverrides(text: string): AutomationCapOverrides {
  const overrides: AutomationCapOverrides = new Map()
  const parsed: unknown = JSON.parse(text)
  const automations =
    typeof parsed === 'object' && parsed !== null && 'automations' in parsed
      ? parsed.automations
      : null
  if (typeof automations !== 'object' || automations === null || Array.isArray(automations)) {
    return overrides
  }
  for (const [id, value] of Object.entries(automations)) {
    const override = readOverride(value)
    if (override && id && id.length <= MAX_ID && overrides.size < MAX_AUTOMATIONS) {
      overrides.set(id, override)
    }
  }
  return overrides
}

export async function readAutomationCapOverrides(path: string): Promise<AutomationCapOverrides> {
  try {
    return parseAutomationCapOverrides(await readFile(path, 'utf8'))
  } catch {
    return new Map()
  }
}

export async function writeAutomationCapOverrides(
  path: string,
  overrides: AutomationCapOverrides
): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(
      temp,
      `${JSON.stringify({ version: 1, automations: Object.fromEntries(overrides) }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    )
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Applies a change: a number sets that cap (0 is none), null follows the default again. */
export function applyAutomationCapChange(
  overrides: AutomationCapOverrides,
  id: string,
  change: { runUsd?: number | null; dayUsd?: number | null; weekUsd?: number | null }
): AutomationCapOverride | undefined {
  const next: AutomationCapOverride = { ...overrides.get(id) }
  for (const key of KEYS) {
    const value = change[key]
    if (value === null) {
      delete next[key]
    } else if (value !== undefined) {
      next[key] = Math.round(value * 100) / 100
    }
  }
  if (Object.keys(next).length === 0) {
    overrides.delete(id)
    return undefined
  }
  overrides.set(id, next)
  return next
}
