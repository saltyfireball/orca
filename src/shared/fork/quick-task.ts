// Quick task (SLRM-2428, FORK.md): a shortcut opens a small box; the typed or dictated task goes
// to a router bot in a new chat, which hands it to the bot that owns it with a machine to run on.
// Shared by main (the service, shortcut and window), the CLI, the settings card and the box.
import * as z from 'zod'
import { QUICK_TASK_TEXT_MAX, type QuickTaskSubmitResult } from './quick-task-contract'

export type ForkQuickTaskSettings = {
  /** Fork (SLRM-2428): the quick task box, its global shortcut and `orca quick-task`; unset is on. */
  forkQuickTask?: boolean
  /** Fork quick task: the global shortcut that opens the box, as an Electron accelerator; unset or empty is CommandOrControl+Alt+Shift+Space, none is no shortcut. */
  forkQuickTaskShortcut?: string
  /** Fork quick task: the bot that routes each task, made on first use; unset is Dispatcher. */
  forkQuickTaskRouterBot?: string
  /** Fork quick task: the agent a new router bot runs on; unset is claude. */
  forkQuickTaskRouterAgent?: string
  /** Fork quick task: the model a new router bot runs on; unset is haiku for claude and the agent's default otherwise, empty is the agent's default. */
  forkQuickTaskRouterModel?: string
  /** Fork quick task: the router suggests a machine for code work; unset is on. */
  forkQuickTaskPlacement?: boolean
  /** Fork quick task: the command the router runs to rank machines (its output is read by the router); unset is the built-in `orca placement --json`. Set it in the Settings screen. */
  forkQuickTaskPlacementCommand?: string
}

export const FORK_QUICK_TASK_DEFAULT_SHORTCUT = 'CommandOrControl+Alt+Shift+Space'
export const FORK_QUICK_TASK_DEFAULT_ROUTER = 'Dispatcher'
export const FORK_QUICK_TASK_DEFAULT_AGENT = 'claude'
/** Cheap and quick: routing reads a list and sends one message. */
export const FORK_QUICK_TASK_DEFAULT_CLAUDE_MODEL = 'haiku'
/** What the router is for: SOUL.md's first paragraph, so `bot list` shows it. */
export const FORK_QUICK_TASK_ROUTER_PURPOSE = 'Routes quick tasks to the bot that owns them.'
/** How long the box shows where a task went before it closes. */
export const FORK_QUICK_TASK_CLOSE_AFTER_MS = 2500
const MAX_SETTING_TEXT = 500
/** Stands for `orca placement --json` run with the router's own orca command. */
export const FORK_QUICK_TASK_BUILT_IN_PLACEMENT = 'orca placement --json'

export type ForkQuickTaskConfig = {
  enabled: boolean
  /** Null: no shortcut ("none", or not a shortcut the box may take). */
  shortcut: string | null
  routerBot: string
  routerAgent: string
  /** Null: the agent's own default. */
  routerModel: string | null
  /** Null: no machine suggestion. Empty string never; unset is the built-in command. */
  placementCommand: string | null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, MAX_SETTING_TEXT) : undefined
}

export function readForkQuickTaskConfig(settings: unknown): ForkQuickTaskConfig {
  const value = (settings ?? {}) as ForkQuickTaskSettings
  const shortcut = text(value.forkQuickTaskShortcut)
  const routerAgent = text(value.forkQuickTaskRouterAgent) || FORK_QUICK_TASK_DEFAULT_AGENT
  const model = text(value.forkQuickTaskRouterModel)
  const defaultModel =
    routerAgent === FORK_QUICK_TASK_DEFAULT_AGENT ? FORK_QUICK_TASK_DEFAULT_CLAUDE_MODEL : null
  return {
    enabled: value.forkQuickTask !== false,
    shortcut: !shortcut
      ? FORK_QUICK_TASK_DEFAULT_SHORTCUT
      : isForkQuickTaskAccelerator(shortcut)
        ? shortcut
        : null,
    routerBot: text(value.forkQuickTaskRouterBot) || FORK_QUICK_TASK_DEFAULT_ROUTER,
    routerAgent,
    routerModel: model === undefined ? defaultModel : model || null,
    placementCommand:
      value.forkQuickTaskPlacement === false
        ? null
        : text(value.forkQuickTaskPlacementCommand) || FORK_QUICK_TASK_BUILT_IN_PLACEMENT
  }
}

const MODIFIERS = new Set([
  'command',
  'cmd',
  'control',
  'ctrl',
  'commandorcontrol',
  'cmdorctrl',
  'alt',
  'option',
  'altgr',
  'shift',
  'super',
  'meta'
])
const NAMED_KEYS = new Set([
  'space',
  'tab',
  'enter',
  'return',
  'backspace',
  'delete',
  'insert',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
  'escape',
  'esc',
  'plus'
])

/**
 * An Electron accelerator that cannot steal ordinary typing: one key, and at least one modifier
 * besides Shift.
 */
export function isForkQuickTaskAccelerator(value: string): boolean {
  const parts = value.split('+').map((part) => part.trim().toLowerCase())
  const key = parts.pop()
  if (!key || parts.length === 0 || new Set(parts).size !== parts.length) {
    return false
  }
  if (!parts.every((part) => MODIFIERS.has(part)) || parts.every((part) => part === 'shift')) {
    return false
  }
  return (
    /^[a-z0-9]$/.test(key) ||
    /^f([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    /^[`\-=[\]\\;',./]$/.test(key) ||
    NAMED_KEYS.has(key)
  )
}

export const QuickTaskSubmitParamsSchema = z.object({
  text: z.string().trim().min(1).max(QUICK_TASK_TEXT_MAX),
  source: z.enum(['desktop', 'mobile', 'cli'])
})

/** Main <-> the box window. */
export const FORK_QUICK_TASK_CHANNELS = {
  submit: 'fork-quick-task:submit',
  close: 'fork-quick-task:close',
  openChat: 'fork-quick-task:open-chat',
  /** Main tells the box it was shown again, so it starts empty. */
  shown: 'fork-quick-task:shown'
} as const

export type ForkQuickTaskApi = {
  submit: (text: string) => Promise<QuickTaskSubmitResult>
  close: () => void
  openChat: (chatId: string) => Promise<void>
  onShown: (callback: () => void) => () => void
}
