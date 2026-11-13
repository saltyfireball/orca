// Fork launch defaults (FORK.md "Launch defaults"): what `orca agent launch` and worker-start
// print about the model a launch runs. Kept apart from the lazily loaded handler group.
import { describeForkLaunchChoice } from '../../shared/fork/launch-defaults/launch-defaults-resolve'

/** The model line `orca agent launch` prints, from the `forkLaunch` a fork host attaches. */
export function forkAgentLaunchLines(result: object): string[] {
  const choice = (result as { forkLaunch?: Parameters<typeof describeForkLaunchChoice>[0] })
    .forkLaunch
  return choice && typeof choice === 'object' ? [`model: ${describeForkLaunchChoice(choice)}`] : []
}

/** worker-start's `modelFrom` field: set when the worker default chose the model. */
export function forkWorkerModelFrom(launch: unknown): string | undefined {
  return launch && typeof launch === 'object' && 'forkDefault' in launch
    ? 'worker launch default'
    : undefined
}
