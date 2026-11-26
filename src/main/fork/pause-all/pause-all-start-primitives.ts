// Pause all (BAD-818, FORK.md "Pause all"): the names `pause-all-starters.test.ts` looks for in the
// code. A call of a gate function counts toward its file's gates in `PAUSE_ALL_STARTERS`; each call
// of a start primitive must be listed in `pause-all-start-sites.ts` with the starter it belongs to.

/** The functions that read the switch for a gate; a call of any counts toward its file's gates. */
export const PAUSE_ALL_GATE_FUNCTIONS = [
  'isForkPauseAllEngaged',
  'forkPauseAllRefusal',
  'forkRefuseTerminalWorkerWhilePaused',
  'assertForkPauseAllAllowsTerminalWorkerStart',
  'forkPauseAllSkipsScheduledRun',
  'forkPauseAllHoldsRoomHandOff',
  'forkPauseAllHoldsBotMail',
  'forkPauseAllRefusesConnectorTurn',
  'forkPauseAllHoldsLimitHandoff'
] as const

/** Calls that start agent work: a conversation, a launch, a room turn, an event run, a hand-off,
 *  a connector turn, a chat handoff or a legacy attach; or that get idle recovery's guarded send
 *  into an idle chat or terminal agent (its ports). */
export const PAUSE_ALL_START_PRIMITIVES = [
  'startConversation',
  'executeAgentLaunch',
  'deliverTurn',
  'runForEvent',
  'handOffGroupMentions',
  'seam.start',
  'seam.send',
  'forkChatHandoffService',
  'launchFederatedWorkerAgent',
  'idleRecoveryChatPort',
  'idleRecoveryTerminalPort',
  'idleRecoveryPorts'
] as const

export type PauseAllStartPrimitive = (typeof PAUSE_ALL_START_PRIMITIVES)[number]
