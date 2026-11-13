// Fork hooks for StructuredAgentSessionHost (FORK.md "Chat survive adopt hooks"). That upstream
// file sits at max-lines, so its startup recovery import comes through here with the fork's tab
// recovery hook: one import line, no added lines.
export { createStartupRecovery } from '../native-chat/agent-session-wire/recovery/structured-agent-session-restart-reconcile'
export { forkChatSurviveRecover } from './chat-survive/chat-survive-adopt'
