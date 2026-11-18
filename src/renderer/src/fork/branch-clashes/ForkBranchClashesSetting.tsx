// Branch clashes (FORK.md, SLRM-2394): the settings card. On by default; it only reads git and
// only ever shows a chip.
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_CLASHES_DEFAULT_BEHIND,
  FORK_CLASHES_DEFAULT_INTERVAL_MINUTES,
  FORK_CLASHES_MAX_BEHIND,
  FORK_CLASHES_MAX_INTERVAL_MINUTES,
  FORK_CLASHES_MIN_INTERVAL_MINUTES,
  readForkBranchClashConfig
} from '../../../../shared/fork/branch-clashes'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'
import { refreshForkClashes } from './branch-clashes-client'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkBranchClashesSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readForkBranchClashConfig(settings)
  const intervalLabel = t('fork.branchClashes.setting.interval', 'Check every (minutes)')
  const behindLabel = t('fork.branchClashes.setting.behind', 'Stale after (commits behind)')
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.branchClashes.setting.title', 'Branch clashes')}
        description={t(
          'fork.branchClashes.setting.description',
          'Marks a workspace whose branch changes files another unmerged worktree branch of the same project changes too, on this machine or a paired server, and branches far behind the default branch. It only reads git and never fetches. orca clashes lists them.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.branchClashes.setting.enabled', 'Warn about branch clashes')}
        checked={config.enabled}
        onChange={() => updateSettings({ forkBranchClashes: !config.enabled })}
      />
      <SettingsRow
        label={intervalLabel}
        description={t(
          'fork.branchClashes.setting.intervalHelp',
          'Default {{count}}. Branches whose head has not moved are not read again.',
          { count: FORK_CLASHES_DEFAULT_INTERVAL_MINUTES }
        )}
        control={
          <ForkNumberInput
            value={config.intervalMinutes}
            label={intervalLabel}
            min={FORK_CLASHES_MIN_INTERVAL_MINUTES}
            max={FORK_CLASHES_MAX_INTERVAL_MINUTES}
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkBranchClashesIntervalMinutes: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.branchClashes.setting.uncommitted', 'Count uncommitted changes')}
        description={t(
          'fork.branchClashes.setting.uncommittedHelp',
          'Agents often edit for a while before they commit. Off compares commits only.'
        )}
        checked={config.uncommitted}
        disabled={!config.enabled}
        onChange={() => updateSettings({ forkBranchClashesUncommitted: !config.uncommitted })}
      />
      <SettingsRow
        label={behindLabel}
        description={t(
          'fork.branchClashes.setting.behindHelp',
          'Default {{count}}. A branch this many commits behind the default branch gets the chip too.',
          { count: FORK_CLASHES_DEFAULT_BEHIND }
        )}
        control={
          <ForkNumberInput
            value={config.behindThreshold}
            label={behindLabel}
            min={1}
            max={FORK_CLASHES_MAX_BEHIND}
            disabled={!config.enabled}
            onCommit={(next) => updateSettings({ forkBranchClashesBehindThreshold: next })}
          />
        }
      />
      <SettingsSwitchRow
        label={t('fork.branchClashes.setting.servers', 'Include paired servers')}
        description={t(
          'fork.branchClashes.setting.serversHelp',
          'Each paired server reads its own worktrees and reports them. A project matches across machines by its remote address.'
        )}
        checked={config.pairedServers}
        disabled={!config.enabled}
        onChange={() => updateSettings({ forkBranchClashesPairedServers: !config.pairedServers })}
      />
      <Button size="sm" variant="outline" disabled={!config.enabled} onClick={refreshForkClashes}>
        {t('fork.branchClashes.setting.checkNow', 'Check now')}
      </Button>
    </section>
  )
}
