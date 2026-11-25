import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { RpcContext } from '../../../core'
import { orchestrationCallerIdentity } from '../runs/run-scope'

/** Who an `orchestration.send` is from: the hook's attested caller, and the identity its mail leaves under. */
export function sendSenderIdentity(
  runtime: OrcaRuntimeService,
  from: string,
  context: Partial<
    Pick<RpcContext, 'orchestrationCompatibilityCallerAuthority' | 'orchestrationCaller'>
  >
) {
  const { orchestrationCompatibilityCallerAuthority: authority, orchestrationCaller } = context
  const attestedCaller = authority?.terminalHandle === from ? authority : undefined
  // Why: attested hook identity survives graph remount; caller params never supply lifecycle authority.
  const sender = orchestrationCallerIdentity(runtime, {
    handle: from,
    session: orchestrationCaller,
    paneKey: attestedCaller?.paneKey ?? runtime.getTerminalPaneKey(from)
  })
  return { attestedCaller, sender }
}
