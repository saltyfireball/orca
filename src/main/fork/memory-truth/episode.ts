// SLRM-2099: one notification per time over the threshold. It re-arms only after memory has been
// back under the threshold, so a machine that hovers around it is not spammed.
import {
  formatForkBytes,
  type ForkMemoryStatus,
  type ForkMemoryThresholdReason
} from '../../../shared/fork/memory-truth'

export type ForkMemoryEpisode = { notified: boolean }

export function createForkMemoryEpisode(): ForkMemoryEpisode {
  return { notified: false }
}

/** True exactly when this status should raise the notification; updates the episode. */
export function shouldNotifyForkMemory(
  episode: ForkMemoryEpisode,
  status: ForkMemoryStatus
): boolean {
  if (!status.over) {
    episode.notified = false
    return false
  }
  if (episode.notified) {
    return false
  }
  episode.notified = true
  return true
}

type Translate = (key: string, fallback: string, values?: Record<string, string>) => string

export function forkMemoryReasonText(
  reason: ForkMemoryThresholdReason,
  status: ForkMemoryStatus,
  t: Translate
): string {
  if (reason === 'pressure') {
    return t('fork.memory.reason.pressure', 'Memory pressure is {{level}}.', {
      level: status.system?.pressure ?? 'unknown'
    })
  }
  return t('fork.memory.reason.swap', '{{swap}} of swap in use.', {
    swap: formatForkBytes(status.system?.swapUsed ?? 0)
  })
}

export function forkMemoryNotificationText(
  status: ForkMemoryStatus,
  t: Translate
): { title: string; body: string } {
  const lines = status.reasons.map((reason) => forkMemoryReasonText(reason, status, t))
  lines.push(
    status.launchesPaused
      ? t('fork.memory.notify.paused', 'New agents are paused until memory frees up.')
      : status.launchesHeld
        ? t('fork.memory.notify.held', 'New chats wait in the launch queue until memory frees up.')
        : t('fork.memory.notify.hint', 'Close idle sessions to free memory.')
  )
  return {
    title: t('fork.memory.notify.title', 'Memory is running low'),
    body: lines.join(' ')
  }
}
