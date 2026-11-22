// BAD-678 (FORK.md "Turn checkpoints"): the git work. A checkpoint is a commit of a workspace's
// whole working tree (tracked changes and untracked files, never ignored ones) in a shadow bare
// repository under Orca's data folder, so the project's own .git (index, refs, stash) is never
// touched. The shadow repository keeps its own index, so a later snapshot only re-reads files whose
// stat changed. Every call goes through an injected runner: the app uses its admitted git runner,
// tests use real git on throwaway folders.
import { chmod, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  ForkTurnCheckpoint,
  ForkTurnCheckpointKind
} from '../../../shared/fork/turn-checkpoints'

export type CheckpointGitOptions = { cwd: string; env?: Record<string, string>; stdin?: string }
/** Runs git and resolves its stdout; rejects on a non-zero exit. */
export type CheckpointGit = (args: string[], options: CheckpointGitOptions) => Promise<string>

export type Shadow = { gitDir: string; workTree: string }

/** A checkpoint with the git facts the service needs. */
export type StoredCheckpoint = ForkTurnCheckpoint & {
  commit: string
  tree: string
  /** The checkpoint before this one when it was taken. */
  prev: string | null
  /** The project's HEAD when it was taken; null for a folder or a repository with no commit. */
  head: string | null
}

export type Meta = {
  kind: ForkTurnCheckpointKind
  createdAt: number
  files: number
  prev: string | null
  head: string | null
  sessionId?: string
  agent?: string
  prompt?: string
  restoredFrom?: string
  undoTo?: string
}

export type CheckpointOrigin = {
  sessionId?: string | null
  agent?: string | null
  prompt?: string | null
  restoredFrom?: string
  undoTo?: string
}

export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_BIG_FILES = 2000
export const MAX_PATCH_CHARS = 400_000
export const MAX_PROMPT_CHARS = 160
const STAT_BATCH = 64
const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: 'Orca checkpoint',
  GIT_AUTHOR_EMAIL: 'checkpoint@orca.invalid',
  GIT_COMMITTER_NAME: 'Orca checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@orca.invalid'
}
const QUIET = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false']

function shadowEnv(shadow: Shadow): Record<string, string> {
  return {
    GIT_DIR: shadow.gitDir,
    GIT_WORK_TREE: shadow.workTree,
    GIT_INDEX_FILE: join(shadow.gitDir, 'index'),
    ...AUTHOR_ENV
  }
}

/** Runs git against the shadow store from its own folder, so the project is never the cwd. */
export function inShadow(
  git: CheckpointGit,
  shadow: Shadow,
  args: string[],
  extra: Partial<CheckpointGitOptions> = {}
): Promise<string> {
  return git([...QUIET, ...args], { cwd: shadow.gitDir, env: shadowEnv(shadow), ...extra })
}

/** Runs git in the working tree against the shadow store (add and checkout-index need the tree). */
export function inTree(
  git: CheckpointGit,
  shadow: Shadow,
  args: string[],
  extra: Partial<CheckpointGitOptions> = {}
): Promise<string> {
  return git([...QUIET, ...args], { cwd: shadow.workTree, env: shadowEnv(shadow), ...extra })
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function ensureShadow(git: CheckpointGit, shadow: Shadow): Promise<void> {
  if (await pathExists(join(shadow.gitDir, 'HEAD'))) {
    return
  }
  await mkdir(dirname(shadow.gitDir), { recursive: true, mode: 0o700 })
  await git([...QUIET, 'init', '--bare', '-q', shadow.gitDir], { cwd: dirname(shadow.gitDir) })
  await chmod(shadow.gitDir, 0o700).catch(() => undefined)
  for (const [key, value] of [
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    ['core.fsmonitor', 'false'],
    ['core.longpaths', 'true'],
    ['gc.auto', '0']
  ]) {
    await inShadow(git, shadow, ['config', key, value])
  }
  await writeFile(join(shadow.gitDir, 'orca-path'), shadow.workTree, { mode: 0o600 })
}

/** The project's own info/exclude, so a path the project hides by hand stays out of checkpoints. */
async function projectExcludes(git: CheckpointGit, workTree: string): Promise<string> {
  try {
    const out = (await git(['rev-parse', '--git-path', 'info/exclude'], { cwd: workTree })).trim()
    if (!out) {
      return ''
    }
    return await readFile(resolve(workTree, out), 'utf8')
  } catch {
    return ''
  }
}

function excludeLine(path: string): string {
  return `/${path.replace(/[\\*?[\]!# ]/g, (char) => `\\${char}`)}`
}

async function readBigFiles(shadow: Shadow): Promise<string[]> {
  try {
    return (await readFile(join(shadow.gitDir, 'orca-big-files'), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

async function statSizes(workTree: string, paths: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for (let index = 0; index < paths.length; index += STAT_BATCH) {
    await Promise.all(
      paths.slice(index, index + STAT_BATCH).map(async (path) => {
        try {
          const info = await lstat(join(workTree, path))
          if (info.isFile()) {
            sizes.set(path, info.size)
          }
        } catch {
          // Gone since it was listed.
        }
      })
    )
  }
  return sizes
}

/**
 * Keeps files over the size cap out of the shadow store. New (untracked in the shadow index) files
 * are measured before git hashes them, so a big binary is never read into the store.
 */
async function applySizeCap(
  git: CheckpointGit,
  shadow: Shadow,
  maxFileBytes: number
): Promise<void> {
  const listed = await inTree(git, shadow, ['ls-files', '-o', '--exclude-standard', '-z'])
  const fresh = listed.split('\0').filter((path) => path.length > 0 && !path.includes('\n'))
  const known = await readBigFiles(shadow)
  const stillBig: string[] = []
  const knownSizes = await statSizes(shadow.workTree, known)
  for (const path of known) {
    if ((knownSizes.get(path) ?? 0) > maxFileBytes) {
      stillBig.push(path)
    }
  }
  const freshSizes = await statSizes(shadow.workTree, fresh)
  for (const [path, size] of freshSizes) {
    if (size > maxFileBytes && !stillBig.includes(path)) {
      stillBig.push(path)
    }
  }
  const kept = stillBig.slice(-MAX_BIG_FILES)
  await writeFile(join(shadow.gitDir, 'orca-big-files'), kept.join('\n'), { mode: 0o600 })
  await mkdir(join(shadow.gitDir, 'info'), { recursive: true })
  const project = await projectExcludes(git, shadow.workTree)
  const lines = [
    project.trimEnd(),
    '# orca: files over the checkpoint size cap',
    ...kept.map(excludeLine)
  ]
  await writeFile(join(shadow.gitDir, 'info', 'exclude'), `${lines.join('\n')}\n`, { mode: 0o600 })
}

/** Reads the working tree into the shadow index and returns its tree id. */
export async function stageWorkTree(
  git: CheckpointGit,
  shadow: Shadow,
  maxFileBytes: number
): Promise<string> {
  await ensureShadow(git, shadow)
  await applySizeCap(git, shadow, maxFileBytes)
  await inTree(git, shadow, ['add', '-A', '--ignore-errors', '--', '.']).catch(
    // --ignore-errors still exits 1 for an unreadable file; the rest was staged.
    async (error: unknown) => {
      const tree = await inShadow(git, shadow, ['write-tree']).catch(() => null)
      if (!tree) {
        throw error
      }
    }
  )
  return (await inShadow(git, shadow, ['write-tree'])).trim()
}
