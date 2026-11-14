// Idle recovery (FORK.md) settings: the chats idle recovery leaves alone. A chat is paused from
// its Decision inbox row; here each one, or all of them, can be let back in.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  readIdleRecoverySettings,
  withIdleRecoveryPaused
} from '../../../../shared/fork/idle-recovery-settings'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { Tab } from '../../../../shared/tab-types'
import { SettingsRow } from '../../components/settings/form-controls/SettingsFormControls'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

type TabsByWorktree = Record<string, readonly Tab[] | undefined> | undefined

/**
 * The tab title of a paused chat open in this window, or null. A paused id is a native chat
 * session id (a chat tab's entity) or a terminal agent pane key (which names its tab).
 */
export function pausedChatTitle(tabsByWorktree: TabsByWorktree, chatId: string): string | null {
  const tabId = parsePaneKey(chatId)?.tabId
  for (const tabs of Object.values(tabsByWorktree ?? {})) {
    for (const tab of tabs ?? []) {
      const isChat = tab.contentType === 'agent-session' && tab.entityId === chatId
      if (isChat || (tabId !== undefined && (tab.id === tabId || tab.entityId === tabId))) {
        return tab.customLabel || tab.label || null
      }
    }
  }
  return null
}

export function ForkIdleRecoveryPausedList({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const tabsByWorktree = useAppStore((s) => s.unifiedTabsByWorktree)
  const paused = readIdleRecoverySettings(settings).paused
  const label = t('fork.idleRecovery.pausedLabel', 'Paused chats')
  return (
    <div>
      <SettingsRow
        label={label}
        description={t(
          'fork.idleRecovery.pausedHelp',
          'Chats idle recovery leaves alone. Pause a chat from its row in the Decision inbox.'
        )}
        control={
          paused.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('fork.idleRecovery.pausedNone', 'None')}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateSettings({ forkIdleSweepPaused: [] })}
            >
              {t('fork.idleRecovery.pausedResumeAll', 'Resume all ({{count}})', {
                count: paused.length
              })}
            </Button>
          )
        }
      />
      {paused.length > 0 ? (
        <ul aria-label={label} className="scrollbar-sleek max-h-48 overflow-y-auto pb-2">
          {paused.map((chatId) => {
            const title = pausedChatTitle(tabsByWorktree, chatId)
            return (
              <li
                key={chatId}
                className="flex items-center gap-3 border-b border-border/50 py-1 text-sm last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  {title ? <div className="truncate">{title}</div> : null}
                  <div
                    className="truncate font-mono text-xs text-muted-foreground select-text"
                    title={chatId}
                  >
                    {chatId}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t(
                    'fork.idleRecovery.pausedResumeOne',
                    'Resume recovery for {{chat}}',
                    {
                      chat: title ?? chatId
                    }
                  )}
                  onClick={() => updateSettings(withIdleRecoveryPaused(settings, chatId, false))}
                >
                  {t('fork.idleRecovery.pausedResume', 'Resume')}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
