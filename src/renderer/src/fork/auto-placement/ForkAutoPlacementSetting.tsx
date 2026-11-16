// Auto placement (FORK.md, SLRM-2266) settings: each machine's placement, and whether a start
// that names no machine is placed as `auto` would. The CLI reads them through fork.placement.pick.
import type React from 'react'
import { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_PLACEMENT_LOCAL_KEY,
  FORK_PLACEMENT_PREFERENCES,
  forkPlacementAutoWhenUnnamed,
  forkPlacementFor,
  isForkPlacementPreference,
  withForkPlacement,
  type ForkPlacementPreference
} from '../../../../shared/fork/auto-placement'
import {
  SettingsRow,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '@/components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'

type ForkAutoPlacementSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function preferenceLabel(preference: ForkPlacementPreference, t: Translate = translate): string {
  switch (preference) {
    case 'prefer':
      return t('fork.autoPlacement.prefer', 'Prefer')
    case 'less':
      return t('fork.autoPlacement.less', 'Less often')
    case 'manual':
      return t('fork.autoPlacement.manual', 'Manual only')
    default:
      return t('fork.autoPlacement.normal', 'Normal')
  }
}

function MachineRow({
  hostKey,
  label,
  settings,
  updateSettings
}: ForkAutoPlacementSettingProps & { hostKey: string; label: string }): React.JSX.Element {
  const t = useTranslate()
  const labelId = useId()
  return (
    <SettingsRow
      label={label}
      labelId={labelId}
      control={
        <Select
          value={forkPlacementFor(settings, hostKey)}
          onValueChange={(value) => {
            if (isForkPlacementPreference(value)) {
              updateSettings({ forkPlacement: withForkPlacement(settings, hostKey, value) })
            }
          }}
        >
          <SelectTrigger size="sm" className="min-w-32" aria-labelledby={labelId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORK_PLACEMENT_PREFERENCES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {preferenceLabel(choice, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

export function ForkAutoPlacementSetting(props: ForkAutoPlacementSettingProps): React.JSX.Element {
  const { settings, updateSettings } = props
  const t = useTranslate()
  const environments = useAppStore((state) => state.runtimeEnvironments) ?? []
  const unnamed = forkPlacementAutoWhenUnnamed(settings)
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.autoPlacement.title', 'Auto placement')}
        description={t(
          'fork.autoPlacement.description',
          'With --on auto (orchestration worker-start) or --host auto (worktree create), new work starts on the machine with the most spare CPU and memory. Each machine below says how willingly it takes that work; a machine you name yourself is always used.'
        )}
      />
      <MachineRow
        {...props}
        hostKey={FORK_PLACEMENT_LOCAL_KEY}
        label={t('fork.autoPlacement.thisMachine', 'This machine')}
      />
      {environments.map((environment) => (
        <MachineRow
          key={environment.id}
          {...props}
          hostKey={`runtime:${environment.id}`}
          label={environment.name}
        />
      ))}
      <SettingsSwitchRow
        label={t('fork.autoPlacement.unnamedLabel', 'Pick a machine when none is named')}
        description={t(
          'fork.autoPlacement.unnamedHelp',
          'A worktree create for a project set up on more than one machine, or a worker started in a new worktree with --repo, is placed as auto would place it instead of asking or staying here. Paired servers need a Blackfish with the load probe; others are skipped.'
        )}
        checked={unnamed}
        onChange={() => updateSettings({ forkPlacementAutoWhenUnnamed: !unnamed })}
      />
    </section>
  )
}
