// FORK.md "Agent profiles" (BAD-800): `automations create --profile` fails closed at the caller. A
// host path that drops the MCP profile would leave an automation whose runs load every server, so
// the CLI checks the answer, removes what it made and refuses loudly.
import type { Automation } from '../../shared/automations/automation-definition'
import { RuntimeClientError } from '../runtime/connection/types'
import type { RuntimeClient } from '../runtime/client'

export async function assertForkAutomationMcpProfileCreated(
  writer: RuntimeClient,
  requested: string | undefined,
  automation: Pick<Automation, 'id' | 'name' | 'forkMcpProfile'> | undefined
): Promise<void> {
  if (!requested || !automation || automation.forkMcpProfile === requested) {
    return
  }
  const lost = `The host created automation "${automation.name}" (${automation.id}) without MCP profile "${requested}", so its runs would load every server.`
  try {
    await writer.call('automation.delete', { id: automation.id })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError(
      'incompatible_runtime',
      `${lost} Removing it failed (${reason}): remove it with \`orca automations remove --id ${automation.id}\` before it runs.`
    )
  }
  throw new RuntimeClientError(
    'incompatible_runtime',
    `${lost} It was removed. Update Orca on that host and create it again.`
  )
}
