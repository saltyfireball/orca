// Command guards (FORK.md, BAD-686): the deny rules. `evaluateCommandGuard` reads one shell command
// (see command-guards-shell.ts) and answers allow or deny with the rule and a reason. Pure: the
// host passes in what it knows about the workspace and git, and the command is never run.
import { posix, win32 } from 'node:path'
import type { CommandGuardRuleId } from './command-guards'
import { readShellCommands, type SimpleCommand } from './command-guards-shell'

export type CommandGuardGit = {
  /** The branch checked out in the directory; null when detached or not a repo. */
  current: string | null
  /** The repo's default branch when it is known. */
  defaultBranch: string | null
}

export type CommandGuardContext = {
  workspaceRoot: string
  home: string | null
  /** Folders where deleting is fine besides the workspace (temp folders, the user's own list). */
  deleteRoots: readonly string[]
  /** Branch names the history rules protect; empty uses each repo's default branch. */
  protectedBranches: readonly string[]
  gitState: (dir: string) => CommandGuardGit
  /** Rules that are off for this workspace. */
  off: ReadonlySet<CommandGuardRuleId>
}

export type CommandGuardVerdict =
  | { allowed: true }
  | { allowed: false; rule: CommandGuardRuleId; reason: string }

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'rimraf'])
const FORCE_PUSH_FLAG = /^--(force|force-with-lease|force-if-includes|mirror)(=.*)?$/
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const RISKY_WORD =
  /(^|[^A-Za-z0-9_-])(rm|rmdir|unlink|shred|rimraf|git|orca|find|xargs)([^A-Za-z0-9_-]|$)/

const deny = (rule: CommandGuardRuleId, reason: string): CommandGuardVerdict => ({
  allowed: false,
  rule,
  reason
})

function pathApi(root: string): typeof posix {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(root) ? win32 : posix
}

/** The absolute, normalized path a word names; null when a variable or a missing cwd hides it. */
function resolveWord(word: string, cwd: string | null, ctx: CommandGuardContext): string | null {
  const api = pathApi(ctx.workspaceRoot)
  let text = word
  if (text === '~' || text.startsWith('~/')) {
    text = ctx.home ? ctx.home + text.slice(1) : '$'
  }
  text = text.replace(/^\$(HOME|\{HOME\})(?=\/|$)/, ctx.home ?? '$')
  text = text.replace(/^\$(PWD|\{PWD\})(?=\/|$)/, cwd ?? '$')
  if (/[$`]/.test(text) || text.startsWith('~')) {
    return null
  }
  if (!api.isAbsolute(text)) {
    return cwd === null ? null : api.normalize(api.join(cwd, text))
  }
  return api.normalize(text)
}

function isInside(path: string, root: string, api: typeof posix): boolean {
  const relative = api.relative(root, path)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative))
  )
}

function pathArguments(args: readonly string[]): string[] {
  const dashDash = args.indexOf('--')
  return args.filter((arg, index) =>
    dashDash === -1
      ? !arg.startsWith('-')
      : index > dashDash || (index < dashDash && !arg.startsWith('-'))
  )
}

function findTargets(args: readonly string[]): string[] | null {
  const deletes =
    args.includes('-delete') ||
    args.some(
      (arg, i) =>
        /^-(exec|execdir|ok|okdir)$/.test(arg) &&
        DELETERS.has((args[i + 1] ?? '').slice((args[i + 1] ?? '').lastIndexOf('/') + 1))
    )
  if (!deletes) {
    return null
  }
  const roots: string[] = []
  for (const arg of args) {
    if (arg.startsWith('-') || arg === '(' || arg === '!') {
      break
    }
    roots.push(arg)
  }
  return roots.length > 0 ? roots : ['.']
}

function checkDelete(call: SimpleCommand, ctx: CommandGuardContext): CommandGuardVerdict | null {
  const api = pathApi(ctx.workspaceRoot)
  const targets = call.name === 'find' ? findTargets(call.args) : pathArguments(call.args)
  if (targets === null) {
    return null
  }
  if (call.stdinArgs) {
    return deny(
      'delete-outside-workspace',
      `${call.name} would delete paths read from another command, so Orca cannot check they are inside the workspace.`
    )
  }
  for (const target of targets) {
    const resolved = resolveWord(target, call.cwd, ctx)
    if (resolved === null) {
      return deny(
        'delete-outside-workspace',
        `${call.name} ${target}: Orca cannot tell where this path points (a variable, ~user or an unknown directory).`
      )
    }
    if (
      ![ctx.workspaceRoot, ...ctx.deleteRoots].some((root) =>
        isInside(resolved, api.normalize(root), api)
      )
    ) {
      return deny(
        'delete-outside-workspace',
        `${call.name} would delete ${resolved}, which is outside the workspace ${ctx.workspaceRoot}.`
      )
    }
  }
  return null
}

type GitCall = { sub: string; rest: string[]; dir: string | null }

function readGit(call: SimpleCommand, ctx: CommandGuardContext): GitCall | null {
  let dir = call.cwd
  const args = call.args
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-C') {
      dir = args[i + 1] === undefined ? null : resolveWord(args[i + 1], dir, ctx)
      i += 1
    } else if (GIT_VALUE_OPTIONS.has(arg)) {
      dir = arg === '-c' || arg === '--namespace' ? dir : null
      i += 1
    } else if (arg.startsWith('--git-dir=') || arg.startsWith('--work-tree=')) {
      dir = null
    } else if (!arg.startsWith('-')) {
      return { sub: arg, rest: args.slice(i + 1), dir }
    }
  }
  return null
}

function protectedOn(git: GitCall, ctx: CommandGuardContext): { names: string[]; onIt: boolean } {
  const state = git.dir === null ? { current: null, defaultBranch: null } : ctx.gitState(git.dir)
  const names =
    ctx.protectedBranches.length > 0
      ? [...ctx.protectedBranches]
      : [state.defaultBranch ?? 'main', ...(state.defaultBranch ? [] : ['master'])]
  return { names, onIt: state.current !== null && names.includes(state.current) }
}

/** Only a help flag: the command prints usage and changes nothing. */
const asksOnlyForHelp = (args: readonly string[]): boolean =>
  args.length > 0 && args.every((arg) => arg === '--help' || arg === '-h')

const firstName = (rest: readonly string[]): string | undefined =>
  rest.find((arg) => !arg.startsWith('-'))

function checkGit(git: GitCall, ctx: CommandGuardContext): CommandGuardVerdict | null {
  const { sub, rest } = git
  if (sub === 'push') {
    const forced =
      rest.some((arg) => FORCE_PUSH_FLAG.test(arg)) ||
      rest.some((arg) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) ||
      rest.some((arg) => arg.startsWith('+') && arg.length > 1)
    if (forced) {
      return deny('force-push', 'git push with a force option can overwrite commits on the remote.')
    }
    const { names } = protectedOn(git, ctx)
    const deleting = rest.includes('--delete') || rest.includes('-d')
    const targets = rest.filter((arg) => !arg.startsWith('-'))
    const deleted = targets.find(
      (arg, i) =>
        names.includes(arg.replace(/^:/, '')) && (arg.startsWith(':') || (deleting && i > 0))
    )
    return deleted
      ? deny(
          'default-branch-rewrite',
          `git push would delete the protected branch ${deleted.replace(/^:/, '')}.`
        )
      : null
  }
  if (sub === 'worktree' && rest[0] === 'remove' && !asksOnlyForHelp(rest.slice(1))) {
    return deny(
      'remove-worktree',
      "git worktree remove deletes a worktree, which may be another agent's workspace."
    )
  }
  if (sub === 'filter-branch' || sub === 'filter-repo') {
    return deny('default-branch-rewrite', `git ${sub} rewrites history.`)
  }
  const { names, onIt } = protectedOn(git, ctx)
  const here = onIt ? 'the default branch is checked out' : null
  if (here && sub === 'reset' && rest.includes('--hard')) {
    return deny('default-branch-rewrite', `git reset --hard would discard work: ${here}.`)
  }
  if (here && (sub === 'rebase' || (sub === 'commit' && rest.includes('--amend')))) {
    return deny('default-branch-rewrite', `git ${sub} rewrites history: ${here}.`)
  }
  const flags = rest.filter((arg) => arg.startsWith('-'))
  const name = firstName(rest)
  const moves =
    (sub === 'branch' && flags.some((flag) => /^-(f|D|M)$|^--(force|delete)$/.test(flag))) ||
    (sub === 'checkout' && flags.includes('-B')) ||
    (sub === 'switch' && (flags.includes('-C') || flags.includes('--force-create')))
  if (moves && name !== undefined && names.includes(name)) {
    return deny(
      'default-branch-rewrite',
      `git ${sub} would move or delete the protected branch ${name}.`
    )
  }
  if (sub === 'update-ref' && rest.some((arg) => names.some((n) => arg === `refs/heads/${n}`))) {
    return deny('default-branch-rewrite', 'git update-ref would move the protected branch.')
  }
  return null
}

function checkOrca(call: SimpleCommand): CommandGuardVerdict | null {
  const words = call.args.filter((arg) => !arg.startsWith('-'))
  if (
    words[0] === 'worktree' &&
    ['rm', 'remove', 'delete'].includes(words[1]) &&
    !asksOnlyForHelp(call.args.slice(call.args.indexOf(words[1]) + 1))
  ) {
    return deny(
      'remove-worktree',
      "orca worktree rm deletes a workspace, which may be another agent's."
    )
  }
  const touchesGuards = call.args.some((arg) => /^forkCommandGuard/i.test(arg))
  if (words[0] === 'settings' && ['set', 'reset', 'import'].includes(words[1]) && touchesGuards) {
    return deny('guard-config', 'An agent may not change the command guard settings.')
  }
  return words[0] === 'command-guards' && ['allow', 'disallow'].includes(words[1])
    ? deny('guard-config', 'An agent may not change what the command guards allow.')
    : null
}

/** Allow or deny one shell command the agent is about to run in the workspace. */
export function evaluateCommandGuard(
  command: string,
  ctx: CommandGuardContext
): CommandGuardVerdict {
  const { commands, problem } = readShellCommands(command, ctx.workspaceRoot, ctx.home)
  const verdicts: (CommandGuardVerdict | null)[] = commands.map((call) => {
    if (DELETERS.has(call.name) || call.name === 'find') {
      return checkDelete(call, ctx)
    }
    if (call.name === 'git') {
      const git = readGit(call, ctx)
      return git ? checkGit(git, ctx) : null
    }
    return call.name === 'orca' ? checkOrca(call) : null
  })
  const risky = problem ? RISKY_WORD.exec(problem.scope) : null
  if (problem && risky) {
    verdicts.push(
      deny(
        'unreadable-command',
        `Orca could not read this command: ${problem.why} (at: ${problem.part}), and it uses a verb the guard watches (${risky[2]}). Reword it: close the quote, or put quoted text in a heredoc with a quoted delimiter (<<'EOF') so it is read as data.`
      )
    )
  }
  for (const verdict of verdicts) {
    if (verdict && !verdict.allowed && !ctx.off.has(verdict.rule)) {
      return verdict
    }
  }
  return { allowed: true }
}
