// The fork services that start once the runtime settles, in the desktop app and `orca serve`
// (`noteAgentLaunchStartupSettled` in `orca-runtime.ts`) and in orcad
// (`core-runtime-activation.ts`). One call per upstream file keeps each hook one line.
import {
  startForkUnattendedResume,
  type UnattendedResumeRuntime
} from './unattended-resume/unattended-resume-service'
import {
  startForkLimitResume,
  type LimitResumeServiceRuntime
} from './limit-resume/limit-resume-service'
import { startForkServerUpdate, type ForkServersRuntime } from './server-update/servers-live'
import { startForkDigest, type ForkDigestRuntime } from './digest/digest-runtime'

export function startForkRuntimeSettleServices(
  runtime: UnattendedResumeRuntime &
    LimitResumeServiceRuntime &
    ForkServersRuntime &
    ForkDigestRuntime
): void {
  // SLRM-2268: continue cut unattended work once per process.
  startForkUnattendedResume(runtime)
  // SLRM-2309: park chats and terminal agents stopped on a usage limit, resume at the reset.
  startForkLimitResume(runtime)
  // SLRM-2310: settle this host's own update (the watchdog waits on it); auto-update servers.
  startForkServerUpdate(runtime)
  // SLRM-2388: send the daily digest when forkDigest is on.
  startForkDigest(runtime)
}
