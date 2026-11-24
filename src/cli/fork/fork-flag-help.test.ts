// BAD-764: every option line of a fork command is its own, not the stock text of a flag that shares
// its name, and none is empty.
import { describe, expect, it } from 'vitest'
import { CLI_GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'
import { findCommandSpec } from '../arguments/args'
import type { CommandSpec } from '../discovery/command-spec'
import { formatCommandHelp, formatFlagHelp } from '../discovery/help'
import { COMMAND_SPECS } from '../specs'
import { FORK_FLAG_HELP, forkFlagHelp } from './fork-flag-help'

const GLOBAL_FLAGS: ReadonlySet<string> = new Set(CLI_GLOBAL_FLAGS)
/** Means the same on every command that takes it, so the stock text is right. */
const SAME_EVERYWHERE = new Set(['worktree'])

/** Flags the fork adds to stock commands through a hook on the spec list. */
const ADDED_TO_STOCK = [
  'mcp-profile',
  'profile',
  'card',
  'setup-missing',
  'as-service',
  'done-check',
  'require-pr-checks',
  'done-max-rounds',
  'review',
  'review-focus',
  'review-agent',
  'review-max-rounds'
]
const STOCK_WITH_ADDED = [
  'agent launch',
  'automations create',
  'worktree create',
  'orchestration worker-start',
  'orchestration task-create',
  'orchestration send'
]

const modules = import.meta.glob<Record<string, unknown>>('./*-specs.ts', { eager: true })
const forkPaths = new Set(
  Object.values(modules)
    .flatMap((exported) => Object.values(exported))
    .filter((value): value is CommandSpec[] => Array.isArray(value))
    .flat()
    .map((spec) => spec.path.join(' '))
)

function optionLine(command: string, flag: string): string {
  const spec = findCommandSpec(COMMAND_SPECS, command.split(' '))
  const lines = spec ? formatCommandHelp(spec).split('\n') : []
  return lines.map((line) => line.trim()).find((line) => line.startsWith(`--${flag}`)) ?? ''
}

describe('the option lines of fork commands', () => {
  it('are their own on every fork command', () => {
    const missing = COMMAND_SPECS.filter((spec) => forkPaths.has(spec.path.join(' '))).flatMap(
      (spec) =>
        spec.allowedFlags
          .filter((flag) => !GLOBAL_FLAGS.has(flag))
          .filter((flag) => {
            const own = forkFlagHelp(spec.path.join(' '), flag)
            return own === undefined && !SAME_EVERYWHERE.has(flag)
          })
          .map((flag) => `${spec.path.join(' ')} --${flag}`)
    )
    expect(forkPaths.size).toBeGreaterThan(80)
    expect(missing).toEqual([])
  })

  it('are their own for the flags the fork adds to stock commands', () => {
    const missing = STOCK_WITH_ADDED.flatMap((command) =>
      (findCommandSpec(COMMAND_SPECS, command.split(' '))?.allowedFlags ?? [])
        .filter((flag) => ADDED_TO_STOCK.includes(flag))
        .filter((flag) => forkFlagHelp(command, flag) === undefined)
        .map((flag) => `${command} --${flag}`)
    )
    expect(missing).toEqual([])
  })

  it('name only commands and flags there are, and are what --help prints', () => {
    for (const [command, flags] of Object.entries(FORK_FLAG_HELP)) {
      const spec = findCommandSpec(COMMAND_SPECS, command.split(' '))
      expect(spec, command).toBeDefined()
      for (const flag of Object.keys(flags)) {
        expect(spec?.allowedFlags, command).toContain(flag)
        expect(formatCommandHelp(spec ?? COMMAND_SPECS[0])).toContain(
          `  ${forkFlagHelp(command, flag)}`
        )
      }
    }
  })

  it('say what the automation caps are, not what stock --day is', () => {
    expect(optionLine('guards automation-cap', 'day')).toMatch(/^--day <usd\|default> +Spend cap/)
    expect(optionLine('guards automation-cap', 'per-run')).toMatch(/Spend cap in USD of one run/)
    expect(optionLine('guards automation-cap', 'week')).toMatch(/Spend cap in USD of the last 7/)
    expect(optionLine('automations create', 'day')).toBe(formatFlagHelp('day'))
    expect(optionLine('goal set', 'until-cmd')).toMatch(/exit 0 means the goal is met$/)
  })
})
