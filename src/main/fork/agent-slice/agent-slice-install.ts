// Agent slice limits (BAD-684, FORK.md): the daemon's one hook, called once after the terminal
// scopes resolve. Logs `agent-slice` once, whether the limits applied or why they did not.
import { runProcessSync } from '@orca/process-host'
import { userManagerEnv } from '../../daemon/process-scopes/daemon-cgroup-scope'
import type { TerminalScopeResolution } from '../../daemon/process-scopes/terminal-scopes'
import {
  applyAgentSliceLimits,
  readAgentSliceFacts,
  requestedAgentSliceLimits
} from './agent-slice-limits'

type DaemonLog = (event: string, details?: Record<string, unknown>) => void

export function forkApplyAgentSlice(
  resolved: TerminalScopeResolution,
  log: DaemonLog,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'linux') {
    return
  }
  try {
    const request = requestedAgentSliceLimits(env, readAgentSliceFacts())
    if (!request) {
      return
    }
    if (!('on' in resolved.scopes)) {
      log('agent-slice', { applied: [], reason: `terminal scopes off: ${resolved.scopes.off}` })
      return
    }
    const managerEnv = userManagerEnv(env)
    const report = applyAgentSliceLimits({
      slice: resolved.scopes.on.slice,
      sliceCgroupPath: resolved.scopes.on.sliceCgroupPath,
      request,
      run: (args) =>
        runProcessSync({ program: 'systemctl', args, env: managerEnv, timeoutMs: 1_500 })
    })
    log('agent-slice', { slice: resolved.scopes.on.slice, ...report })
  } catch (error) {
    log('agent-slice', { applied: [], reason: String(error) })
  }
}
