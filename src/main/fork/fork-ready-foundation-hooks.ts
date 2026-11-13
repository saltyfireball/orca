// The fork's hooks in main-process-ready-foundation.ts, behind one import so that upstream file
// stays inside its line limit (SLRM-2138).
export { forkPostReadyAppName } from './app-name'
export { installForkChatSurvive } from './chat-survive/chat-survive-setting'
