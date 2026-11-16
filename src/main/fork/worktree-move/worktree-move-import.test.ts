import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  rename,
  copyFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeClaudeProjectPath } from '../../ai-vault/scanners/claude/claude-project-dir-encoding'
import type { WorktreeMoveFs } from './worktree-move-service'
import { worktreeMoveImport, worktreeMoveTranscriptDestination } from './worktree-move-import'

let root: string

const fs: WorktreeMoveFs = {
  size: async (path) => (await stat(path).catch(() => null))?.size ?? null,
  read: (path) => readFile(path),
  write: async (path, data) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  },
  exists: async (path) => (await stat(path).catch(() => null)) !== null,
  rename: (from, to) => rename(from, to),
  copy: (from, to) => copyFile(from, to),
  tempDir: () => mkdtemp(join(root, 'tmp-')),
  remove: (path) => rm(path, { recursive: true, force: true })
}

function deps() {
  return {
    fs,
    home: () => '/srv/bob',
    claudeHome: () => join(root, 'claude'),
    codexHome: () => join(root, 'codex'),
    now: () => new Date(1000)
  }
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'worktree-move-import-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('worktreeMoveTranscriptDestination', () => {
  it('files Claude under the target bucket and Codex under its dated folder', () => {
    expect(
      worktreeMoveTranscriptDestination(deps(), { agent: 'claude', relPath: 'a.jsonl' }, '/srv/r')
    ).toBe(join(root, 'claude', 'projects', encodeClaudeProjectPath('/srv/r'), 'a.jsonl'))
    expect(
      worktreeMoveTranscriptDestination(
        deps(),
        { agent: 'codex', relPath: '2026/01/02/rollout-x.jsonl' },
        '/srv/r'
      )
    ).toBe(join(root, 'codex', 'sessions', '2026', '01', '02', 'rollout-x.jsonl'))
  })

  it('refuses names that could leave the store', () => {
    for (const relPath of ['../x.jsonl', 'a/b.jsonl', 'x.txt', '..']) {
      expect(
        worktreeMoveTranscriptDestination(deps(), { agent: 'claude', relPath }, '/srv/r')
      ).toBeNull()
    }
    expect(
      worktreeMoveTranscriptDestination(deps(), { agent: 'codex', relPath: '../../x.jsonl' }, '/r')
    ).toBeNull()
  })
})

describe('worktreeMoveImport', () => {
  it('writes the transcript with paths rewritten and keeps an earlier copy beside it', async () => {
    const dest = join(
      root,
      'claude',
      'projects',
      encodeClaudeProjectPath('/srv/bob/repo'),
      'p.jsonl'
    )
    await fs.write(dest, 'old')
    const git = async () => ''
    const result = await worktreeMoveImport(
      deps(),
      {
        worktree: 'id:w',
        sourcePath: '/home/alice/repo',
        sourceHome: '/home/alice',
        transcripts: [
          {
            sessionId: 's1',
            agent: 'claude',
            providerSessionId: 'p',
            name: 'p.jsonl',
            relPath: 'p.jsonl',
            content: b64('{"cwd":"/home/alice/repo","x":"/home/alice/.y"}\n')
          }
        ]
      },
      '/srv/bob/repo',
      git
    )
    expect(result.patch).toEqual({ kind: 'none' })
    expect(result.transcripts).toEqual([
      { sessionId: 's1', providerSessionId: 'p', agent: 'claude', written: true }
    ])
    expect(await readFile(dest, 'utf8')).toBe('{"cwd":"/srv/bob/repo","x":"/srv/bob/.y"}\n')
    expect(await readFile(`${dest}.before-move-1000`, 'utf8')).toBe('old')
  })

  it('applies the patch, and saves it in the git dir when it does not apply', async () => {
    const gitDir = join(root, 'gitdir')
    const seen: string[][] = []
    const okGit = async (args: string[]) => {
      seen.push(args)
      return ''
    }
    const applied = await worktreeMoveImport(
      deps(),
      { worktree: 'id:w', patch: b64('diff'), sourcePath: '/a', sourceHome: '/h' },
      '/srv/r',
      okGit
    )
    expect(applied.patch).toEqual({ kind: 'applied' })
    expect(seen[0].slice(0, 3)).toEqual(['apply', '--binary', '--whitespace=nowarn'])

    const failGit = async (args: string[]) => {
      if (args[0] === 'apply') {
        throw new Error('does not apply')
      }
      return `${gitDir}\n`
    }
    const failed = await worktreeMoveImport(
      deps(),
      { worktree: 'id:w', patch: b64('diff'), sourcePath: '/a', sourceHome: '/h' },
      '/srv/r',
      failGit
    )
    expect(failed.patch).toMatchObject({ kind: 'failed', error: 'does not apply' })
    expect(await readdir(gitDir)).toEqual(['orca-worktree-move-1000.patch'])
    // The scratch folders are cleaned up either way.
    expect((await readdir(root)).filter((name) => name.startsWith('tmp-'))).toEqual([])
  })
})
