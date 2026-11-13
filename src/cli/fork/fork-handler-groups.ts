import type { HandlerGroup } from '../handler-group-manifest'

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
  }
]
