// Owner steps (FORK.md, BAD-747): the commands and manual acts an agent needs its owner to do, kept as
// data on the item instead of prose. One `steps` event holds an ordered list; a newer `steps` event
// replaces it. The owner's ticks and failures are `step` events after it. Pure: schema, the safety rule
// for a command that will be typed into a terminal, and how events fold into what a view shows.
import * as z from 'zod'
import { hasUnsafeShellCharacters } from '../fork/shell-fence'

export const BOT_ITEM_STEP_LIMITS = {
  steps: 20,
  title: 200,
  command: 4_000,
  host: 100,
  note: 1_000,
  error: 4_000
} as const

const L = BOT_ITEM_STEP_LIMITS

/** The command as it will be typed: line endings made LF and trailing blank space dropped, so no
 *  newline is ever left at its end for a terminal to take as Enter. */
export function normalizeBotItemStepCommand(command: string): string {
  return command.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

/** Whether a command is safe to type into a terminal: no control, escape (so no bracketed-paste end
 *  marker), bidi or invisible characters. Tab and line feed are the only controls allowed. */
export function isBotItemStepCommandSafe(command: string): boolean {
  return !hasUnsafeShellCharacters(command)
}

const StepSchema = z.object({
  title: z.string().trim().min(1, 'A step needs its title.').max(L.title),
  command: z
    .string()
    .max(L.command, `A step's command takes up to ${L.command} characters.`)
    .optional(),
  host: z.string().trim().max(L.host).optional(),
  note: z.string().trim().max(L.note).optional()
})

export type BotItemStepInput = z.infer<typeof StepSchema>

/** What a write carries: up to 20 steps; an empty list clears the item's steps. */
export const BotItemStepsSchema = z.array(StepSchema).max(L.steps, `Up to ${L.steps} steps.`)

/** A step as stored: empty fields dropped, the command normalized and safe, or an error naming it. */
export function parseBotItemSteps(
  value: unknown
): { ok: true; steps: BotItemStepInput[] } | { ok: false; error: string } {
  const parsed = BotItemStepsSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid steps.' }
  }
  const steps: BotItemStepInput[] = []
  for (const [index, raw] of parsed.data.entries()) {
    const command = raw.command === undefined ? '' : normalizeBotItemStepCommand(raw.command)
    if (command && !isBotItemStepCommandSafe(command)) {
      return {
        ok: false,
        error: `Step ${index + 1}: the command has a control, escape or hidden character. Send the plain text of the command.`
      }
    }
    steps.push({
      title: raw.title,
      ...(command ? { command } : {}),
      ...(raw.host ? { host: raw.host } : {}),
      ...(raw.note ? { note: raw.note } : {})
    })
  }
  return { ok: true, steps }
}

export type BotItemStepState = 'open' | 'done' | 'failed'

/** One step as a view shows it. `index` is its place in the set, from 0. */
export type BotItemStep = BotItemStepInput & {
  index: number
  state: BotItemStepState
  /** What the owner pasted when it did not work. */
  error?: string
}

/** The item's open steps: the set's event id, then the steps with the owner's marks. */
export type BotItemStepsView = { eventId: string; steps: BotItemStep[] }

type StepEvent = { id: number; data: Record<string, unknown> }

function storedSteps(data: Record<string, unknown>): BotItemStepInput[] {
  const parsed = parseBotItemSteps(data.steps)
  return parsed.ok ? parsed.steps : []
}

/** `steps` is the newest `steps` event; `marks` the `step` events by anyone after it, oldest first.
 *  The newest mark of each step wins; a mark naming another set is ignored. */
export function botItemStepsFromEvents(
  steps: StepEvent,
  marks: readonly StepEvent[],
  eventId: string
): BotItemStepsView | null {
  const stored = storedSteps(steps.data)
  if (stored.length === 0) {
    return null
  }
  const state = new Map<number, { state: BotItemStepState; error?: string }>()
  for (const mark of marks) {
    const { set, index, state: next, error } = mark.data
    if (
      mark.id <= steps.id ||
      set !== eventId ||
      typeof index !== 'number' ||
      (next !== 'open' && next !== 'done' && next !== 'failed')
    ) {
      continue
    }
    state.set(index, { state: next, ...(typeof error === 'string' ? { error } : {}) })
  }
  return {
    eventId,
    steps: stored.map((step, index) => ({
      ...step,
      index,
      ...(state.get(index) ?? { state: 'open' })
    }))
  }
}

/** Steps with a command to copy; the rest are manual (a login, a click). */
export function isBotItemManualStep(step: Pick<BotItemStepInput, 'command'>): boolean {
  return !step.command
}

export function botItemStepsDoneCount(view: BotItemStepsView): number {
  return view.steps.filter((step) => step.state === 'done').length
}

/** The first step still to do, which the panel makes prominent. A failed step counts as to do. */
export function botItemCurrentStepIndex(view: BotItemStepsView): number {
  const at = view.steps.findIndex((step) => step.state !== 'done')
  return at === -1 ? view.steps.length : at
}

const DONE_LABEL =
  /^(done|all done|finished|completed?|i(?:'ve| have)? done (?:it|them|all|that)|did (?:it|them)|ran (?:it|them)|all set)\b/i

/** The one quick reply that plainly says "done", for answering an ask once every step is ticked: only
 *  when the ask has a single question with exactly one such option. Null otherwise. */
export function botItemDoneReplyLabel(
  decisions: readonly { replies: readonly { label: string }[] }[]
): string | null {
  if (decisions.length !== 1) {
    return null
  }
  const matches = decisions[0]!.replies.filter((reply) => DONE_LABEL.test(reply.label.trim()))
  return matches.length === 1 ? matches[0]!.label : null
}

/** The open item's steps from the store's rows (its newest `steps` event and the marks since). */
export function botItemStepsOfRows(
  rows: { set: StepEvent; marks: readonly StepEvent[] } | undefined,
  eventId: (id: number) => string
): BotItemStepsView | null {
  return rows ? botItemStepsFromEvents(rows.set, rows.marks, eventId(rows.set.id)) : null
}
