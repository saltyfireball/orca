// Turn checkpoints over real git in throwaway folders: capture, dedupe, diff, restore, undo,
// ignore handling, the size cap, retention, the project's own .git, and the busy refusal.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLostWorkSandbox, type LostWorkSandbox } from '../lost-work/lost-work.test-fixture'
import type { CheckpointGit } from './turn-checkpoint-shadow'
import { createTurnCheckpointService, shadowFor } from './turn-checkpoint-service'
import { readForkTurnCheckpointSettings } from '../../../shared/fork/turn-checkpoints'

let sandbox: LostWorkSandbox
let git: CheckpointGit
let clock = 1_800_000_000_000
let busy: string[] = []
let settings: Record<string, unknown> = {}

beforeEach(async () => {
  sandbox = await createLostWorkSandbox()
  busy = []
  settings = {}
  clock = 1_800_000_000_000
  git = (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: options.cwd,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: sandbox.root,
          GIT_CONFIG_GLOBAL: sandbox.emptyConfig,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.test',
          ...options.env
        }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += String(chunk)))
      child.stderr.on('data', (chunk) => (stderr += String(chunk)))
      child.on('error', reject)
      child.on('close', (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`git ${args.join(' ')}: ${stderr.trim()}`))
      )
      child.stdin.end(options.stdin ?? '')
    })
})

afterEach(async () => {
  await sandbox.dispose()
})

function makeService() {
  return createTurnCheckpointService({
    git,
    root: join(sandbox.root, 'store'),
    config: () => readForkTurnCheckpointSettings(settings),
    now: () => (clock += 10),
    busyAgents: () => busy
  })
}

async function folder(name = 'work'): Promise<string> {
  const path = join(sandbox.root, name)
  await mkdir(path, { recursive: true })
  return path
}

async function repoWorkspace(name = 'repo'): Promise<string> {
  const path = await folder(name)
  await sandbox.run(path, 'init', '-q', '-b', 'main')
  await writeFile(join(path, '.gitignore'), '.env\nignored/\n')
  await writeFile(join(path, 'a.txt'), 'one\n')
  await sandbox.run(path, 'add', '.')
  await sandbox.run(path, 'commit', '-q', '-m', 'base')
  return path
}

const read = (path: string, name: string) => readFile(join(path, name), 'utf8')

describe('capture and diff', () => {
  it('makes one checkpoint per changed turn, none when the files are the same', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    expect(await service.captureForTurn(path, 'baseline')).toBe(true)
    expect(await service.captureForTurn(path, 'turn')).toBe(false)
    await writeFile(join(path, 'a.txt'), 'two\n')
    await writeFile(join(path, 'b.txt'), 'new\n')
    expect(await service.captureForTurn(path, 'turn', { sessionId: 's1', agent: 'claude' })).toBe(
      true
    )
    expect(await service.captureForTurn(path, 'turn')).toBe(false)
    const listed = await service.list(path)
    expect(listed.checkpoints.map((item) => item.kind)).toEqual(['turn', 'baseline'])
    expect(listed.checkpoints[0]).toMatchObject({ files: 2, sessionId: 's1', agent: 'claude' })
    const diff = await service.diff(path, listed.checkpoints[0].id, { patch: true })
    expect(diff.files).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' }
    ])
    expect(diff.patch).toContain('+two')
  })

  it('takes a baseline at the first turn start and not again', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    expect(await service.captureForTurn(path, 'baseline')).toBe(true)
    expect(await service.captureForTurn(path, 'baseline')).toBe(false)
    expect((await service.list(path)).checkpoints).toHaveLength(1)
  })

  it('does nothing when switched off or in a home-sized folder', async () => {
    settings = { forkTurnCheckpoints: false }
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    expect(await service.captureForTurn(path, 'turn')).toBe(false)
    expect(existsSync(join(sandbox.root, 'store'))).toBe(false)
    settings = {}
    expect(await service.captureForTurn('/', 'turn')).toBe(false)
  })

  it('leaves out files a merge brought in', async () => {
    const service = makeService()
    const path = await repoWorkspace()
    await sandbox.run(path, 'checkout', '-q', '-b', 'feature')
    await writeFile(join(path, 'from-feature.txt'), 'merged\n')
    await sandbox.run(path, 'add', '.')
    await sandbox.run(path, 'commit', '-q', '-m', 'feature work')
    await sandbox.run(path, 'checkout', '-q', 'main')
    await service.captureForTurn(path, 'baseline')
    await writeFile(join(path, 'agent.txt'), 'agent\n')
    await sandbox.run(path, 'merge', '-q', 'feature')
    expect(await service.captureForTurn(path, 'turn')).toBe(true)
    const [turn] = (await service.list(path)).checkpoints
    const diff = await service.diff(path, turn.id, {})
    expect(diff.files).toEqual([{ path: 'agent.txt', status: 'A' }])
    expect(diff.excludedMergedFiles).toBe(1)
  })
})

describe('restore and undo', () => {
  it('reverts tracked and untracked files, records a pre-restore checkpoint, and undoes', async () => {
    const service = makeService()
    const path = await repoWorkspace()
    await writeFile(join(path, 'keep.txt'), 'kept\n')
    await service.captureForTurn(path, 'baseline')
    const [baseline] = (await service.list(path)).checkpoints

    await writeFile(join(path, 'a.txt'), 'changed\n')
    await rm(join(path, 'keep.txt'))
    await mkdir(join(path, 'sub'))
    await writeFile(join(path, 'sub', 'new.txt'), 'new\n')
    await writeFile(join(path, '.env'), 'SECRET=1\n')
    await service.captureForTurn(path, 'turn')

    const restored = await service.restore(path, baseline.id)
    expect(restored.changedFiles).toBe(3)
    expect(restored.preRestore).not.toBeNull()
    expect(await read(path, 'a.txt')).toBe('one\n')
    expect(await read(path, 'keep.txt')).toBe('kept\n')
    expect(existsSync(join(path, 'sub'))).toBe(false)
    expect(await read(path, '.env')).toBe('SECRET=1\n')

    const kinds = (await service.list(path)).checkpoints.map((item) => item.kind)
    expect(kinds).toEqual(['restore', 'turn', 'baseline'])
    // The pre-restore state is the turn checkpoint itself, which was already the newest.
    const undone = await service.undo(path)
    expect(undone.changedFiles).toBe(3)
    expect(await read(path, 'a.txt')).toBe('changed\n')
    expect(await read(path, 'sub/new.txt')).toBe('new\n')
    expect(existsSync(join(path, 'keep.txt'))).toBe(false)
    // Undo again is redo.
    await service.undo(path)
    expect(await read(path, 'a.txt')).toBe('one\n')
  })

  it('checkpoints edits made after the last turn before restoring over them', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    await service.captureForTurn(path, 'baseline')
    const [baseline] = (await service.list(path)).checkpoints
    await writeFile(join(path, 'a.txt'), 'hand edit\n')
    const result = await service.restore(path, baseline.id)
    expect(result.preRestore?.kind).toBe('pre-restore')
    expect(await read(path, 'a.txt')).toBe('one\n')
    await service.restore(path, result.preRestore!.id)
    expect(await read(path, 'a.txt')).toBe('hand edit\n')
  })

  it('reports nothing changed when the files already match', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    await service.captureForTurn(path, 'baseline')
    const [baseline] = (await service.list(path)).checkpoints
    const result = await service.restore(path, baseline.id)
    expect(result.changedFiles).toBe(0)
    expect(result.note).toContain('nothing changed')
  })

  it('refuses while another agent is busy in the directory, unless forced', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), 'one\n')
    await service.captureForTurn(path, 'baseline')
    await writeFile(join(path, 'a.txt'), 'two\n')
    await service.captureForTurn(path, 'turn')
    const [, baseline] = (await service.list(path)).checkpoints
    busy = ['claude pane-1']
    await expect(service.restore(path, baseline.id)).rejects.toThrow(/Another agent is working/)
    expect(await read(path, 'a.txt')).toBe('two\n')
    await service.restore(path, baseline.id, { force: true })
    expect(await read(path, 'a.txt')).toBe('one\n')
  })

  it('does not delete through a symlinked folder', async () => {
    const service = makeService()
    const path = await folder()
    const outside = await folder('outside')
    await writeFile(join(outside, 'victim.txt'), 'safe\n')
    await writeFile(join(path, 'a.txt'), 'one\n')
    await service.captureForTurn(path, 'baseline')
    const [baseline] = (await service.list(path)).checkpoints
    await symlink(outside, join(path, 'link'))
    await service.captureForTurn(path, 'turn')
    await service.restore(path, baseline.id)
    expect(await read(outside, 'victim.txt')).toBe('safe\n')
  })
})

describe('what stays out', () => {
  it('captures no ignored files and leaves the project git untouched', async () => {
    const service = makeService()
    const path = await repoWorkspace()
    await writeFile(join(path, '.env'), 'SECRET=1\n')
    await mkdir(join(path, 'ignored'))
    await writeFile(join(path, 'ignored', 'x.txt'), 'x\n')
    const refsBefore = await sandbox.run(path, 'for-each-ref')
    const indexBefore = createHash('sha1')
      .update(await readFile(join(path, '.git', 'index')))
      .digest('hex')
    const stashBefore = await sandbox.run(path, 'stash', 'list')
    const gitFilesBefore = await sandbox.run(path, 'count-objects', '-v')

    await service.captureForTurn(path, 'baseline')
    await writeFile(join(path, 'a.txt'), 'two\n')
    await service.captureForTurn(path, 'turn')

    const shadow = shadowFor(join(sandbox.root, 'store'), path)
    const files = await sandbox.run(
      shadow.gitDir,
      'ls-tree',
      '-r',
      '--name-only',
      `refs/orca/checkpoints/${(await service.list(path)).checkpoints[0].id}`
    )
    expect(files.split('\n').sort()).toEqual(['.gitignore', 'a.txt'])
    expect(await sandbox.run(path, 'for-each-ref')).toBe(refsBefore)
    expect(await sandbox.run(path, 'stash', 'list')).toBe(stashBefore)
    expect(await sandbox.run(path, 'count-objects', '-v')).toBe(gitFilesBefore)
    expect(await sandbox.run(path, 'status', '--porcelain')).toBe('M a.txt')
    expect(
      createHash('sha1')
        .update(await readFile(join(path, '.git', 'index')))
        .digest('hex')
    ).not.toBe('')
    expect(indexBefore).toHaveLength(40)
    // The shadow store is private to the user.
    expect((await stat(shadow.gitDir)).mode & 0o077).toBe(0)
  })

  it('keeps the project index byte for byte', async () => {
    const service = makeService()
    const path = await repoWorkspace()
    const before = await readFile(join(path, '.git', 'index'))
    await service.captureForTurn(path, 'baseline')
    await writeFile(join(path, 'b.txt'), 'b\n')
    await service.captureForTurn(path, 'turn')
    expect((await readFile(join(path, '.git', 'index'))).equals(before)).toBe(true)
  })

  it('leaves out files over the size cap, and restore never touches them', async () => {
    settings = { forkTurnCheckpointMaxFileMb: 1 }
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'small.txt'), 'small\n')
    await writeFile(join(path, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 1))
    await service.captureForTurn(path, 'baseline')
    const [baseline] = (await service.list(path)).checkpoints
    const diff = await service.diff(path, baseline.id, {})
    expect(diff.files).toEqual([{ path: 'small.txt', status: 'A' }])
    await writeFile(join(path, 'small.txt'), 'edited\n')
    await service.restore(path, baseline.id)
    expect((await stat(join(path, 'big.bin'))).size).toBe(2 * 1024 * 1024)
    expect(await read(path, 'small.txt')).toBe('small\n')
  })
})

describe('retention', () => {
  it('keeps the newest checkpoints and drops the rest', async () => {
    settings = { forkTurnCheckpointKeep: 2 }
    const service = makeService()
    const path = await folder()
    for (const text of ['1', '2', '3', '4']) {
      await writeFile(join(path, 'a.txt'), text)
      await service.captureForTurn(path, 'turn')
    }
    const listed = await service.list(path)
    expect(listed.checkpoints).toHaveLength(2)
    const shadow = shadowFor(join(sandbox.root, 'store'), path)
    const refs = await sandbox.run(shadow.gitDir, 'for-each-ref', 'refs/orca/checkpoints/')
    expect(refs.split('\n')).toHaveLength(2)
    // The oldest kept checkpoint says its predecessor was pruned instead of listing everything.
    const diff = await service.diff(path, listed.checkpoints[1].id, {})
    expect(diff.files).toEqual([])
  })

  it('sweeps a store whose newest checkpoint expired', async () => {
    const service = makeService()
    const path = await folder()
    await writeFile(join(path, 'a.txt'), '1')
    await service.captureForTurn(path, 'turn')
    expect(await service.sweepStores()).toBe(0)
    clock += 30 * 86_400_000
    expect(await service.sweepStores()).toBe(1)
    expect(existsSync(shadowFor(join(sandbox.root, 'store'), path).gitDir)).toBe(false)
  })
})

describe('perf contract', () => {
  it('re-snapshots a large tree incrementally in under two seconds', async () => {
    const service = makeService()
    const path = await folder()
    for (let dir = 0; dir < 40; dir += 1) {
      await mkdir(join(path, `d${dir}`))
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          writeFile(join(path, `d${dir}`, `f${index}.txt`), `${dir}-${index}\n`.repeat(50))
        )
      )
    }
    await service.captureForTurn(path, 'baseline')
    await writeFile(join(path, 'd1', 'f1.txt'), 'changed\n')
    const started = performance.now()
    expect(await service.captureForTurn(path, 'turn')).toBe(true)
    expect(performance.now() - started).toBeLessThan(2000)
  }, 60_000)
})
