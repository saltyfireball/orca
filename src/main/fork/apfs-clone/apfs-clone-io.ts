// SLRM-2270 (FORK.md): the Git and clone commands the APFS clone hooks run, behind one small
// interface so tests can run them against throwaway repositories.
import { runProcess } from '@orca/process-host'
import { stat } from 'node:fs/promises'
import { gitExecFileAsync } from '../../git/command-runner/git-exec-file'
import { resolveWorktreeAddTimeoutMs } from '../../git/worktrees/worktree-operation-options'

export type ForkApfsGitRun = (
  args: string[],
  cwd: string,
  extra?: { env?: NodeJS.ProcessEnv; long?: boolean }
) => Promise<string>

export type ForkApfsCloneIo = {
  git: ForkApfsGitRun
  /** Clone the folder `source` to `target` (which must not exist) in one APFS clonefile(2) call. */
  cloneDir: (source: string, target: string) => Promise<void>
  platform: NodeJS.Platform
}

const OSASCRIPT = '/usr/bin/osascript'
/**
 * clonefile(2) clones a whole folder tree in one call, where `cp -c` clones file by file (slower
 * than a Git checkout for a large tree). Node has no binding for it; JavaScript for Automation,
 * part of every macOS, can call it. The paths arrive as arguments, never inside the script.
 * Flag 1 is CLONE_NOFOLLOW: a symlinked source is cloned as the link, never followed.
 */
const CLONE_DIR_SCRIPT = [
  'function run(argv) {',
  "  ObjC.bindFunction('clonefile', ['int', ['char *', 'char *', 'unsigned int']])",
  '  return String($.clonefile(argv[0], argv[1], 1))',
  '}'
].join('\n')

async function runCloneDir(source: string, target: string, timeoutMs: number): Promise<void> {
  const result = await runProcess({
    program: OSASCRIPT,
    args: ['-l', 'JavaScript', '-e', CLONE_DIR_SCRIPT, source, target],
    timeoutMs,
    maxOutputBytes: 64 * 1024,
    killOnOutputLimit: true
  })
  if (result.code !== 0 || result.timedOut || result.stdout.trim() !== '0') {
    throw new Error(`clonefile failed for ${source}`)
  }
}

export function defaultForkApfsCloneIo(signal?: AbortSignal): ForkApfsCloneIo {
  return {
    platform: process.platform,
    git: async (args, cwd, extra) => {
      const { stdout } = await gitExecFileAsync(args, {
        cwd,
        ...(signal ? { signal } : {}),
        ...(extra?.env ? { env: extra.env } : {}),
        // Building the cache or checking out writes a whole tree: give it the checkout's budget.
        ...(extra?.long ? { timeout: resolveWorktreeAddTimeoutMs() } : {})
      })
      return String(stdout)
    },
    cloneDir: (source, target) => runCloneDir(source, target, resolveWorktreeAddTimeoutMs())
  }
}

/** True when both paths are on one volume, the only case where clonefile can work. */
export async function sameVolume(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([stat(a), stat(b)])
  return left.dev === right.dev
}

export function exitCode(error: unknown): unknown {
  return error instanceof Object && 'code' in error ? error.code : undefined
}
