// Fork launch defaults (FORK.md "Launch defaults"): a worker row's tooltip names the model and
// effort the worker started on, and says when they came from the worker default.
import type { ForkAgentRowLaunch } from '../../../../shared/fork/launch-defaults/launch-defaults-row'
import { translate } from '@/i18n/i18n'

export function forkAgentRowLaunchLine(launch: ForkAgentRowLaunch | undefined): string | undefined {
  if (!launch?.model) {
    return undefined
  }
  const what = launch.effort
    ? translate('fork.launchDefaults.rowModelEffort', 'Model {{model}}, effort {{effort}}', {
        model: launch.model,
        effort: launch.effort
      })
    : translate('fork.launchDefaults.rowModel', 'Model {{model}}', { model: launch.model })
  return launch.source === 'fork-default'
    ? translate('fork.launchDefaults.rowFromDefault', '{{what}} (worker default)', { what })
    : what
}

/** The row's tooltip with the launch line appended. */
export function forkAgentRowTitle(title: string, launch: ForkAgentRowLaunch | undefined): string {
  const line = forkAgentRowLaunchLine(launch)
  return line ? `${title}\n${line}` : title
}
