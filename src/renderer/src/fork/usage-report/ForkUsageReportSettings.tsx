// SLRM-2104 (FORK.md "Usage and cost report"): the report's settings: card pattern, history kept,
// the price table, and a way into the report.
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_USAGE_RETENTION_DEFAULT_DAYS,
  FORK_USAGE_RETENTION_MAX_DAYS,
  forkUsageRetentionDays
} from '../../../../shared/fork/usage-ledger'
import {
  SettingsRow,
  SettingsSubsectionHeader
} from '../../components/settings/form-controls/SettingsFormControls'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'
import { ForkUsagePriceTable } from './ForkUsagePriceTable'
import { openForkUsageReport } from './use-fork-usage-report'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function patternError(pattern: string): string | null {
  try {
    new RegExp(pattern, 'i')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function CardPattern({ settings, updateSettings }: Props): React.JSX.Element {
  const saved = settings.forkUsageCardPattern ?? ''
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? saved
  const error = text.trim() ? patternError(text.trim()) : null
  const commit = () => {
    if (draft !== null && !error) {
      updateSettings({ forkUsageCardPattern: draft.trim() })
    }
    setDraft(null)
  }
  const label = translate('fork.usageReport.setting.card', 'Card pattern')
  return (
    <SettingsRow
      label={label}
      description={
        error
          ? translate(
              'fork.usageReport.setting.cardInvalid',
              'Not a valid regular expression: {{error}}',
              {
                error
              }
            )
          : translate(
              'fork.usageReport.setting.cardHelp',
              'A regular expression over the workspace name (it follows the branch). Group 1, or the whole match, names the card the usage is grouped under. Empty: no cards. Example: ([A-Z]+-\\d+)'
            )
      }
      control={
        <Input
          variant="code"
          className="w-56"
          aria-label={label}
          value={text}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}

export function ForkUsageReportSettings({ settings, updateSettings }: Props): React.JSX.Element {
  const [pricesOpen, setPricesOpen] = useState(false)
  const retentionLabel = translate('fork.usageReport.setting.retention', 'History kept (days)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.usageReport.setting.title', 'Usage report')}
        description={translate(
          'fork.usageReport.setting.description',
          'Tokens and estimated cost of native Claude chats per chat, coordinator, workspace, day or card. Also `orca usage-report`. Counted on this computer only.'
        )}
      />
      <SettingsRow
        label={translate('fork.usageReport.setting.open', 'Usage report')}
        control={
          <Button size="sm" variant="outline" onClick={openForkUsageReport}>
            {translate('fork.usageReport.setting.openButton', 'Open report')}
          </Button>
        }
      />
      <CardPattern settings={settings} updateSettings={updateSettings} />
      <SettingsRow
        label={retentionLabel}
        description={translate(
          'fork.usageReport.setting.retentionHelp',
          'Default {{count}}. Older days are dropped, and at most 2000 chats are kept. Clear history is in the report.',
          { count: FORK_USAGE_RETENTION_DEFAULT_DAYS }
        )}
        control={
          <ForkNumberInput
            value={forkUsageRetentionDays(settings)}
            label={retentionLabel}
            min={1}
            max={FORK_USAGE_RETENTION_MAX_DAYS}
            onCommit={(next) => updateSettings({ forkUsageRetentionDays: next })}
          />
        }
      />
      <SettingsRow
        label={translate('fork.usageReport.setting.prices', 'Prices (estimate)')}
        description={translate(
          'fork.usageReport.setting.pricesHelp',
          "USD per million tokens, per model. Starts from the app's own Claude prices; edit a row to use your own. Your rows are applied flat, without long-context rates."
        )}
        control={
          <Button size="sm" variant="ghost" onClick={() => setPricesOpen((value) => !value)}>
            {pricesOpen
              ? translate('fork.usageReport.setting.hidePrices', 'Hide prices')
              : translate('fork.usageReport.setting.showPrices', 'Edit prices')}
          </Button>
        }
      />
      {pricesOpen ? (
        <ForkUsagePriceTable settings={settings} updateSettings={updateSettings} />
      ) : null}
    </section>
  )
}
