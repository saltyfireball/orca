// Own pull request loop limit (BAD-819, FORK.md "Own pull request loop limit"): one Decision inbox
// row per automation whose own pull request starts were stopped, read from its run history, until
// it is dismissed or the window passes with no new stop. Dismissals are kept in a file beside the
// store, so a restart does not bring a dismissed row back.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'
import { registerForkInboxSource } from '../idle-recovery/idle-recovery-sources'
import { isOwnPrLoopSkip, OWN_PR_WINDOW_MS } from './own-pr-loop-guard'

export const OWN_PR_LOOP_ROW_PREFIX = 'pr-loop:'
const DISMISSED_FILE = 'fork-own-pr-loop-dismissed.json'

export type OwnPrLoopInboxStore = {
  listAutomations(): readonly Pick<Automation, 'id' | 'name'>[]
  listAutomationRuns(automationId: string): readonly AutomationRun[]
}

type Dismissed = Record<string, number>

async function readDismissed(path: string): Promise<Dismissed> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    )
  } catch {
    return {}
  }
}

export type OwnPrLoopInbox = {
  items(): Promise<ForkIdleRecoveryInboxItem[]>
  dismiss(chatId: string): Promise<boolean>
}

export function ownPrLoopInbox(
  store: OwnPrLoopInboxStore,
  userDataPath: string,
  now: () => number = Date.now
): OwnPrLoopInbox {
  const path = join(userDataPath, DISMISSED_FILE)
  const loaded = readDismissed(path)
  const stopsOf = (dismissed: Dismissed, automation: Pick<Automation, 'id'>): AutomationRun[] => {
    const since = Math.max(now() - OWN_PR_WINDOW_MS, (dismissed[automation.id] ?? -1) + 1)
    return store
      .listAutomationRuns(automation.id)
      .filter((run) => isOwnPrLoopSkip(run) && run.createdAt >= since)
      .toSorted((a, b) => a.createdAt - b.createdAt)
  }
  return {
    items: async () => {
      const dismissed = await loaded
      return store.listAutomations().flatMap((automation) => {
        const stops = stopsOf(dismissed, automation)
        const last = stops.at(-1)
        if (!last) {
          return []
        }
        const count = stops.length === 1 ? 'One start was' : `${stops.length} starts were`
        return [
          {
            chatId: `${OWN_PR_LOOP_ROW_PREFIX}${automation.id}`,
            kind: 'chat',
            agent: automation.name,
            title: `${automation.name}: own pull request starts stopped`,
            workspace: '',
            worktreeId: null,
            verdict: 'waiting_user',
            question: [
              `${count} skipped in the last ${OWN_PR_WINDOW_MS / 60_000} minutes. The latest:`,
              last.error ?? '',
              '',
              'The automation stays on: a pull request you open later still starts it. Pause or edit it if its runs keep opening pull requests. Dismiss takes this off.'
            ].join('\n'),
            reason: '',
            since: stops[0]!.createdAt,
            wakes: 0,
            wakeAt: null,
            paused: false,
            source: 'pr-loop'
          } satisfies ForkIdleRecoveryInboxItem
        ]
      })
    },
    dismiss: async (chatId) => {
      if (!chatId.startsWith(OWN_PR_LOOP_ROW_PREFIX)) {
        return false
      }
      const automationId = chatId.slice(OWN_PR_LOOP_ROW_PREFIX.length)
      const dismissed = await loaded
      if (stopsOf(dismissed, { id: automationId }).length === 0) {
        return false
      }
      dismissed[automationId] = now()
      // Written beside and renamed over, so a quit mid-write never leaves half a file.
      const temporary = `${path}.${process.pid}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(dismissed), 'utf-8')
        await rename(temporary, path)
      } catch (error) {
        console.warn('[fork own pr loop] could not save a dismissal', error)
      }
      return true
    }
  }
}

let installedFor: object | null = null

/** Lists this host's stopped automations in the Decision inbox (once per store). */
export function installOwnPrLoopInbox(store: OwnPrLoopInboxStore, userDataPath: string): void {
  if (installedFor === store) {
    return
  }
  installedFor = store
  const inbox = ownPrLoopInbox(store, userDataPath)
  registerForkInboxSource({
    id: 'pr-loop',
    items: () => inbox.items(),
    answer: async () => null,
    dismiss: (chatId) => inbox.dismiss(chatId)
  })
}
