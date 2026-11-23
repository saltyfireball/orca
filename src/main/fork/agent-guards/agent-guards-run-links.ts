// Agent guards (FORK.md, BAD-766): wires the Run index to what links a worker to its coordinator.
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { createDurableRunLinks } from './agent-guards-durable-links'
import {
  setAgentGuardDurableLinks,
  setAgentGuardTerminalLinks,
  type AgentGuardTerminalLinks
} from './agent-guards-run-index'

/** The live terminals' handles, and the orchestration database that outlives a restart. */
export function installAgentGuardRunLinks(
  terminals: AgentGuardTerminalLinks,
  getDb: () => OrchestrationDb | null
): void {
  setAgentGuardTerminalLinks(terminals)
  setAgentGuardDurableLinks(createDurableRunLinks(getDb))
}
