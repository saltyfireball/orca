// BAD-669: the worker archive and bot chat close methods, one spread in the registry so that
// upstream file stays small.
import { FORK_BOT_CHAT_CLOSE_METHODS } from './fork-bot-chat-close'
import { FORK_WORKER_CLEANUP_METHODS } from './fork-worker-cleanup'

export const FORK_WORKER_ARCHIVE_METHODS = [
  ...FORK_WORKER_CLEANUP_METHODS,
  ...FORK_BOT_CHAT_CLOSE_METHODS
] as const
