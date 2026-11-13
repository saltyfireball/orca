// The fork's hooks in structured-agent-session-host-lifetime.ts, behind one short import so that
// upstream file stays inside its line limit (SLRM-2138).
export { forkChatSurviveQuit } from './chat-survive/chat-survive-detach'
export { chatSurviveRecordsSettled as forkChatSurviveSettled } from './chat-survive/chat-survive-registry'
