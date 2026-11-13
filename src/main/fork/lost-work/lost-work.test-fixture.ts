// SLRM-2096: throwaway git repos for the lost work tests. Everything lives in a fresh temp folder;
// git runs with no global or system config, so no signing, hooks or user settings apply.
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorktreeList } from '../../../shared/git/worktrees/git-worktree-porcelain-parser'
import type { LostWorkGit } from './lost-work-git'
import type { LostWorkRepo, LostWorkScanDeps } from './lost-work-scan'

export type LostWorkSandbox = {
  root: string
  emptyConfig: string
  git: LostWorkGit
  run: (cwd: string, ...args: string[]) => Promise<string>
  dispose: () => Promise<void>
}

export async function createLostWorkSandbox(): Promise<LostWorkSandbox> {
  // realpath: macOS temp folders are symlinked, and git reports worktree paths resolved.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-lost-work-')))
  const emptyConfig = join(root, 'gitconfig')
  await writeFile(emptyConfig, '')
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: root,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.test',
    GIT_TERMINAL_PROMPT: '0'
  }
  const git: LostWorkGit = (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: options.cwd, env, signal: options.signal })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += String(chunk)))
      child.stderr.on('data', (chunk) => (stderr += String(chunk)))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`git ${args[0]}: ${stderr.trim()}`))
      )
      child.stdin.end(options.stdin ?? '')
    })
  return {
    root,
    emptyConfig,
    git,
    run: async (cwd, ...args) => (await git(args, { cwd })).trim(),
    dispose: () => rm(root, { recursive: true, force: true })
  }
}

/** A clone of a bare `origin`, with one commit on main pushed and origin/HEAD set. */
export async function createLostWorkRepo(sandbox: LostWorkSandbox, name = 'project') {
  const origin = join(sandbox.root, `${name}-origin.git`)
  const path = join(sandbox.root, name)
  await sandbox.run(sandbox.root, 'init', '-q', '--bare', '-b', 'main', origin)
  await sandbox.run(sandbox.root, 'clone', '-q', origin, path)
  await sandbox.run(path, 'checkout', '-q', '-B', 'main')
  await commitFile(sandbox, path, 'README.md', 'hello\n', 'base')
  await sandbox.run(path, 'push', '-q', '-u', 'origin', 'main')
  await sandbox.run(path, 'remote', 'set-head', 'origin', 'main')
  const repo: LostWorkRepo = { id: `repo-${name}`, name, path }
  return repo
}

export async function commitFile(
  sandbox: LostWorkSandbox,
  cwd: string,
  file: string,
  text: string,
  message: string
): Promise<string> {
  await writeFile(join(cwd, file), text)
  await sandbox.run(cwd, 'add', file)
  await sandbox.run(cwd, 'commit', '-q', '-m', message)
  return sandbox.run(cwd, 'rev-parse', 'HEAD')
}

/** Scan deps over the sandbox's git; `tracked` holds the worktree ids Orca would keep. */
export function lostWorkTestDeps(
  sandbox: LostWorkSandbox,
  tracked: Set<string>
): Omit<LostWorkScanDeps, 'lookupPullRequests'> {
  return {
    git: sandbox.git,
    listWorktrees: async (repo) =>
      parseWorktreeList(await sandbox.git(['worktree', 'list', '--porcelain'], { cwd: repo.path })),
    isTracked: (id) => tracked.has(id),
    pathExists: existsSync,
    now: () => 1_000
  }
}
