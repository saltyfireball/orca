// Approval triage (FORK.md, SLRM-2397) settings: both off by default. Agents cannot turn them on
// through `orca settings` (agent-limit keys).
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkApprovalTriageSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const risk = settings.forkApprovalRisk === true
  const bulk = settings.forkApprovalBulkAllowLow === true
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.approvalTriage.title', 'Approval triage')}
        description={t(
          'fork.approvalTriage.description',
          'Low is only reading inside the workspace or editing an ordinary file in it. Writing outside it, the network, deleting, git and GitHub writes and credentials are high or medium, and so is anything it cannot read.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.approvalTriage.riskLabel', 'Show risk on approvals')}
        description={t(
          'fork.approvalTriage.riskHelp',
          'A chat approval card, and a worker approval in its coordinator, shows Low, Medium or High risk and why. A high risk card cannot be allowed for the whole session.'
        )}
        checked={risk}
        onChange={() => updateSettings({ forkApprovalRisk: !risk })}
      />
      <SettingsSwitchRow
        label={t('fork.approvalTriage.bulkLabel', 'Allow low risk in one click')}
        description={t(
          'fork.approvalTriage.bulkHelp',
          'Over the worker approvals pinned in a coordinator chat: Allow low risk allows every one that is still low when clicked. Medium and high stay one at a time.'
        )}
        checked={bulk}
        disabled={!risk}
        onChange={() => updateSettings({ forkApprovalBulkAllowLow: !bulk })}
      />
    </section>
  )
}
