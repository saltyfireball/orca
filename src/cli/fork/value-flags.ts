// Fork commands whose flag shares a name with an upstream boolean flag but takes a value
// (FORK.md, SLRM-2310). Without this, `--wait 5` parses as a bare `--wait` plus a stray
// positional, and only `--wait=5` works.

type ForkValueFlags = { path: readonly string[]; flags: ReadonlySet<string> }

const FORK_VALUE_FLAGS: readonly ForkValueFlags[] = [
  { path: ['servers', 'update'], flags: new Set(['wait']) },
  { path: ['servers', 'rollback'], flags: new Set(['wait']) }
]

/** True when `flag`, seen after `commandPath`, takes the next token as its value on a fork command. */
export function forkFlagTakesValue(commandPath: readonly string[], flag: string): boolean {
  return FORK_VALUE_FLAGS.some(
    (entry) =>
      entry.flags.has(flag) &&
      entry.path.length <= commandPath.length &&
      entry.path.every((part, index) => commandPath[index] === part)
  )
}
