// SLRM-2316 test fixture: the spawn of upstream's Node provider supervisor, exactly as
// `spawnProviderProcess` hands it to a spawner that asked for it (chat-survive-legacy-launch.ts).
// Taken from that function itself, so the tests follow whatever upstream makes of the spec.
import type { ProcessSpec } from '@orca/process-host/process-spec'
import type { ProviderProcessLaunch } from '../../provider-process/provider-process-launch'
import {
  spawnProviderProcess,
  type ProviderProcessSpawner
} from '../../provider-process/provider-process-spawn'
import { createProviderSpawnSpec } from '../../provider-process/provider-process-supervisor'
import { markForkLegacyProviderLaunch } from './chat-survive-legacy-launch'

const CAPTURED = new Error('supervisor spec captured')

export function supervisorSpawnSpec(
  launch: ProviderProcessLaunch,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = 'darwin'
): ProcessSpec {
  const seen: ProcessSpec[] = []
  // Nothing is spawned: the spec is all this wants.
  const capture: ProviderProcessSpawner = (spec) => {
    seen.push(spec)
    throw CAPTURED
  }
  markForkLegacyProviderLaunch(capture)
  try {
    spawnProviderProcess(createProviderSpawnSpec(launch, env, platform), capture)
  } catch (error) {
    if (error !== CAPTURED) {
      throw error
    }
  }
  const [spec] = seen
  if (!spec) {
    throw new Error('the provider spawn never reached its spawner')
  }
  return spec
}
