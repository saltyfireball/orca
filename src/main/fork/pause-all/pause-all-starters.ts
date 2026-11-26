// Pause all (BAD-685, BAD-799, BAD-818; FORK.md "Pause all"): every starter of agent work and its
// answer while the switch is engaged. held: waits, and goes on once at resume-all. refused: the
// caller is told why. skipped: recorded with the reason and not caught up. allowed: runs, for the
// reason given (a person asked, or the work is already running). `pause-all-starters.test.ts` reads
// the code against this table: each gate's calls must be where it says, and each call of a start
// primitive must belong to a row here (`pause-all-start-sites.ts`).

export type PauseAllAnswer = 'held' | 'refused' | 'skipped' | 'allowed'

/** A file that asks the switch, and how many calls of a gate function it makes. */
export type PauseAllGate = { file: string; calls: number }

export type PauseAllStarter = {
  id: string
  starter: string
  answer: PauseAllAnswer
  reason: string
  /** Where it reads the switch; empty only for allowed rows. */
  gates: PauseAllGate[]
  /** Where the server (orcad, no desktop app) runs it; every row with a gate says. */
  orcad?: PauseAllOrcadReach
}

/** `from` is a file orcad loads from its start-up (src/main/backend/core-runtime-activation.ts) and
 *  `call` the call there that installs or reaches the starter; or the starter does not run on orcad,
 *  and `start`, the call that starts it, is made by no file orcad loads. */
export type PauseAllOrcadReach = { from: string; call: string } | { notRun: string; start: string }

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
 *  a connector turn, a chat handoff or a legacy attach. */
export const PAUSE_ALL_START_PRIMITIVES = [
  'startConversation',
  'executeAgentLaunch',
  'deliverTurn',
  'runForEvent',
  'handOffGroupMentions',
  'seam.start',
  'seam.send',
  'forkChatHandoffService',
  'launchFederatedWorkerAgent'
] as const

export type PauseAllStartPrimitive = (typeof PAUSE_ALL_START_PRIMITIVES)[number]

export const PAUSE_ALL_PERSON_STARTER = 'person'
const PERSON = PAUSE_ALL_PERSON_STARTER

export const PAUSE_ALL_STARTERS: readonly PauseAllStarter[] = [
  {
    id: 'automations',
    starter:
      'Scheduled and event automations: schedules, connector and Google triggers, webhooks, pull request events, run-ended chains, own pull request loops, automations in bot rooms',
    answer: 'skipped',
    reason: "Recorded as a skipped run with the reason in run history; Run now is a person's.",
    gates: [{ file: 'src/main/automations/dispatch/automation-dispatch-request.ts', calls: 1 }],
    orcad: {
      from: 'src/main/orcad/host-runtime/orcad-automations.ts',
      call: 'createRuntimeAutomationService'
    }
  },
  {
    id: 'idle-recovery',
    starter: 'Idle recovery sweep and wakes',
    answer: 'skipped',
    reason: 'Reads, classifies and wakes nothing.',
    gates: [
      { file: 'src/main/fork/idle-recovery/idle-recovery-sweep.ts', calls: 1 },
      { file: 'src/main/fork/idle-recovery/idle-recovery-wake.ts', calls: 1 }
    ],
    orcad: {
      notRun: 'Idle recovery is a desktop service; the server starts no sweep.',
      start: 'startForkIdleRecovery'
    }
  },
  {
    id: 'pr-babysit',
    starter: 'PR babysitter fix requests and merges',
    answer: 'skipped',
    reason: 'Sends no fix request and merges nothing.',
    gates: [{ file: 'src/main/fork/pr-babysit/pr-babysit-core.ts', calls: 2 }],
    orcad: { from: 'src/main/fork/headless-host.ts', call: 'installForkPrBabysit' }
  },
  {
    id: 'pr-nudge',
    starter: 'PR nudges',
    answer: 'skipped',
    reason: 'Sends nothing.',
    gates: [{ file: 'src/main/fork/pr-nudge/pr-nudge-service.ts', calls: 1 }],
    orcad: { from: 'src/main/fork/headless-host.ts', call: 'installForkPrNudge' }
  },
  {
    id: 'limit-resume',
    starter: 'Limit resume of parked chats and terminals',
    answer: 'held',
    reason: "They stay parked; `orca limits resume-now` is a person's.",
    gates: [
      { file: 'src/main/fork/limit-resume/limit-resume-native.ts', calls: 1 },
      { file: 'src/main/fork/limit-resume/limit-resume-service.ts', calls: 1 }
    ],
    orcad: { from: 'src/main/fork/runtime-settle-hooks.ts', call: 'startForkLimitResume' }
  },
  {
    id: 'auto-continue',
    starter: 'Automatic continue of chats after a restart',
    answer: 'skipped',
    reason: 'Continues no chat.',
    gates: [{ file: 'src/main/fork/auto-continue/auto-continue-chats.ts', calls: 1 }],
    orcad: {
      from: 'src/main/runtime/orchestration/terminal-authority/legacy-worker-runtime-recovery.ts',
      call: 'forkAutoContinueForRuntime'
    }
  },
  {
    id: 'goal-steps',
    starter: 'Goal loop steps',
    answer: 'held',
    reason: 'The step waits and is looked at again.',
    gates: [{ file: 'src/main/fork/goal-loop/goal-service.ts', calls: 1 }],
    orcad: { from: 'src/main/fork/runtime-settle-hooks.ts', call: 'startForkGoalLoop' }
  },
  {
    id: 'worker-retry',
    starter: 'Worker retries',
    answer: 'held',
    reason: 'A due retry stays scheduled and is looked at again every 30 seconds.',
    gates: [{ file: 'src/main/fork/worker-retry/worker-retry-live.ts', calls: 1 }],
    orcad: {
      from: 'src/main/runtime/orchestration/db/runtime-orchestration-database-access.ts',
      call: 'installForkWorkerRetry'
    }
  },
  {
    id: 'chat-worker-launch',
    starter: 'Chat worker launches',
    answer: 'held',
    reason:
      'They wait in the agent launch queue with "paused by pause-all" as the held reason; a launch held when the host restarts is noted on disk and starts once at resume-all.',
    gates: [{ file: 'src/main/fork/agent-queue/agent-queue-service.ts', calls: 2 }],
    orcad: { from: 'src/main/fork/headless-host.ts', call: 'installForkAgentQueue' }
  },
  {
    id: 'terminal-worker-start',
    starter: 'Terminal worker starts (worker-start that launches a terminal agent)',
    answer: 'refused',
    reason:
      'A terminal agent has no provider start for the queue to hold, so the start is refused with the reason before any Task or Dispatch is written.',
    gates: [
      {
        file: 'src/main/runtime/rpc/methods/orchestration/worker/start/local-worker-start.ts',
        calls: 1
      },
      {
        file: 'src/main/runtime/rpc/methods/orchestration/worker/start/placement/worker-start-agent-placement.ts',
        calls: 2
      }
    ],
    orcad: {
      from: 'src/main/runtime/rpc/methods/orchestration/worker/worker-start-method.ts',
      call: 'startLocalWorker'
    }
  },
  {
    id: 'terminal-worker-restart-resume',
    starter: 'Restart resume of terminal workers',
    answer: 'held',
    reason: 'Offered with the reason; resume-all resumes exactly those, once.',
    gates: [{ file: 'src/main/fork/pause-all/pause-all-restart-holds.ts', calls: 2 }],
    orcad: {
      from: 'src/main/runtime/construction/orca-runtime-terminal-worker-restart-resume.ts',
      call: 'ForkPauseAllRestartHolds'
    }
  },
  {
    id: 'card-routing',
    starter: 'Card routing to a bot',
    answer: 'refused',
    reason: 'The route is refused with the reason.',
    gates: [{ file: 'src/main/fork/card-routing/card-route-start.ts', calls: 1 }],
    orcad: {
      from: 'src/main/runtime/rpc/methods/fork/fork-quick-task.ts',
      call: 'runtimeCardChatStart'
    }
  },
  {
    id: 'look-around',
    starter: 'Bot Look around on its schedule',
    answer: 'skipped',
    reason:
      "The due slot is recorded in the look history with the reason and used up; the next look is the next slot, not a catch-up at resume. Look now is a person's.",
    gates: [{ file: 'src/main/bots/bot-look-around-runner.ts', calls: 2 }],
    orcad: { from: 'src/main/bots/bot-look-around-runtime.ts', call: 'runtimeLookAroundRunner' }
  },
  {
    id: 'tidy-up',
    starter: 'Bot memory Tidy-up on its night',
    answer: 'skipped',
    reason:
      "The night is recorded in the tidy-up history with the reason and used up; the next night runs. Tidy now is a person's.",
    gates: [{ file: 'src/main/bots/bot-memory-tidy-up-runner.ts', calls: 2 }],
    orcad: { from: 'src/main/bots/bot-look-around-runtime.ts', call: 'runtimeTidyUpRunner' }
  },
  {
    id: 'room-handoffs',
    starter: 'Bot-to-bot hand-offs in rooms (a reply naming another member)',
    answer: 'held',
    reason:
      "Saved beside the room store with a line in the speaker's chat; resume-all lets each go on once, oldest first, also after a restart.",
    gates: [{ file: 'src/main/bots/bot-group-mention-handoffs.ts', calls: 1 }],
    orcad: { from: 'src/main/bots/bot-group-latest.ts', call: 'handOffGroupMentions' }
  },
  {
    id: 'bot-mail',
    starter:
      "Mail that wakes a bot: orchestration mail to a bot's own chats and room member chats (other bots, workers' reports, services, item changes)",
    answer: 'held',
    reason:
      "It stays unread in the orchestration database, in order, and resume-all redrives those chats once, also after a restart. The hold is per chat: an owner's item comment or answer waits too, and its chat says so; pause-status counts held mail.",
    gates: [{ file: 'src/main/bots/bot-paused-mail.ts', calls: 1 }],
    orcad: { from: 'src/main/bots/bot-group-runtime.ts', call: 'pausedBotChatHoldsMail' }
  },
  {
    id: 'connector-turns',
    starter: 'Inbound connector messages to a bot (a mention, a DM, a comment addressed to it)',
    answer: 'refused',
    reason:
      'The cloud cannot hold a delivery past its deadline, so it is refused as bot_paused, which the cloud tells the asker; its receipt keeps the refusal, so a resend never runs it. Events that only start an automation are skipped as automations.',
    gates: [{ file: 'src/main/external-conversations/external-conversation-bots.ts', calls: 1 }],
    orcad: {
      from: 'src/main/external-conversations/external-conversation-seam.ts',
      call: 'botChatFor'
    }
  },
  {
    id: 'limit-handoff',
    starter: 'Automatic chat handoff on a usage limit (forkChatHandoffOnLimit auto)',
    answer: 'held',
    reason: 'Not marked answered; resume-all hands off the stops still parked then, once.',
    gates: [{ file: 'src/main/fork/chat-handoff/chat-handoff-on-limit.ts', calls: 1 }],
    orcad: { from: 'src/main/fork/runtime-settle-hooks.ts', call: 'startForkChatHandoffOnLimit' }
  },
  {
    id: 'letters',
    starter:
      'Letters (`orca letter send`, one from a paired host, a board throw-back) typed into an idle chat or terminal agent',
    answer: 'held',
    reason:
      "Each letter queued here keeps the reason as its note and does not expire; the sender's receipt says it is held. resume-all runs a delivery pass at once, and each letter then waits a new day. The hold is per recipient, as bot mail's is: a person's letter or throw-back waits too.",
    gates: [
      { file: 'src/main/fork/letters/letters-delivery.ts', calls: 4 },
      { file: 'src/main/fork/letters/letters-service.ts', calls: 1 }
    ],
    orcad: { from: 'src/main/fork/runtime-settle-hooks.ts', call: 'startForkLetters' }
  },
  {
    id: 'legacy-attach',
    starter: 'Terminal worker start on the legacy attach path (federation)',
    answer: 'refused',
    reason: 'Refused with the pause reason before the attachment is written.',
    gates: [{ file: 'src/main/runtime/orchestration/legacy-remote/federation.ts', calls: 1 }],
    orcad: {
      from: 'src/main/runtime/rpc/methods/orchestration/federation/federation-methods.ts',
      call: 'ORCHESTRATION_FEDERATION_ATTACH_METHODS'
    }
  },
  {
    id: 'reviewer-gate',
    starter: "Reviewer-gate reviews started by a running worker's report",
    answer: 'allowed',
    reason:
      'The work is already running: holding the review would strand the report, so the done would never settle.',
    gates: []
  },
  {
    id: 'pending-room-turns',
    starter: 'Room turns a restart left between reservation and admission',
    answer: 'allowed',
    reason: 'The same operation replayed after a crash, never a fresh turn.',
    gates: []
  },
  {
    id: 'pr-waker',
    starter: 'Bot pull request waker',
    answer: 'allowed',
    reason: 'Inert: it accepts pull request events and drops them.',
    gates: []
  },
  {
    id: PERSON,
    starter:
      "A person's own act: a post in a chat or room, a launch, a worktree with a startup agent, Run now, Look now, Tidy now, a handoff they ask for, a Continue of a hop-limit hold",
    answer: 'allowed',
    reason: 'A person asked.',
    gates: []
  }
]
