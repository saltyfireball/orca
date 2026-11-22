import type { HandlerGroup } from '../dispatch/handler-group-manifest'

/**
 * The fork's CLI command groups, spread into `HANDLER_GROUPS` by one hook so the upstream
 * manifest stays under its line budget. A new fork command group is added here.
 */
/** Keys an upstream group also registers, where the fork's handler serves both (SLRM-2445). */
const FORK_SHARED_HANDLER_KEYS: ReadonlySet<string> = new Set(['webhooks list'])

/** Upstream groups without the keys the fork's handlers take over. */
export function withoutForkSharedHandlerKeys(
  groups: readonly HandlerGroup[]
): readonly HandlerGroup[] {
  return groups.map((group) => ({
    ...group,
    keys: group.keys.filter((key) => !FORK_SHARED_HANDLER_KEYS.has(key))
  }))
}

export const FORK_HANDLER_GROUPS: readonly HandlerGroup[] = [
  // BAD-678: file checkpoints at each agent turn (FORK.md "Turn checkpoints").
  {
    name: 'fork-turn-checkpoints',
    keys: ['checkpoint list', 'checkpoint diff', 'checkpoint restore', 'checkpoint undo'],
    load: async () => (await import('./turn-checkpoints-handlers.js')).FORK_TURN_CHECKPOINT_HANDLERS
  },
  // BAD-677: snapshots taken before a worktree is removed (FORK.md "Worktree snapshots").
  {
    name: 'fork-worktree-snapshots',
    keys: ['worktree snapshots', 'worktree restore'],
    load: async () =>
      (await import('./worktree-snapshots-handlers.js')).FORK_WORKTREE_SNAPSHOT_HANDLERS
  },
  // SLRM-1503: move Claude chats between accounts (FORK.md).
  {
    name: 'fork-account-move',
    keys: ['account which', 'account move'],
    load: async () => (await import('./account-move-handlers.js')).FORK_ACCOUNT_MOVE_HANDLERS
  },
  // SLRM-2096: list unmerged and forgotten work (FORK.md "Lost work").
  {
    name: 'fork-lost-work',
    keys: ['lost-work'],
    load: async () => (await import('./lost-work-handlers.js')).FORK_LOST_WORK_HANDLERS
  },
  // BAD-669: remove finished workers' own workspaces (FORK.md "Worker archive").
  {
    name: 'fork-worker-cleanup',
    keys: ['orchestration worker-cleanup', 'bot chats-cleanup'],
    load: async () => (await import('./worker-cleanup-handlers.js')).FORK_WORKER_CLEANUP_HANDLERS
  },
  // SLRM-2098: the agent launch queue (FORK.md).
  {
    name: 'fork-agent-queue',
    keys: ['agent queue list', 'agent queue start', 'agent queue cancel'],
    load: async () => (await import('./agent-queue-handlers.js')).FORK_AGENT_QUEUE_HANDLERS
  },
  // Fork launch defaults: model and effort per kind of launch (FORK.md "Launch defaults").
  {
    name: 'fork-launch-defaults',
    keys: ['launch-defaults'],
    load: async () => (await import('./launch-defaults-handlers.js')).FORK_LAUNCH_DEFAULTS_HANDLERS
  },
  // BAD-687: agent profiles, named launch bundles (FORK.md "Agent profiles").
  {
    name: 'fork-agent-profiles',
    keys: [
      'profiles list',
      'profiles show',
      'profiles set',
      'profiles remove',
      'profiles import',
      'profiles confirm'
    ],
    load: async () => (await import('./agent-profile-handlers.js')).FORK_AGENT_PROFILE_HANDLERS
  },
  // Fork: Sleepers, list, sleep, wake and pin chats (FORK.md).
  {
    name: 'fork-sleepers',
    keys: ['sleepers list', 'sleepers sleep', 'sleepers wake', 'sleepers pin', 'sleepers unpin'],
    load: async () => (await import('./sleepers-handlers.js')).FORK_SLEEPERS_HANDLERS
  },
  // Fork: MCP servers and profiles (FORK.md "MCP profiles").
  {
    name: 'fork-mcp-profile',
    keys: ['mcp-profile list', 'mcp-profile show', 'mcp-profile set'],
    load: async () => (await import('./mcp-profile-handlers.js')).FORK_MCP_PROFILE_HANDLERS
  },
  // SLRM-2104: tokens and estimated cost of native Claude chats (FORK.md).
  {
    name: 'fork-usage-report',
    keys: ['usage-report'],
    load: async () => (await import('./usage-report-handlers.js')).FORK_USAGE_REPORT_HANDLERS
  },
  // Fork: the Decision inbox of chats waiting on the user (FORK.md "Idle recovery").
  {
    name: 'fork-inbox',
    keys: ['inbox list', 'inbox answer', 'inbox pause'],
    load: async () => (await import('./inbox-handlers.js')).FORK_INBOX_HANDLERS
  },
  // SLRM-2386: the PR babysitter (FORK.md "PR babysitter").
  {
    name: 'fork-babysit',
    keys: ['babysit', 'babysit list', 'babysit stop'],
    load: async () => (await import('./babysit-handlers.js')).FORK_BABYSIT_HANDLERS
  },
  // Fork: read and edit every app setting (FORK.md "Settings from the CLI").
  {
    name: 'fork-settings',
    keys: [
      'settings list',
      'settings get',
      'settings set',
      'settings reset',
      'settings export',
      'settings apply'
    ],
    load: async () => (await import('./settings-handlers.js')).FORK_SETTINGS_HANDLERS
  },
  // SLRM-2266: rank machines for --on auto and --host auto (FORK.md "Auto placement").
  {
    name: 'fork-auto-placement',
    keys: ['placement'],
    load: async () => (await import('./auto-placement-handlers.js')).FORK_AUTO_PLACEMENT_HANDLERS
  },
  // SLRM-2265: move a workspace and its chats to another host (FORK.md "Worktree move").
  {
    name: 'fork-worktree-move',
    keys: ['worktree move'],
    load: async () => (await import('./worktree-move-handlers.js')).FORK_WORKTREE_MOVE_HANDLERS
  },
  // SLRM-2271: approve, deny and revoke paired devices (FORK.md "Device approval").
  {
    name: 'fork-device-approval',
    keys: ['devices list', 'devices approve', 'devices deny', 'devices revoke'],
    load: async () => (await import('./device-approval-handlers.js')).FORK_DEVICE_APPROVAL_HANDLERS
  },
  // SLRM-2271: signed webhooks that start automation runs (FORK.md "Webhook automations").
  {
    name: 'fork-webhooks',
    keys: ['webhooks list', 'webhooks add', 'webhooks rotate', 'webhooks remove'],
    load: async () => (await import('./webhooks-handlers.js')).FORK_WEBHOOK_HANDLERS
  },
  // SLRM-2394: files parallel worktree branches share (FORK.md "Branch clashes").
  {
    name: 'fork-branch-clashes',
    keys: ['clashes'],
    load: async () => (await import('./branch-clashes-handlers.js')).FORK_BRANCH_CLASHES_HANDLERS
  },
  // BAD-676: a Task's done checks and attempts (FORK.md "Completion contract").
  {
    name: 'fork-completion-contract',
    keys: ['contract show'],
    load: async () =>
      (await import('./completion-contract-handlers.js')).FORK_COMPLETION_CONTRACT_HANDLERS
  },
  // BAD-682: keep an agent going until a check or judge passes (FORK.md "Goal loop").
  {
    name: 'fork-goal-loop',
    keys: ['goal set', 'goal list', 'goal clear'],
    load: async () => (await import('./goal-loop-handlers.js')).FORK_GOAL_LOOP_HANDLERS
  },
  // BAD-681: restart a worker that exited or hit a provider error (FORK.md "Worker retry policy").
  {
    name: 'fork-worker-retry',
    keys: ['retry policy', 'retry show'],
    load: async () => (await import('./worker-retry-handlers.js')).FORK_WORKER_RETRY_HANDLERS
  },
  // BAD-685: one switch that pauses all unattended work (FORK.md "Pause all").
  {
    name: 'fork-pause-all',
    keys: ['pause-all', 'resume-all', 'pause-status'],
    load: async () => (await import('./pause-all-handlers.js')).FORK_PAUSE_ALL_HANDLERS
  },
  // SLRM-2269: snooze workspaces and chats out of the sidebar (FORK.md "Snooze").
  {
    name: 'fork-snooze',
    keys: ['snooze', 'snooze list', 'snooze wake'],
    load: async () => (await import('./snooze-handlers.js')).FORK_SNOOZE_HANDLERS
  },
  // SLRM-2311 and SLRM-2310: paired servers, their health (FORK.md "Server health") and their
  // updates (FORK.md "Server updates"), one `orca servers` group.
  {
    name: 'fork-servers',
    keys: ['servers health', 'servers list', 'servers update', 'servers rollback'],
    load: async () => ({
      ...(await import('./server-health-handlers.js')).FORK_SERVER_HEALTH_HANDLERS,
      ...(await import('./servers-handlers.js')).FORK_SERVERS_HANDLERS
    })
  },
  // SLRM-2309: chats and terminal agents parked on a usage limit (FORK.md "Limit resume").
  {
    name: 'fork-limits',
    keys: ['limits list', 'limits resume-now', 'limits cancel', 'limits usage'],
    load: async () => ({
      ...(await import('./limits-handlers.js')).FORK_LIMITS_HANDLERS,
      // SLRM-2392: pooled limits (FORK.md "Pooled limits").
      ...(await import('./limits-usage-handler.js')).FORK_LIMITS_USAGE_HANDLERS
    })
  },
  // SLRM-2385: failure-loop and spend guards (FORK.md "Agent guards").
  {
    name: 'fork-guards',
    keys: ['guards list', 'guards resume', 'guards cap'],
    load: async () => (await import('./guards-handlers.js')).FORK_GUARDS_HANDLERS
  },
  // BAD-686: deny destructive agent shell commands (FORK.md "Command guards").
  {
    name: 'fork-command-guards',
    keys: [
      'command-guards list',
      'command-guards status',
      'command-guards allow',
      'command-guards disallow'
    ],
    load: async () => (await import('./command-guards-handlers.js')).FORK_COMMAND_GUARDS_HANDLERS
  },
  // SLRM-2384: keep each project's default branch current (FORK.md "Keep main current").
  {
    name: 'fork-main-sync',
    keys: ['main-sync', 'main-sync run'],
    load: async () => (await import('./main-sync-handlers.js')).FORK_MAIN_SYNC_HANDLERS
  },
  // SLRM-2384: memory protection for the orca-serve systemd user unit (FORK.md).
  {
    name: 'fork-serve-protect',
    keys: ['serve service protect', 'serve service protect status', 'serve service unprotect'],
    load: async () => (await import('./serve-protect-handlers.js')).FORK_SERVE_PROTECT_HANDLERS
  },
  // SLRM-2393: one task to 2 to 4 agents, compared and picked (FORK.md "Best of N").
  {
    name: 'fork-best-of',
    keys: ['best-of', 'best-of list', 'best-of show', 'best-of pick'],
    load: async () => (await import('./best-of-handlers.js')).FORK_BEST_OF_HANDLERS
  },
  // SLRM-2391: hand a chat to the other agent and read a chat's history (FORK.md "Chat handoff").
  {
    name: 'fork-chat-handoff',
    keys: ['chat handoff', 'chat history'],
    load: async () => (await import('./chat-handoff-handlers.js')).FORK_CHAT_HANDOFF_HANDLERS
  },
  // SLRM-2396: pull request review guides (FORK.md "Review guides").
  {
    name: 'fork-review-guide',
    keys: ['review-guide', 'review-guide write', 'review-guide cancel'],
    load: async () => (await import('./review-guide-handlers.js')).FORK_REVIEW_GUIDE_HANDLERS
  },
  // SLRM-2388: what finished, failed, merged and cost, and what waits on you (FORK.md "Digest").
  {
    name: 'fork-digest',
    keys: ['digest'],
    load: async () => (await import('./digest-handlers.js')).FORK_DIGEST_HANDLERS
  },
  // SLRM-2389: letters between chats and the board of asks (FORK.md "Letters and the board").
  {
    name: 'fork-letters',
    keys: [
      'letter send',
      'letter list',
      'letter chats',
      'board add',
      'board list',
      'board done',
      'board back'
    ],
    load: async () => (await import('./letters-handlers.js')).FORK_LETTERS_HANDLERS
  },
  // SLRM-2428: hand a task to the router bot (FORK.md "Quick task").
  {
    name: 'fork-quick-task',
    keys: ['quick-task'],
    load: async () => (await import('./quick-task-handlers.js')).FORK_QUICK_TASK_HANDLERS
  },
  // BAD-635: a bot's model and effort, for one bot or all (FORK.md "Bot model from the CLI").
  {
    name: 'fork-bot-set',
    keys: ['bot set'],
    load: async () => (await import('./bot-set-handlers.js')).FORK_BOT_SET_HANDLERS
  },
  // BAD-640: link connected Linear and GitHub to one bot or all (FORK.md "Bot connect from the CLI").
  {
    name: 'fork-bot-connect',
    keys: ['bot connect'],
    load: async () => (await import('./bot-connect-handlers.js')).FORK_BOT_CONNECT_HANDLERS
  },
  // BAD-694: a Linear card goes to the bot that takes it (FORK.md "Card routing").
  {
    name: 'fork-card-route',
    keys: ['card route'],
    load: async () => (await import('./card-route-handlers.js')).FORK_CARD_ROUTE_HANDLERS
  },
  // BAD-737: the owner's item answer from any shell, by owner token (FORK.md "Owner token").
  {
    name: 'fork-bot-item-answer',
    keys: ['bot item answer'],
    load: async () => (await import('./bot-item-answer.js')).FORK_BOT_ITEM_ANSWER_HANDLERS
  }
]
