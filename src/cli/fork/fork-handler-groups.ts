import type { HandlerGroup } from '../dispatch/handler-group-manifest'

/**
 * The fork's CLI command groups, spread into `HANDLER_GROUPS` by one hook so the upstream
 * manifest stays under its line budget. A new fork command group is added here.
 */
export const FORK_HANDLER_GROUPS: readonly HandlerGroup[] = [
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
    keys: ['limits list', 'limits resume-now', 'limits cancel'],
    load: async () => (await import('./limits-handlers.js')).FORK_LIMITS_HANDLERS
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
  }
]
