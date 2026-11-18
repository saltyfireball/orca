// Letters and the board (FORK.md, SLRM-2389) settings: both on by default; the rate limits keep
// agents from flooding each other or the user. `orca settings` cannot write the limits, since
// agents run that CLI.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { readForkLettersSettings } from '../../../../shared/fork/letters'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'
import { openForkLetters } from './board-store'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function NumberRow(props: {
  label: string
  description: string
  value: number
  min: number
  max: number
  disabled: boolean
  onCommit: (next: number) => void
}): React.JSX.Element {
  return (
    <SettingsRow
      label={props.label}
      description={props.description}
      control={
        <ForkNumberInput
          value={props.value}
          label={props.label}
          min={props.min}
          max={props.max}
          disabled={props.disabled}
          onCommit={props.onCommit}
        />
      }
    />
  )
}

export function ForkLettersSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const current = readForkLettersSettings(settings)
  const off = !current.letters && !current.board
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.letters.settings.title', 'Letters and the board')}
        description={t(
          'fork.letters.settings.description',
          "Chats and workers write each other with orca letter send, on this host or a paired one; a letter waits until its recipient ends its turn and is marked as words from another agent. Agents file REVIEW, DECIDE and DO asks for you with orca board add; they show above the chat's message box and in the Decision inbox."
        )}
      />
      <SettingsSwitchRow
        label={t('fork.letters.settings.lettersLabel', 'Letters')}
        description={t(
          'fork.letters.settings.lettersHelp',
          'Off: orca letter send is refused on this host and nothing queued is delivered.'
        )}
        checked={current.letters}
        onChange={() => updateSettings({ forkLetters: !current.letters })}
      />
      <SettingsSwitchRow
        label={t('fork.letters.settings.pairedLabel', 'Letters from paired hosts')}
        description={t(
          'fork.letters.settings.pairedHelp',
          'Take letters from chats on a paired device. Their sender cannot be checked here, and the letter says so.'
        )}
        checked={current.fromPaired}
        disabled={!current.letters}
        onChange={() => updateSettings({ forkLettersFromPaired: !current.fromPaired })}
      />
      <SettingsSwitchRow
        label={t('fork.letters.settings.boardLabel', 'Board')}
        description={t(
          'fork.letters.settings.boardHelp',
          'Off: orca board add is refused, and the tray and the inbox rows are hidden.'
        )}
        checked={current.board}
        onChange={() => updateSettings({ forkBoard: !current.board })}
      />
      <NumberRow
        label={t('fork.letters.settings.maxLabel', 'Letters per chat in the window')}
        description={t(
          'fork.letters.settings.maxHelp',
          'Letters and asks one chat may send in the rate window; the next is refused with a reason.'
        )}
        value={current.maxPerWindow}
        min={1}
        max={200}
        disabled={off}
        onCommit={(next) => updateSettings({ forkLettersMaxPerWindow: next })}
      />
      <NumberRow
        label={t('fork.letters.settings.windowLabel', 'Rate window (minutes)')}
        description={t('fork.letters.settings.windowHelp', 'How far back the limits count.')}
        value={Math.round(current.windowMs / 60_000)}
        min={1}
        max={1440}
        disabled={off}
        onCommit={(next) => updateSettings({ forkLettersWindowMinutes: next })}
      />
      <NumberRow
        label={t('fork.letters.settings.loopLabel', 'Loop limit')}
        description={t(
          'fork.letters.settings.loopHelp',
          'Letters each way between two chats in the window that read as a loop; the next is refused.'
        )}
        value={current.loopEach}
        min={2}
        max={100}
        disabled={!current.letters}
        onCommit={(next) => updateSettings({ forkLettersLoopEach: next })}
      />
      <NumberRow
        label={t('fork.letters.settings.openLabel', 'Open asks per chat')}
        description={t('fork.letters.settings.openHelp', 'Asks one chat may have open at once.')}
        value={current.maxOpenPerChat}
        min={1}
        max={100}
        disabled={!current.board}
        onCommit={(next) => updateSettings({ forkBoardMaxOpenPerChat: next })}
      />
      <SettingsRow
        label={t('fork.letters.settings.historyLabel', 'History')}
        description={t(
          'fork.letters.settings.historyHelp',
          'Every letter of the last week, on this host and its paired servers.'
        )}
        control={
          <button
            type="button"
            className="rounded px-1 text-sm underline-offset-2 hover:underline"
            onClick={() => openForkLetters(null)}
          >
            {t('fork.letters.settings.historyOpen', 'Show letters')}
          </button>
        }
      />
    </section>
  )
}
