// Bot asks in the Decision inbox (FORK.md "Idle recovery", SLRM-2453): tells the inbox's notify
// targets of each new bot ask once. Windows report the asks they read (each window reads every
// listed host's bots, paired servers included); this keeps which asks were told, in
// `fork-bot-asks.json` in the data folder, so a second window, a re-read or a restart never tells
// one again. A new question on the same item is a new ask.
// Contract: `report` never throws. The first report after the feature is on tells every ask then
// waiting; after that only asks not seen before. An ask not reported for a week is forgotten.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import {
  forkBotAsksDesktopText,
  forkBotAsksNotifyPayload,
  forkBotAskTitle,
  readForkInboxBotAsksSettings,
  type ForkBotAskNotice,
  type ForkBotAsksReportRequest,
  type ForkBotAsksReportResult,
  type ForkInboxBotAsksSettingsSource
} from '../../../shared/fork/inbox-bot-asks'
import {
  readIdleRecoverySettings,
  type IdleRecoverySettingsSource
} from '../../../shared/fork/idle-recovery-settings'
import { sendForkNotifyTargets } from '../idle-recovery/idle-recovery-notify'
import type { OwnerNotice } from '../../runtime/push/notifications/runtime-mobile-notification-controller'

export const FORK_BOT_ASKS_STATE_FILE_NAME = 'fork-bot-asks.json'
const FORGET_MS = 7 * 24 * 60 * 60_000
const MAX_KEPT = 2000
const REFRESH_MS = 60 * 60_000

/** Each told ask's key and when a window last reported it. */
export type ForkBotAsksState = { version: 1; seen: Record<string, number> }

export type ForkBotAsksSettingsSource = IdleRecoverySettingsSource &
  ForkInboxBotAsksSettingsSource & { notifications?: { enabled?: boolean } }

export type ForkBotAsksNotifierDeps = {
  now: () => number
  loadState: () => Promise<ForkBotAsksState>
  saveState: (state: ForkBotAsksState) => Promise<void>
  settings: () => ForkBotAsksSettingsSource | null | undefined
  /** The desktop, webhook and command targets (`sendForkNotifyTargets`). */
  sendTargets: typeof sendForkNotifyTargets
  /** A push to the paired phones, or null where there is no runtime. */
  phone: (() => ((notice: OwnerNotice) => void) | null) | null
}

export function emptyForkBotAsksState(): ForkBotAsksState {
  return { version: 1, seen: {} }
}

/** The asks not told yet, and the state with every reported ask marked seen now and old ones gone. */
export function forkBotAsksToTell(
  state: ForkBotAsksState,
  asks: readonly ForkBotAskNotice[],
  now: number
): { fresh: ForkBotAskNotice[]; next: ForkBotAsksState; changed: boolean } {
  const seen: Record<string, number> = {}
  let changed = false
  for (const [key, at] of Object.entries(state.seen)) {
    if (now - at < FORGET_MS) {
      seen[key] = at
    } else {
      changed = true
    }
  }
  const fresh: ForkBotAskNotice[] = []
  const keys = new Set<string>()
  for (const ask of asks) {
    if (keys.has(ask.key)) {
      continue
    }
    keys.add(ask.key)
    const at = seen[ask.key]
    if (at === undefined) {
      fresh.push(ask)
    }
    // Reports come on every change; the file is written only when a mark is new or an hour old.
    if (at === undefined || now - at >= REFRESH_MS) {
      seen[ask.key] = now
      changed = true
    }
  }
  const kept = Object.entries(seen)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEPT)
  return { fresh, next: { version: 1, seen: Object.fromEntries(kept) }, changed }
}

function phoneNoticeId(key: string): string {
  // Owner notice ids key a cooldown and a phone notice; the ask key is long and holds host ids.
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0
  }
  return `fork-bot-ask-${(hash >>> 0).toString(36)}-${key.length}`
}

export function createForkBotAsksNotifier(deps: ForkBotAsksNotifierDeps) {
  let state: Promise<ForkBotAsksState> | null = null
  // One report at a time, so two windows reporting the same new ask tell it once.
  let queue: Promise<unknown> = Promise.resolve()

  const tell = async (fresh: readonly ForkBotAskNotice[], source: ForkBotAsksSettingsSource) => {
    const targets = readIdleRecoverySettings(source)
    // The ask is on screen in the window that saw it: the desktop banner would only repeat it.
    const offScreen = fresh.filter((ask) => !ask.onScreen)
    await deps.sendTargets({
      logTag: 'bot-asks',
      desktop:
        targets.notifyDesktop && offScreen.length > 0 ? forkBotAsksDesktopText(offScreen) : null,
      webhookUrl: targets.notifyWebhookUrl,
      command: targets.notifyCommand,
      payload: () => forkBotAsksNotifyPayload(fresh)
    })
    const push = readForkInboxBotAsksSettings(source).phone ? (deps.phone?.() ?? null) : null
    if (push && source.notifications?.enabled !== false) {
      for (const ask of fresh) {
        try {
          push({
            id: phoneNoticeId(ask.key),
            title: forkBotAskTitle(ask),
            body: ask.question || ask.title,
            desktop: false
          })
        } catch (error) {
          console.warn(
            '[bot-asks] phone notice failed',
            error instanceof Error ? error.message : ''
          )
        }
      }
    }
  }

  const run = async (request: ForkBotAsksReportRequest): Promise<ForkBotAsksReportResult> => {
    const source = deps.settings() ?? {}
    if (!readForkInboxBotAsksSettings(source).enabled) {
      return { notified: 0 }
    }
    state ??= deps.loadState().catch(() => emptyForkBotAsksState())
    const before = await state
    const { fresh, next, changed } = forkBotAsksToTell(before, request.asks, deps.now())
    state = Promise.resolve(next)
    if (changed) {
      try {
        await deps.saveState(next)
      } catch (error) {
        console.warn(
          '[bot-asks] could not save its state',
          error instanceof Error ? error.message : ''
        )
      }
    }
    if (fresh.length > 0) {
      await tell(fresh, source)
    }
    return { notified: fresh.length }
  }

  return {
    report(request: ForkBotAsksReportRequest): Promise<ForkBotAsksReportResult> {
      const result = queue
        .then(() => run(request))
        .catch((error: unknown) => {
          console.warn('[bot-asks] report failed', error instanceof Error ? error.message : '')
          return { notified: 0 }
        })
      queue = result
      return result
    }
  }
}

export function forkBotAsksStatePath(): string {
  return join(getAppEnvironment().getPath('userData'), FORK_BOT_ASKS_STATE_FILE_NAME)
}

export async function loadForkBotAsksState(
  path = forkBotAsksStatePath()
): Promise<ForkBotAsksState> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
    const seen =
      raw && typeof raw === 'object' && 'seen' in raw && raw.seen && typeof raw.seen === 'object'
        ? (raw.seen as Record<string, unknown>)
        : {}
    const kept: Record<string, number> = {}
    for (const [key, at] of Object.entries(seen)) {
      if (typeof at === 'number' && Number.isFinite(at)) {
        kept[key] = at
      }
    }
    return { version: 1, seen: kept }
  } catch {
    return emptyForkBotAsksState()
  }
}

export async function saveForkBotAsksState(
  state: ForkBotAsksState,
  path = forkBotAsksStatePath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    // A rename within one folder replaces the file in one step.
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

let notifier: ReturnType<typeof createForkBotAsksNotifier> | null = null

/** A window's report of the bot asks it reads now. Uses idle recovery's settings and runtime. */
export function reportForkBotAsks(
  request: ForkBotAsksReportRequest,
  readers: {
    settings: () => unknown
    runtime: () =>
      | { dispatchOwnerNotice: (notice: OwnerNotice, settings: { enabled: boolean }) => void }
      | null
      | undefined
  }
): Promise<ForkBotAsksReportResult> {
  notifier ??= createForkBotAsksNotifier({
    now: Date.now,
    loadState: () => loadForkBotAsksState(),
    saveState: (next) => saveForkBotAsksState(next),
    settings: () => readers.settings() as ForkBotAsksSettingsSource | null | undefined,
    sendTargets: sendForkNotifyTargets,
    phone: () => {
      const runtime = readers.runtime()
      return runtime ? (notice) => runtime.dispatchOwnerNotice(notice, { enabled: true }) : null
    }
  })
  return notifier.report(request)
}
