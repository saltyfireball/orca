// Every fork RPC method list in one place, so rpc-method-registry.ts (an upstream file at its line limit)
// takes one import and one spread (BAD-834). Order is the order the registry spread them in.
import { FORK_CLAUDE_ACCOUNT_MOVE_METHODS } from './fork-claude-account-move'
import { FORK_LOST_WORK_METHODS } from './fork-lost-work'
import { FORK_AGENT_QUEUE_METHODS } from './fork-agent-queue'
import { FORK_LAUNCH_DEFAULTS_METHODS } from './fork-launch-defaults'
import { FORK_SETTINGS_METHODS } from './fork-settings'
import { FORK_SLEEPERS_METHODS } from './fork-sleepers'
import { FORK_IDLE_RECOVERY_RPC_METHODS } from './fork-idle-recovery'
import { FORK_MCP_PROFILE_METHODS } from './fork-mcp-profiles'
import { FORK_USAGE_REPORT_METHODS } from './fork-usage-report'
import { FORK_AUTO_PLACEMENT_METHODS } from './fork-auto-placement'
import { FORK_SERVER_SETUP_METHODS } from './fork-server-setup'
import { FORK_BATCH_START_METHODS } from './fork-batch-start'
import { FORK_ENDPOINT_ADDRESSES_METHODS } from './fork-endpoint-addresses'
import { FORK_WORKTREE_MOVE_METHODS } from './fork-worktree-move'
import { FORK_DEVICE_APPROVAL_METHODS } from './fork-device-approval'
import { FORK_WEBHOOK_METHODS } from './fork-webhooks'
import { FORK_SNOOZE_METHODS } from './fork-snooze'
import { FORK_LETTERS_RPC_METHODS } from './fork-letters'
import { FORK_SERVER_HEALTH_METHODS } from './fork-server-health'
import { FORK_MAIN_SYNC_METHODS } from './fork-main-sync'
import { FORK_LIMIT_RESUME_METHODS } from './fork-limit-resume'
import { FORK_SERVER_UPDATE_METHODS } from './fork-server-update'
import { FORK_AGENT_GUARDS_METHODS } from './fork-agent-guards'
import { FORK_WORKTREE_PORTS_METHODS } from './fork-worktree-ports'
import { FORK_BRANCH_CLASHES_METHODS } from './fork-branch-clashes'
import { FORK_BEST_OF_METHODS } from './fork-best-of'
import { FORK_CHAT_HANDOFF_METHODS } from './fork-chat-handoff'
import { FORK_REVIEW_GUIDE_METHODS } from './fork-review-guide'
import { FORK_DIGEST_METHODS } from './fork-digest'
import { FORK_QUICK_TASK_METHODS } from './fork-quick-task'

export const FORK_RPC_METHODS = [
  // SLRM-1503: move Claude chats between this host's accounts (FORK.md).
  ...FORK_CLAUDE_ACCOUNT_MOVE_METHODS,
  // SLRM-2096: the lost work scan behind `orca lost-work` (FORK.md).
  ...FORK_LOST_WORK_METHODS,
  // SLRM-2098: the agent launch queue (FORK.md).
  ...FORK_AGENT_QUEUE_METHODS,
  ...FORK_LAUNCH_DEFAULTS_METHODS,
  // Fork: Sleepers, list, sleep now and pins behind `orca sleepers` (FORK.md).
  ...FORK_SLEEPERS_METHODS,
  // Fork: MCP servers and profiles (FORK.md).
  ...FORK_MCP_PROFILE_METHODS,
  // SLRM-2104: the usage report behind `orca usage-report` (FORK.md).
  ...FORK_USAGE_REPORT_METHODS,
  // SLRM-2267: a server's own LAN and Tailscale addresses, for endpoint failover (FORK.md).
  ...FORK_ENDPOINT_ADDRESSES_METHODS,
  // Fork: idle recovery, the Decision inbox behind `orca inbox` (FORK.md).
  ...FORK_IDLE_RECOVERY_RPC_METHODS,
  ...FORK_SETTINGS_METHODS,
  // SLRM-2266: the load probe and pick behind --on auto and --host auto (FORK.md).
  ...FORK_AUTO_PLACEMENT_METHODS,
  // SLRM-2312: set a project up on a paired server on demand (FORK.md).
  ...FORK_SERVER_SETUP_METHODS,
  // SLRM-2395: batch start, a prompt per worktree and model from the composer (FORK.md).
  ...FORK_BATCH_START_METHODS,
  // SLRM-2265: each host's half of `orca worktree move` (FORK.md).
  ...FORK_WORKTREE_MOVE_METHODS,
  // SLRM-2271: list, approve, deny and revoke paired devices behind `orca devices` (FORK.md).
  ...FORK_DEVICE_APPROVAL_METHODS,
  // SLRM-2271: signed webhooks that start automation runs, behind `orca webhooks` (FORK.md).
  ...FORK_WEBHOOK_METHODS,
  // SLRM-2269: snoozed workspaces and chats behind `orca snooze` (FORK.md).
  ...FORK_SNOOZE_METHODS,
  // SLRM-2311: paired server health behind `orca servers health` (FORK.md).
  ...FORK_SERVER_HEALTH_METHODS,
  // SLRM-2309: chats and terminal agents parked on a usage limit, behind `orca limits` (FORK.md).
  ...FORK_LIMIT_RESUME_METHODS,
  // SLRM-2310: update paired servers over their own RPC, behind `orca servers` (FORK.md).
  ...FORK_SERVER_UPDATE_METHODS,
  // SLRM-2385: failure-loop and spend guards behind `orca guards` (FORK.md).
  ...FORK_AGENT_GUARDS_METHODS,
  // SLRM-2383: the port block a workspace holds, behind `orca ports` (FORK.md).
  ...FORK_WORKTREE_PORTS_METHODS,
  // SLRM-2384: keep each project's default branch current, behind `orca main-sync` (FORK.md).
  ...FORK_MAIN_SYNC_METHODS,
  // SLRM-2394: files parallel worktree branches share, behind `orca clashes` (FORK.md).
  ...FORK_BRANCH_CLASHES_METHODS,
  // SLRM-2393: best-of runs behind `orca best-of` and the compare view (FORK.md).
  ...FORK_BEST_OF_METHODS,
  // SLRM-2391: hand a chat to the other agent, behind `orca chat handoff|history` (FORK.md).
  ...FORK_CHAT_HANDOFF_METHODS,
  // SLRM-2396: pull request review guides behind `orca review-guide` and the phone (FORK.md).
  ...FORK_REVIEW_GUIDE_METHODS,
  // SLRM-2388: the digest across this host and its paired servers, behind `orca digest` (FORK.md).
  ...FORK_DIGEST_METHODS,
  // SLRM-2389: letters between chats and the board of asks, behind `orca letter` and `orca board` (FORK.md).
  ...FORK_LETTERS_RPC_METHODS,
  // SLRM-2428: hand a quick task to the router bot, behind `orca quick-task` and the phone (FORK.md).
  ...FORK_QUICK_TASK_METHODS
] as const
