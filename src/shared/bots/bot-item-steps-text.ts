// How an agent hands steps over (`--steps-file`) and how a host that keeps no steps shows them:
// JSON, or a plain text form with one step per `step:` line, so quotes, pipes and backslashes need no
// escaping. Pure.
import { parseBotItemSteps, type BotItemStepInput } from './bot-item-steps'

const KEY = /^(step|host|note|command):[ \t]*(.*)$/

/** The text form:
 *
 *      step: Store the token
 *      host: laptop
 *      note: Paste it, then press Enter.
 *      command:
 *        tr -d '\n' < token | secret set NAME
 *
 *  A `step:` line starts a step. Lines under `command:` belong to the command until the next key
 *  line; they are dedented by their shared indent, and trailing blank lines drop. A step with no
 *  `command:` is manual. Lines before the first `step:` are ignored. */
export function parseBotItemStepsText(text: string): BotItemStepInput[] {
  const steps: { title?: string; host?: string; note?: string; command?: string[] }[] = []
  let inCommand = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const key = KEY.exec(line)
    if (key && !(inCommand && /^\s/.test(line))) {
      const [, name, value] = key as unknown as [string, string, string]
      inCommand = false
      if (name === 'step') {
        steps.push({ title: value })
        continue
      }
      const step = steps.at(-1)
      if (!step) {
        continue
      }
      if (name === 'command') {
        step.command = value ? [value] : []
        inCommand = true
      } else {
        step[name as 'host' | 'note'] = value
      }
      continue
    }
    const step = steps.at(-1)
    if (inCommand && step?.command) {
      step.command.push(line)
    }
  }
  return steps.map((step) => ({
    title: step.title ?? '',
    ...(step.command ? { command: dedent(step.command) } : {}),
    ...(step.host ? { host: step.host } : {}),
    ...(step.note ? { note: step.note } : {})
  }))
}

function dedent(lines: string[]): string {
  const filled = lines.filter((line) => line.trim())
  const indent = Math.min(...filled.map((line) => /^[ \t]*/.exec(line)![0].length))
  return lines
    .map((line) => line.slice(Number.isFinite(indent) ? Math.min(indent, line.length) : 0))
    .join('\n')
}

/** `--steps-file` content: a JSON array (or `{ "steps": [...] }`), or the text form. */
export function parseBotItemStepsInput(
  content: string
): { ok: true; steps: BotItemStepInput[] } | { ok: false; error: string } {
  const trimmed = content.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch (error) {
      return { ok: false, error: `The steps are not valid JSON: ${(error as Error).message}` }
    }
    const list =
      json && typeof json === 'object' && 'steps' in json && Array.isArray(json.steps)
        ? json.steps
        : json
    return parseBotItemSteps(list)
  }
  return parseBotItemSteps(parseBotItemStepsText(content))
}

/** The steps as Markdown, for a host that keeps none: a numbered list, each command in its own fenced
 *  block so it can still be copied. */
export function botItemStepsMarkdown(steps: readonly BotItemStepInput[]): string {
  return steps
    .map((step, index) => {
      const host = step.host ? ` (on ${step.host})` : ''
      const head = `${index + 1}. **${step.title}**${host}${step.note ? ` - ${step.note}` : ''}`
      if (!step.command) {
        return head
      }
      const fence = '`'.repeat(Math.max(3, longestTickRun(step.command) + 1))
      const body = [`${fence}sh`, ...step.command.split('\n'), fence].map((line) => `   ${line}`)
      return [head, ...body].join('\n')
    })
    .join('\n')
}

function longestTickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}
