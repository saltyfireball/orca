import '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { AgentSessionPreSpawnError } from '../../native-chat/agent-session-wire/providers/structured-agent-session-adapter-errors'
import type { AcpLaunchSpec } from './acp-launch-contract'

/** Refuses, before anything spawns, a saved model the launched release cannot run. */
export function assertAcpLaunchRunsModel(
  spec: Pick<AcpLaunchSpec, 'refuseModel'>,
  model: string | undefined,
  version: string | null
): void {
  const refusal = model ? spec.refuseModel?.(model, version) : null
  if (refusal) {
    throw new AgentSessionPreSpawnError(new Error(refusal), { reason: 'launchPreparationFailed' })
  }
}
