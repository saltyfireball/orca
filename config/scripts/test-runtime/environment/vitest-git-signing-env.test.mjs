import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { gitSigningOffEnv } from './vitest-git-signing-env.mjs'

const cleanup = []

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

it('ignores the developer global config: unsigned, no merge.ff, no hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'orca-git-signing-env-'))
  cleanup.push(root)
  const globalConfig = join(root, 'global.gitconfig')
  // Forward slashes: a backslash starts an escape in a gitconfig value.
  const missingSigner = join(root, 'missing-signer').replaceAll('\\', '/')
  const hooks = join(root, 'hooks').replaceAll('\\', '/')
  mkdirSync(hooks)
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  writeFileSync(
    globalConfig,
    `[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n\tforceSignAnnotated = true\n[gpg]\n\tprogram = ${missingSigner}\n[merge]\n\tff = false\n[core]\n\thooksPath = ${hooks}\n`
  )
  const inherited = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig }
  const env = { ...inherited, ...gitSigningOffEnv() }
  cleanup.push(env.GIT_CONFIG_GLOBAL)

  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim()

  git('init', '--quiet', '--initial-branch=main')
  git('commit', '--quiet', '--allow-empty', '-m', 'fixture')
  git('tag', 'v1.0.0')
  git('tag', '-m', 'release', 'v1.0.1')
  git('switch', '--quiet', '-c', 'feature')
  git('commit', '--quiet', '--allow-empty', '-m', 'work')
  git('switch', '--quiet', 'main')
  git('merge', '--quiet', '--squash', 'feature')

  expect(git('cat-file', '-t', 'v1.0.0')).toBe('commit')
  expect(git('log', '-1', '--format=%an %G?')).toBe('Test N')
})
