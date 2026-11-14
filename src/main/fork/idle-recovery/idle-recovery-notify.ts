// Idle recovery (FORK.md), item F: tells the user a chat started waiting on them.
// Contract: called once per sweep with the chats that newly wait. Each target is its own
// setting and off by default: a desktop notification (`notifyDesktop`), a POST of the items as
// JSON (`notifyWebhookUrl`), and a command given the same JSON on stdin (`notifyCommand`). A
// failing target is logged without its address or output and never stops the others or the
// sweep. Never throws.
import type { IdleRecoverySettings } from '../../../shared/fork/idle-recovery-settings'
import type { ForkIdleRecoveryInboxItem } from '../../../shared/fork/idle-recovery-wire'

export async function notifyIdleRecoveryWaiting(
  _items: readonly ForkIdleRecoveryInboxItem[],
  _settings: IdleRecoverySettings
): Promise<void> {}
