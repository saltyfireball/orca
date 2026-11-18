import type { CommandSpec } from '../discovery/command-spec'
import { ACCOUNT_COMMAND_SPECS } from './account'
import { AUTH_COMMAND_SPECS } from './auth'
import { BROWSER_ADVANCED_COMMAND_SPECS } from './browser-advanced'
import { BROWSER_BASIC_COMMAND_SPECS } from './browser-basic'
import { AUTOMATION_COMMAND_SPECS } from './automations'
import { CORE_COMMAND_SPECS } from './core'
import { CHAT_COMMAND_SPECS } from './chat'
import { FILE_COMMAND_SPECS } from './file'
import { PROJECT_COMMAND_SPECS } from './project'
import { ORCHESTRATION_COMMAND_SPECS } from './orchestration'
import { withFullRecordFlag } from './orchestration-full-record-flag'
import { COMPUTER_COMMAND_SPECS } from './computer'
import { ENVIRONMENT_COMMAND_SPECS } from './environment'
import { MANAGED_SERVER_COMMAND_SPECS } from './managed-server'
import { AGENT_HOOK_COMMAND_SPECS } from './agent-hooks'
import { AGENT_LAUNCH_COMMAND_SPECS } from './agent-launch'
import { SLACK_COMMAND_SPECS } from './slack'
import { GOOGLE_COMMAND_SPECS } from './google'
import { GOOGLE_READ_COMMAND_SPECS } from './google-read'
import { GOOGLE_FILES_COMMAND_SPECS } from './google-files'
import { GOOGLE_WRITE_COMMAND_SPECS } from './google-write'
import { BOT_COMMAND_SPECS } from './bot'
import { BOT_ITEM_COMMAND_SPECS } from './bot-items'
import { BOT_GOOGLE_SETUP_COMMAND_SPECS } from './bot-google-setup'
import { BOT_COMPOSIO_COMMAND_SPECS } from './bot-composio'
import { WEBHOOK_COMMAND_SPECS } from './webhooks'
import { AGENT_CONVERSATION_COMMAND_SPECS } from './agent-conversations'
import { DIAGNOSTICS_COMMAND_SPECS } from './diagnostics'
import { SPEECH_COMMAND_SPECS } from './speech'
import { TERMINAL_DAEMON_COMMAND_SPECS } from './terminal-daemon'
import { EMULATOR_COMMAND_SPECS } from './emulator'
import { INTROSPECTION_COMMAND_SPECS } from './introspection'
import { JIRA_COMMAND_SPECS } from './jira'
import { LINEAR_COMMAND_SPECS } from './linear'
import { VM_COMMAND_SPECS } from './vm'
import { VM_ENV_COMMAND_SPECS } from './vm-env'
import { SKILL_COMMAND_SPECS } from './skills'
import { ARTIFACT_COMMAND_SPECS } from './artifacts'
import { SEARCH_COMMAND_SPECS } from './search'
import { PROFILE_STATE_COMMAND_SPECS } from './profile-state'
import { REFERENCE_COMMAND_SPECS } from './reference'
import { PORTS_COMMAND_SPECS } from './ports'
import { PLUGIN_AUTHORING_COMMAND_SPECS, PLUGIN_RUNTIME_COMMAND_SPECS } from './plugin'
import { PAIR_COMMAND_SPECS } from './pair'
import { PLUGIN_VIEW_COMMAND_SPECS } from './plugin-view'
import { PLUGIN_INSTALL_COMMAND_SPECS } from './plugin-install'
import { WORKSPACE_CLEANUP_COMMAND_SPECS } from './workspace-cleanup'
// SLRM-1503: orca account which / move (FORK.md).
import { FORK_ACCOUNT_MOVE_COMMAND_SPECS } from '../fork/account-move-specs'
import { FORK_LOST_WORK_COMMAND_SPECS } from '../fork/lost-work-specs'
import { FORK_AGENT_QUEUE_COMMAND_SPECS } from '../fork/agent-queue-specs'
import { FORK_LAUNCH_DEFAULTS_COMMAND_SPECS } from '../fork/launch-defaults-specs'
import { FORK_SLEEPERS_COMMAND_SPECS } from '../fork/sleepers-specs'
import { FORK_INBOX_COMMAND_SPECS } from '../fork/inbox-specs'
import { FORK_MCP_PROFILE_COMMAND_SPECS, withForkMcpProfileFlag } from '../fork/mcp-profile-specs'
import { FORK_USAGE_REPORT_COMMAND_SPECS } from '../fork/usage-report-specs'
import { FORK_SETTINGS_COMMAND_SPECS } from '../fork/settings-specs'
import { FORK_WORKTREE_MOVE_COMMAND_SPECS } from '../fork/worktree-move-specs'
import { FORK_DEVICE_APPROVAL_COMMAND_SPECS } from '../fork/device-approval-specs'
import { FORK_SERVER_HEALTH_COMMAND_SPECS } from '../fork/server-health-specs'
import { FORK_WEBHOOK_COMMAND_SPECS } from '../fork/webhooks-specs'
import { FORK_SNOOZE_COMMAND_SPECS } from '../fork/snooze-specs'
import { FORK_BRANCH_CLASHES_COMMAND_SPECS } from '../fork/branch-clashes-specs'
import { FORK_LIMITS_COMMAND_SPECS } from '../fork/limits-specs'
import { FORK_SERVERS_COMMAND_SPECS } from '../fork/servers-specs'
import { FORK_GUARDS_COMMAND_SPECS } from '../fork/guards-specs'
import { FORK_MAIN_SYNC_COMMAND_SPECS } from '../fork/main-sync-specs'
import { FORK_SERVE_PROTECT_COMMAND_SPECS } from '../fork/serve-protect-specs'
import { FORK_BEST_OF_COMMAND_SPECS } from '../fork/best-of-specs'
import { FORK_CHAT_HANDOFF_COMMAND_SPECS } from '../fork/chat-handoff-specs'
import { FORK_REVIEW_GUIDE_COMMAND_SPECS } from '../fork/review-guide-specs'
import { FORK_DIGEST_COMMAND_SPECS } from '../fork/digest-specs'
import { FORK_LETTERS_COMMAND_SPECS } from '../fork/letters-specs'
import {
  FORK_AUTO_PLACEMENT_COMMAND_SPECS,
  withForkAutoPlacementNotes
} from '../fork/auto-placement-specs'

// Fork: --mcp-profile on the commands that start agents (FORK.md "MCP profiles"), and the
// auto placement notes on --on and --host (SLRM-2266).
export const COMMAND_SPECS: CommandSpec[] = withForkAutoPlacementNotes(
  withForkMcpProfileFlag([
    ...CORE_COMMAND_SPECS,
    ...REFERENCE_COMMAND_SPECS,
    ...ARTIFACT_COMMAND_SPECS,
    ...ACCOUNT_COMMAND_SPECS,
    ...AUTH_COMMAND_SPECS,
    ...PROJECT_COMMAND_SPECS,
    ...FILE_COMMAND_SPECS,
    ...AUTOMATION_COMMAND_SPECS,
    ...WORKSPACE_CLEANUP_COMMAND_SPECS,
    ...BROWSER_BASIC_COMMAND_SPECS,
    ...BROWSER_ADVANCED_COMMAND_SPECS,
    ...ORCHESTRATION_COMMAND_SPECS.map(withFullRecordFlag),
    ...COMPUTER_COMMAND_SPECS,
    ...AGENT_HOOK_COMMAND_SPECS,
    ...AGENT_LAUNCH_COMMAND_SPECS,
    ...AGENT_CONVERSATION_COMMAND_SPECS,
    ...CHAT_COMMAND_SPECS,
    ...SLACK_COMMAND_SPECS,
    ...GOOGLE_COMMAND_SPECS,
    ...GOOGLE_READ_COMMAND_SPECS,
    ...GOOGLE_FILES_COMMAND_SPECS,
    ...GOOGLE_WRITE_COMMAND_SPECS,
    ...BOT_COMMAND_SPECS,
    ...BOT_ITEM_COMMAND_SPECS,
    ...BOT_GOOGLE_SETUP_COMMAND_SPECS,
    ...BOT_COMPOSIO_COMMAND_SPECS,
    ...WEBHOOK_COMMAND_SPECS,
    ...DIAGNOSTICS_COMMAND_SPECS,
    ...SPEECH_COMMAND_SPECS,
    ...TERMINAL_DAEMON_COMMAND_SPECS,
    ...INTROSPECTION_COMMAND_SPECS,
    ...ENVIRONMENT_COMMAND_SPECS,
    ...MANAGED_SERVER_COMMAND_SPECS,
    ...JIRA_COMMAND_SPECS,
    ...LINEAR_COMMAND_SPECS,
    ...VM_COMMAND_SPECS,
    ...VM_ENV_COMMAND_SPECS,
    ...EMULATOR_COMMAND_SPECS,
    ...SKILL_COMMAND_SPECS,
    ...SEARCH_COMMAND_SPECS,
    ...PROFILE_STATE_COMMAND_SPECS,
    ...PORTS_COMMAND_SPECS,
    ...PLUGIN_AUTHORING_COMMAND_SPECS,
    ...PLUGIN_RUNTIME_COMMAND_SPECS,
    ...PLUGIN_VIEW_COMMAND_SPECS,
    ...PLUGIN_INSTALL_COMMAND_SPECS,
    ...PAIR_COMMAND_SPECS,
    ...FORK_ACCOUNT_MOVE_COMMAND_SPECS,
    ...FORK_LOST_WORK_COMMAND_SPECS,
    ...FORK_AGENT_QUEUE_COMMAND_SPECS,
    ...FORK_LAUNCH_DEFAULTS_COMMAND_SPECS,
    ...FORK_SLEEPERS_COMMAND_SPECS,
    ...FORK_MCP_PROFILE_COMMAND_SPECS,
    ...FORK_USAGE_REPORT_COMMAND_SPECS,
    ...FORK_INBOX_COMMAND_SPECS,
    ...FORK_SETTINGS_COMMAND_SPECS,
    ...FORK_AUTO_PLACEMENT_COMMAND_SPECS,
    ...FORK_WORKTREE_MOVE_COMMAND_SPECS,
    ...FORK_DEVICE_APPROVAL_COMMAND_SPECS,
    ...FORK_WEBHOOK_COMMAND_SPECS,
    ...FORK_SNOOZE_COMMAND_SPECS,
    ...FORK_SERVER_HEALTH_COMMAND_SPECS,
    ...FORK_LIMITS_COMMAND_SPECS,
    ...FORK_SERVERS_COMMAND_SPECS,
    ...FORK_GUARDS_COMMAND_SPECS,
    ...FORK_MAIN_SYNC_COMMAND_SPECS,
    ...FORK_SERVE_PROTECT_COMMAND_SPECS,
    ...FORK_BRANCH_CLASHES_COMMAND_SPECS,
    ...FORK_BEST_OF_COMMAND_SPECS,
    ...FORK_CHAT_HANDOFF_COMMAND_SPECS,
    ...FORK_REVIEW_GUIDE_COMMAND_SPECS,
    ...FORK_DIGEST_COMMAND_SPECS,
    ...FORK_LETTERS_COMMAND_SPECS
  ])
)
