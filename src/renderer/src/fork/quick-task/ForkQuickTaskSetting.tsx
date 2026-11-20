// Quick task (SLRM-2428, FORK.md): the box's switch and shortcut, the router bot and its agent and
// model, and the placement command the router runs. Main follows the shortcut as it changes.
import React from 'react'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import {
  FORK_QUICK_TASK_BUILT_IN_PLACEMENT,
  FORK_QUICK_TASK_DEFAULT_AGENT,
  FORK_QUICK_TASK_DEFAULT_CLAUDE_MODEL,
  FORK_QUICK_TASK_DEFAULT_ROUTER,
  FORK_QUICK_TASK_DEFAULT_SHORTCUT,
  readForkQuickTaskConfig
} from '../../../../shared/fork/quick-task'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from '../../components/settings/form-controls/SettingsFormControls'
import { useTranslate } from '@/i18n/use-translate'
import { ForkTextSetting } from '../idle-recovery/ForkTextSetting'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function ForkQuickTaskSetting({ settings, updateSettings }: Props): React.JSX.Element {
  const t = useTranslate()
  const config = readForkQuickTaskConfig(settings)
  const off = !config.enabled
  const typed = settings.forkQuickTaskShortcut?.trim()
  const badShortcut = Boolean(typed) && typed!.toLowerCase() !== 'none' && config.shortcut === null
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={t('fork.quickTask.settings.title', 'Quick task')}
        description={t(
          'fork.quickTask.settings.description',
          'A shortcut opens a small box anywhere: type or dictate a task and it goes to a router bot, which hands it to the bot that owns it (on this computer or a paired server) with a machine to run it on. Also `orca quick-task` and the phone.'
        )}
      />
      <SettingsSwitchRow
        label={t('fork.quickTask.settings.enabledLabel', 'Quick task')}
        description={t(
          'fork.quickTask.settings.enabledHelp',
          'The box, its shortcut, the phone and the command. Needs Bots on.'
        )}
        checked={config.enabled}
        onChange={() => updateSettings({ forkQuickTask: off })}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkQuickTaskShortcut"
        label={t('fork.quickTask.settings.shortcutLabel', 'Shortcut')}
        description={
          badShortcut
            ? t(
                'fork.quickTask.settings.shortcutBad',
                'Not a shortcut the box can take: one key with Command, Control or Alt, such as CommandOrControl+Alt+Shift+Space. The box has no shortcut until it is fixed.'
              )
            : t(
                'fork.quickTask.settings.shortcutHelp',
                'Works in any app. An Electron accelerator; empty is the default, none turns it off. If another app holds it, pick another.'
              )
        }
        placeholder={FORK_QUICK_TASK_DEFAULT_SHORTCUT}
        disabled={off}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkQuickTaskRouterBot"
        label={t('fork.quickTask.settings.routerLabel', 'Router bot')}
        description={t(
          'fork.quickTask.settings.routerHelp',
          'The bot each task goes to first, in a new chat. Made the first time a task is sent if no bot has this name.'
        )}
        placeholder={FORK_QUICK_TASK_DEFAULT_ROUTER}
        disabled={off}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkQuickTaskRouterAgent"
        label={t('fork.quickTask.settings.agentLabel', 'Router agent')}
        description={t(
          'fork.quickTask.settings.agentHelp',
          'The agent a new router bot runs on (claude, codex and the other bot agents). An existing bot keeps its own.'
        )}
        placeholder={FORK_QUICK_TASK_DEFAULT_AGENT}
        disabled={off}
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkQuickTaskRouterModel"
        label={t('fork.quickTask.settings.modelLabel', 'Router model')}
        description={t(
          'fork.quickTask.settings.modelHelp',
          "The model a new router bot runs on. Routing reads a list and sends one message, so a small, fast model is enough. Empty: haiku on claude, the agent's default otherwise."
        )}
        placeholder={
          config.routerAgent === FORK_QUICK_TASK_DEFAULT_AGENT
            ? FORK_QUICK_TASK_DEFAULT_CLAUDE_MODEL
            : ''
        }
        disabled={off}
      />
      <SettingsSwitchRow
        label={t('fork.quickTask.settings.placementLabel', 'Suggest a machine')}
        description={t(
          'fork.quickTask.settings.placementHelp',
          'For code work the router runs the placement command and puts its pick in the handoff, so the receiving bot starts its worker there.'
        )}
        checked={config.placementCommand !== null}
        disabled={off}
        onChange={() =>
          updateSettings({ forkQuickTaskPlacement: config.placementCommand === null })
        }
      />
      <ForkTextSetting
        settings={settings}
        updateSettings={updateSettings}
        settingKey="forkQuickTaskPlacementCommand"
        label={t('fork.quickTask.settings.commandLabel', 'Placement command')}
        description={t(
          'fork.quickTask.settings.commandHelp',
          "Any command whose output names the best machine; the router reads it. Runs in the router bot's shell with your rights. Empty: the built-in ranking (orca placement --json)."
        )}
        placeholder={FORK_QUICK_TASK_BUILT_IN_PLACEMENT}
        disabled={off || config.placementCommand === null}
      />
    </section>
  )
}
