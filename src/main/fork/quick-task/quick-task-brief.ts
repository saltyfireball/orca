// Quick task (SLRM-2428, FORK.md): what the router bot is told with each task. The bot's preamble
// already teaches `bot list`, handoffs and `--on`; this names the one job and its steps, so the
// router hands the task on instead of doing it.
import type { QuickTaskSource } from '../../../shared/fork/quick-task-contract'
import { FORK_QUICK_TASK_BUILT_IN_PLACEMENT } from '../../../shared/fork/quick-task'

const SOURCE_LABEL: Record<QuickTaskSource, string> = {
  desktop: 'the quick task box on the desktop',
  mobile: 'the quick task box on the phone',
  cli: '`orca quick-task`'
}

/** One line for SOUL.md's "does", so the router keeps its job between tasks. */
export const QUICK_TASK_ROUTER_DOES =
  'Each message is a task from its owner. It finds the bot that owns the task (`bot list`, which includes bots on paired servers), suggests a machine for code work, hands the task to that bot in a new chat, and stops. It never does the work itself.'

export type QuickTaskBriefInput = {
  text: string
  source: QuickTaskSource
  /** Null: no machine suggestion. */
  placementCommand: string | null
  /** The orca command as the bot's shell should run it. */
  cli: string
}

/** The placement command as the router runs it: the built-in one uses the session's own orca. */
export function quickTaskPlacementCommand(command: string, cli: string): string {
  return command === FORK_QUICK_TASK_BUILT_IN_PLACEMENT ? `${cli} placement --json` : command
}

export function quickTaskRouterBrief(input: QuickTaskBriefInput): string {
  const { cli } = input
  const placement = input.placementCommand
    ? quickTaskPlacementCommand(input.placementCommand, cli)
    : null
  const steps = [
    // BAD-694: a card routes by its label or the owner's map, so the router does not guess.
    `If the task names a Linear card by its key (such as ABC-12), run \`${cli} card route <KEY> --hand-off\` and do only what it prints; skip the steps below.`,
    `Run \`${cli} bot list\`. It lists the bots on this computer and on every paired server, what each is for, and the exact \`--on\`/\`--to\` that reaches each one.`,
    'Pick the one bot whose purpose owns this task (its project, its repos, its profile). A bot on a paired server counts the same as one here.',
    placement
      ? `If the task is code work, run \`${placement}\`${input.placementCommand === FORK_QUICK_TASK_BUILT_IN_PLACEMENT ? ' (add `--repo <project>` when you know the project)' : ` (when it takes a repo, as its \`-h\` says, add \`--repo\` with the project's path from \`${cli} repo list\`)`} and read its top suggestion: the machine, and the \`--on\` and \`--repo\` values for \`${cli} orchestration worker-start\`. Do not start the worker yourself.`
      : 'Do not suggest a machine; the receiving bot picks one.',
    `Hand it off: \`${cli} orchestration send [--on <server>] --to bot:<name> --type handoff --chat new --subject "<short title>" --body "<the task word for word${placement ? ', then a line such as: Placement: <machine> has the most room, start the worker there with --on <x> --repo <y>' : ''}>"\`.`,
    `If no bot fits, propose one with \`${cli} bot create --offer --name "<name>" --purpose "<one sentence naming the repos it owns>"\`, then tell your owner here to press Create bot and that you will hand the task over once it exists. When the task itself is to set up bots, the cards are the whole job: list the cards you posted and stop, with no handoff and no question.`,
    'If two or three bots could own it and you cannot tell which, hand it to the likeliest one (the bot whose purpose shares the most words with the task) and say in the handoff that you chose it; the receiving bot can pass it on. Ask your owner here only when no bot is even a plausible fit.',
    'After the handoff, reply with one line: which bot took it and on which machine. Then stop.'
  ]
  return [
    `Quick task, from ${SOURCE_LABEL[input.source]}. Route it; do not do the work yourself.`,
    '',
    'Task:',
    input.text.trim(),
    '',
    'Steps:',
    ...steps.map((step, index) => `${index + 1}. ${step}`)
  ].join('\n')
}
