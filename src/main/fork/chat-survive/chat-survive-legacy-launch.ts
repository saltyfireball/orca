// SLRM-2316: upstream 1.4.262 starts a supervised provider through its native launcher
// (orca-provider-exec) and keeps the Node `-e` supervisor as its fallback. A chat-survive broker
// runs that Node supervisor, and an adopted broker stands in for it, so a spawn that will run
// under a broker (or take one over) asks for the fallback. Every other spawn stays native.
import type { ProviderProcessSpawner } from '../../provider-process/provider-process-spawn'

const legacySpawners = new WeakSet<ProviderProcessSpawner>()

/** Marks a spawner whose provider must start through upstream's Node supervisor. */
export function markForkLegacyProviderLaunch(spawner: ProviderProcessSpawner): void {
  legacySpawners.add(spawner)
}

/** The hook in `spawnProviderProcess`: true keeps this spawn off the native launcher. */
export function forkLegacyProviderLaunch(spawner: ProviderProcessSpawner | undefined): boolean {
  return spawner !== undefined && legacySpawners.has(spawner)
}
