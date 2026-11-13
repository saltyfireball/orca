// Agent state colors (FORK.md) settings. Ships off, since it changes how tabs and rows look.
import React, { useId } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  FORK_AGENT_COLOR_STATES,
  FORK_AGENT_THEME_COLOR_IDS,
  forkAgentColorChoiceCss,
  forkAgentStateColorChoice,
  forkAgentStateColorsEnabled,
  forkAgentStateColorsStrength,
  forkAgentStateColorsWhere,
  type ForkAgentColorState,
  type ForkAgentStateColorStrength,
  type ForkAgentStateColorWhere,
  type ForkAgentThemeColor
} from '../../../../shared/fork/agent-state-color'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { translate } from '@/i18n/i18n'
import { normalizeHexColor } from '../agent-row-tab-tint/agent-row-tab-tint'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const CUSTOM = 'custom'
/** The first color a switch to Custom starts from. */
const CUSTOM_START = '#3b82f6'

function stateLabel(state: ForkAgentColorState): string {
  switch (state) {
    case 'needsYou':
      return translate('fork.agentStateColors.state.needsYou', 'Needs you')
    case 'stalled':
      return translate('fork.agentStateColors.state.stalled', 'Stalled')
    case 'working':
      return translate('fork.agentStateColors.state.working', 'Working')
    case 'queued':
      return translate('fork.agentStateColors.state.queued', 'Queued')
    case 'unread':
      return translate('fork.agentStateColors.state.unread', 'Unread')
    case 'done':
      return translate('fork.agentStateColors.state.done', 'Done')
    case 'asleep':
      return translate('fork.agentStateColors.state.asleep', 'Asleep')
  }
}

function themeColorLabel(id: ForkAgentThemeColor): string {
  switch (id) {
    case 'blue':
      return translate('fork.agentStateColors.color.blue', 'Theme blue')
    case 'yellow':
      return translate('fork.agentStateColors.color.yellow', 'Theme yellow')
    case 'green':
      return translate('fork.agentStateColors.color.green', 'Theme green')
    case 'red':
      return translate('fork.agentStateColors.color.red', 'Theme red')
    case 'accent':
      return translate('fork.agentStateColors.color.accent', 'Theme accent')
    case 'muted':
      return translate('fork.agentStateColors.color.muted', 'Theme muted')
  }
}

function Swatch({ css }: { css: string | null }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-full border border-border"
      style={css ? { backgroundColor: css } : undefined}
    />
  )
}

function StateColorRow({
  state,
  settings,
  disabled,
  onPick
}: {
  state: ForkAgentColorState
  settings: GlobalSettings
  disabled: boolean
  onPick: (state: ForkAgentColorState, choice: string) => void
}): React.JSX.Element {
  const labelId = useId()
  const choice = forkAgentStateColorChoice(settings, state)
  const isCustom = choice.startsWith('#')
  return (
    <SettingsRow
      label={stateLabel(state)}
      labelId={labelId}
      control={
        <div className="flex items-center gap-2">
          {isCustom ? (
            <input
              type="color"
              value={normalizeHexColor(choice) ?? CUSTOM_START}
              disabled={disabled}
              aria-label={translate('fork.agentStateColors.customPicker', 'Custom color')}
              onChange={(event) => onPick(state, event.target.value)}
              className="h-7 w-9 rounded-md border border-input bg-transparent p-0.5"
            />
          ) : null}
          <Select
            value={isCustom ? CUSTOM : choice}
            disabled={disabled}
            onValueChange={(value) => onPick(state, value === CUSTOM ? CUSTOM_START : value)}
          >
            <SelectTrigger size="sm" className="min-w-36" aria-labelledby={labelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <Swatch css={null} />
                {translate('fork.agentStateColors.color.none', 'None')}
              </SelectItem>
              {FORK_AGENT_THEME_COLOR_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  <Swatch css={forkAgentColorChoiceCss(id)} />
                  {themeColorLabel(id)}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>
                <Swatch css={isCustom ? choice : null} />
                {translate('fork.agentStateColors.color.custom', 'Custom')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    />
  )
}

export function ForkAgentStateColorSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const enabled = forkAgentStateColorsEnabled(settings)
  const where = forkAgentStateColorsWhere(settings)
  const strength = forkAgentStateColorsStrength(settings)
  const whereId = useId()
  const strengthId = useId()
  const pick = (state: ForkAgentColorState, choice: string): void =>
    updateSettings({
      forkAgentStateColorsByState: { ...settings.forkAgentStateColorsByState, [state]: choice }
    })
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('fork.agentStateColors.title', 'Agent state colors')}
        description={translate(
          'fork.agentStateColors.description',
          'Color a tab and its sidebar agent row by what the agent is doing. The state icons stay as they are, and a color you set on a tab yourself always wins.'
        )}
      />
      <SettingsSwitchRow
        label={translate('fork.agentStateColors.label', 'Color by agent state')}
        checked={enabled}
        onChange={() => updateSettings({ forkAgentStateColors: !enabled })}
      />
      <SettingsRow
        label={translate('fork.agentStateColors.whereLabel', 'Show on')}
        labelId={whereId}
        control={
          <SettingsSegmentedControl<ForkAgentStateColorWhere>
            size="sm"
            ariaLabelledBy={whereId}
            value={where}
            onChange={(value) => updateSettings({ forkAgentStateColorsWhere: value })}
            options={[
              { value: 'both', label: translate('fork.agentStateColors.where.both', 'Both') },
              { value: 'tab', label: translate('fork.agentStateColors.where.tab', 'Tabs') },
              { value: 'row', label: translate('fork.agentStateColors.where.row', 'Rows') }
            ]}
          />
        }
      />
      <SettingsRow
        label={translate('fork.agentStateColors.strengthLabel', 'Style')}
        description={translate(
          'fork.agentStateColors.strengthHelp',
          'A thin edge stripe, or the stripe with a soft wash of the color.'
        )}
        labelId={strengthId}
        control={
          <SettingsSegmentedControl<ForkAgentStateColorStrength>
            size="sm"
            ariaLabelledBy={strengthId}
            value={strength}
            onChange={(value) => updateSettings({ forkAgentStateColorsStrength: value })}
            options={[
              {
                value: 'accent',
                label: translate('fork.agentStateColors.strength.accent', 'Stripe')
              },
              { value: 'tint', label: translate('fork.agentStateColors.strength.tint', 'Tinted') }
            ]}
          />
        }
      />
      {FORK_AGENT_COLOR_STATES.map((state) => (
        <StateColorRow
          key={state}
          state={state}
          settings={settings}
          disabled={!enabled}
          onPick={pick}
        />
      ))}
    </section>
  )
}
