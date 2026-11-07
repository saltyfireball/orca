import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { translateMain } from '../../i18n/main-i18n'
import type { BusyChat } from './busy-chats'
import type {
  RestartGuardChoice,
  RestartGuardKind,
  RestartGuardProgress,
  RestartGuardWaitingChoice
} from './restart-guard-machine'

type ShowMessageBox = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>

const LISTED_CHATS_MAX = 8

function describeActivity(chat: BusyChat): string {
  const { activity } = chat
  if (activity.kind === 'turn') {
    return activity.toolName
      ? translateMain('fork.restartGuard.activity.tool', 'running {{tool}}', {
          tool: activity.toolName
        })
      : translateMain('fork.restartGuard.activity.turn', 'working on a turn')
  }
  if (activity.kind === 'question') {
    return translateMain('fork.restartGuard.activity.question', 'waiting for you')
  }
  const parts: string[] = []
  if (activity.subagents > 0) {
    parts.push(
      translateMain('fork.restartGuard.activity.subagents', '{{count}} subagent(s) running', {
        count: activity.subagents
      })
    )
  }
  if (activity.commands > 0) {
    parts.push(
      translateMain(
        'fork.restartGuard.activity.commands',
        '{{count}} background command(s) running',
        { count: activity.commands }
      )
    )
  }
  return parts.join(', ')
}

export function describeBusyChats(chats: readonly BusyChat[]): string {
  const lines = chats.slice(0, LISTED_CHATS_MAX).map((chat) => {
    const name = chat.name || translateMain('fork.restartGuard.untitled', 'Untitled chat')
    const where = chat.workspace ? ` (${chat.workspace})` : ''
    return `- ${name}${where}: ${describeActivity(chat)}`
  })
  if (chats.length > LISTED_CHATS_MAX) {
    lines.push(
      translateMain('fork.restartGuard.more', '...and {{count}} more', {
        count: chats.length - LISTED_CHATS_MAX
      })
    )
  }
  return lines.join('\n')
}

function nowLabel(kind: RestartGuardKind): string {
  return kind === 'quit'
    ? translateMain('fork.restartGuard.quitNow', 'Quit Now')
    : translateMain('fork.restartGuard.restartNow', 'Restart Now')
}

function whenIdleLabel(kind: RestartGuardKind): string {
  return kind === 'quit'
    ? translateMain('fork.restartGuard.quitWhenIdle', 'Quit When Idle')
    : translateMain('fork.restartGuard.restartWhenIdle', 'Restart When Idle')
}

function title(kind: RestartGuardKind): string {
  if (kind === 'update') {
    return translateMain('fork.restartGuard.title.update', 'Install Update')
  }
  return kind === 'quit'
    ? translateMain('fork.restartGuard.title.quit', 'Quit')
    : translateMain('fork.restartGuard.title.restart', 'Restart')
}

const WAIT_BUTTON = 0
const NOW_BUTTON = 1
const CANCEL_BUTTON = 2

export async function askBeforeRestart(
  showMessageBox: ShowMessageBox,
  kind: RestartGuardKind,
  chats: readonly BusyChat[]
): Promise<RestartGuardChoice> {
  const { response } = await showMessageBox({
    type: 'warning',
    buttons: [
      whenIdleLabel(kind),
      nowLabel(kind),
      translateMain('fork.restartGuard.cancel', 'Cancel')
    ],
    // Return waits; going now cuts running work off, so it is never the default.
    defaultId: WAIT_BUTTON,
    cancelId: CANCEL_BUTTON,
    noLink: true,
    title: title(kind),
    message: translateMain(
      'fork.restartGuard.message',
      '{{count}} chat(s) are busy. Stopping now ends what they are running.',
      { count: chats.length }
    ),
    detail: `${describeBusyChats(chats)}\n\n${translateMain(
      'fork.restartGuard.detail',
      'Running turns, subagents and background commands stop with the app. Choose "when idle" to wait until every listed chat finishes, then go ahead on its own. Chats waiting for you do not hold the wait.'
    )}`
  })
  if (response === WAIT_BUTTON) {
    return 'wait'
  }
  return response === NOW_BUTTON ? 'now' : 'cancel'
}

const KEEP_BUTTON = 0
const NOW_WHILE_WAITING_BUTTON = 1
const STOP_BUTTON = 2

export async function askWhileWaiting(
  showMessageBox: ShowMessageBox,
  progress: RestartGuardProgress
): Promise<RestartGuardWaitingChoice> {
  const { response } = await showMessageBox({
    type: 'info',
    buttons: [
      translateMain('fork.restartGuard.keepWaiting', 'Keep Waiting'),
      nowLabel(progress.kind),
      translateMain('fork.restartGuard.stopWaiting', 'Stop Waiting')
    ],
    defaultId: KEEP_BUTTON,
    cancelId: KEEP_BUTTON,
    noLink: true,
    title: title(progress.kind),
    message: waitingLabel(progress),
    detail: describeBusyChats(progress.remaining)
  })
  if (response === NOW_WHILE_WAITING_BUTTON) {
    return 'now'
  }
  return response === STOP_BUTTON ? 'stop' : 'keep'
}

export function waitingLabel(progress: RestartGuardProgress): string {
  const done = progress.total - progress.remaining.length
  if (progress.kind === 'quit') {
    return translateMain(
      'fork.restartGuard.waiting.quit',
      'Quit when idle: {{done}} of {{total}} chats finished',
      { done, total: progress.total }
    )
  }
  return translateMain(
    'fork.restartGuard.waiting.restart',
    'Restart when idle: {{done}} of {{total}} chats finished',
    { done, total: progress.total }
  )
}
