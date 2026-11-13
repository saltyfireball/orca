// Fork launch defaults: the model and effort a worker row carries for its tooltip.
import type { ForkLaunchSource } from './launch-defaults-resolve'

export type ForkAgentRowLaunch = { model?: string; effort?: string; source: ForkLaunchSource }

export function forkAgentRowLaunchEqual(
  a: ForkAgentRowLaunch | undefined,
  b: ForkAgentRowLaunch | undefined
): boolean {
  return a?.model === b?.model && a?.effort === b?.effort && a?.source === b?.source
}
