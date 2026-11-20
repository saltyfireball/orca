// Fork launch defaults for bots (BAD-635, FORK.md "Launch defaults"): the "bot" kind of
// forkLaunchDefaults gives a NEW bot made without a launch of its own a model and effort, and
// `orca bot set` writes a bot's launch through bots.update. Unset keeps upstream: such a bot's
// chats start on the native chat defaults.
import { BotLaunchSchema, type BotLaunch } from '../../bots/bot-launch'
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import { normalizeForkLaunchDefaults } from './launch-defaults-settings'

/** The launch a new bot of `agent` gets from the "bot" kind, or undefined when none is set (or the
 *  set one would not save as a bot launch). */
export function forkBotDefaultLaunch(settings: unknown, agent: string): BotLaunch | undefined {
  const forkLaunchDefaults = (settings as { forkLaunchDefaults?: unknown } | null | undefined)
    ?.forkLaunchDefaults
  const preset = normalizeForkLaunchDefaults(forkLaunchDefaults).bot?.[agent as TuiAgent]
  if (!preset?.model) {
    return undefined
  }
  const parsed = BotLaunchSchema.safeParse({
    model: preset.model,
    ...(preset.effort ? { options: { effort: preset.effort } } : {})
  })
  return parsed.success ? parsed.data : undefined
}

/** A bot create's params with the "bot" kind default filled in when it brings no launch. The one
 *  hook in the bot controller; a launch the caller passes (the quick task router's model) wins. */
export function withForkBotDefaultLaunch<T extends { agent?: string; launch?: BotLaunch }>(
  input: T,
  settings: unknown
): T {
  if (input.launch) {
    return input
  }
  const launch = forkBotDefaultLaunch(settings, input.agent ?? 'claude')
  return launch ? { ...input, launch } : input
}

export type ForkBotLaunchChange = {
  model?: string
  effort?: string
  clear?: boolean
}

/** What `orca bot set` saves for a bot: null clears its launch. A new model starts its options
 *  afresh, as the picker does; --effort alone keeps the bot's model. Throws on a launch the bot
 *  could not save. */
export function forkBotLaunchAfter(
  current: BotLaunch | undefined,
  change: ForkBotLaunchChange
): BotLaunch | null {
  if (change.clear) {
    return null
  }
  const model = change.model ?? current?.model
  const keepOptions = !change.model || change.model === current?.model
  const options: Record<string, string> = {
    ...(keepOptions ? current?.options : {}),
    ...(change.effort ? { effort: change.effort } : {})
  }
  const next = {
    ...(model ? { model } : {}),
    ...(Object.keys(options).length ? { options } : {})
  }
  const parsed = BotLaunchSchema.safeParse(next)
  if (!parsed.success) {
    throw new Error(`A bot cannot start on ${JSON.stringify(next)}.`)
  }
  return parsed.data
}

/** "model X, effort Y", or what a bot with no launch starts on. */
export function describeForkBotLaunch(launch: BotLaunch | null | undefined): string {
  if (!launch?.model && !launch?.options?.effort) {
    return 'native chat defaults'
  }
  return [
    launch.model ? `model ${launch.model}` : 'model from the native chat defaults',
    ...(launch.options?.effort ? [`effort ${launch.options.effort}`] : [])
  ].join(', ')
}
