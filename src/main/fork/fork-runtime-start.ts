// The fork's start-up hooks that run wherever a chat host runs: the desktop and `orca serve` call
// this from the runtime's start-up settle, orcad after its RPC server starts. One call in each of
// those upstream files, so a new hook is added here and not there.
import {
  startForkUnattendedResume,
  type UnattendedResumeRuntime
} from './unattended-resume/unattended-resume-service'
import { startForkServerUpdate, type ForkServersRuntime } from './server-update/servers-live'

export function startForkRuntimeHooks(runtime: UnattendedResumeRuntime & ForkServersRuntime): void {
  // SLRM-2268: continue the turns a restart cut in chats nobody is watching.
  startForkUnattendedResume(runtime)
  // SLRM-2310: settle this host's own update (the watchdog waits on it); auto-update servers.
  startForkServerUpdate(runtime)
}
