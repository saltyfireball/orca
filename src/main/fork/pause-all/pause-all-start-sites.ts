// Pause all (BAD-818, FORK.md "Pause all"): each call of a start primitive outside tests, and the
// row of `PAUSE_ALL_STARTERS` it belongs to, one entry per call. `pause-all-starters.test.ts` fails
// when the code calls a primitive somewhere this list does not name.
import {
  PAUSE_ALL_PERSON_STARTER as PERSON,
  type PauseAllStartPrimitive
} from './pause-all-starters'

const M = 'src/main/'
const SITES: readonly [file: string, primitive: PauseAllStartPrimitive, starter: string][] = [
  [`${M}agent-launch/startup-agent-worktree-create.ts`, 'executeAgentLaunch', PERSON],
  [`${M}automations/automation-chain-start.ts`, 'runForEvent', 'automations'],
  [`${M}automations/automation-service.ts`, 'runForEvent', 'automations'],
  [`${M}automations/bot-automation-launch.ts`, 'startConversation', 'automations'],
  [`${M}bots/bot-group-automation-run.ts`, 'deliverTurn', 'automations'],
  [`${M}bots/bot-group-delivery.ts`, 'deliverTurn', PERSON],
  [`${M}bots/bot-group-delivery.ts`, 'deliverTurn', 'pending-room-turns'],
  [`${M}bots/bot-group-mention-handoffs.ts`, 'deliverTurn', 'room-handoffs'],
  [`${M}bots/bot-look-around-runner.ts`, 'startConversation', 'look-around'],
  [`${M}bots/bot-memory-tidy-up-runner.ts`, 'startConversation', 'tidy-up'],
  [`${M}connector-cloud/connector-cloud-install.ts`, 'seam.send', 'pr-waker'],
  [`${M}connector-cloud/connector-deliveries.ts`, 'seam.start', 'connector-turns'],
  [`${M}connector-cloud/connector-deliveries.ts`, 'seam.send', 'connector-turns'],
  [`${M}fork/bot-room-hops/bot-room-hop-inbox.ts`, 'handOffGroupMentions', PERSON],
  [`${M}fork/chat-handoff/chat-handoff-on-limit.ts`, 'forkChatHandoffService', 'limit-handoff'],
  [`${M}fork/own-pr-loop/own-pr-loop-guard.ts`, 'runForEvent', 'automations'],
  [`${M}fork/own-pr-loop/own-pr-loop-guard.ts`, 'runForEvent', 'automations'],
  [`${M}fork/pause-all/pause-all-room-release.ts`, 'handOffGroupMentions', 'room-handoffs'],
  [`${M}google/google-trigger-checker.ts`, 'runForEvent', 'automations'],
  [
    `${M}runtime/integrations/automations/runtime-automation-controller.ts`,
    'runForEvent',
    'automations'
  ],
  [
    `${M}runtime/orchestration/legacy-remote/federated-worker-agent-launch.ts`,
    'executeAgentLaunch',
    'legacy-attach'
  ],
  [
    `${M}runtime/orchestration/legacy-remote/federation.ts`,
    'launchFederatedWorkerAgent',
    'legacy-attach'
  ],
  [`${M}runtime/rpc/methods/agent-launch/agent-launch.ts`, 'executeAgentLaunch', PERSON],
  [`${M}runtime/rpc/methods/fork/fork-chat-handoff.ts`, 'forkChatHandoffService', PERSON],
  [
    `${M}runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement.ts`,
    'executeAgentLaunch',
    'terminal-worker-start'
  ],
  [`${M}runtime/workspaces/persisted-surfaces/webhook-operations.ts`, 'runForEvent', 'automations'],
  [`${M}webhooks/webhook-call-runs.ts`, 'runForEvent', 'automations']
]

export const PAUSE_ALL_START_SITES = SITES.map(([file, primitive, starter]) => ({
  file,
  primitive,
  starter
}))
