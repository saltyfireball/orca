// BAD-800 proof on the host that runs without the desktop app: the release orcad (`pnpm build:orcad`,
// the bundle `core-runtime-activation.ts` composes) started in its own HOME and user data folder on
// loopback with a bare environment, and the built CLI paired to it over the WebSocket. Before the fix
// orcad never loaded agent or MCP profiles: `--profile` was refused as unknown and an automation could
// not keep its MCP profile. A stand-in `claude` (a shell script) records the arguments each start
// gave it. Run with `pnpm build:orcad` first and ORCA_BUILT_ORCAD_TEST=1.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../../..')
const ORCAD = join(ROOT, 'out', 'orcad')
const enabled = process.env.ORCA_BUILT_ORCAD_TEST === '1'

function packagedNode(): string {
  const runtimes = join(ROOT, 'out', 'runtimes')
  const found = existsSync(runtimes)
    ? readdirSync(runtimes)
        .map((name) => join(runtimes, name, 'bin', 'node'))
        .find(existsSync)
    : undefined
  if (!found) {
    throw new Error('No packaged Node in out/runtimes: run pnpm build:orcad')
  }
  return found
}

let root = ''
let orcad: ChildProcess | null = null
let node = ''

function cli(args: string[]): { ok: boolean; text: string; json: unknown } {
  const result = spawnSync(
    node,
    [join(ORCAD, 'out', 'cli', 'index.js'), ...args, '--environment', 'lab', '--json'],
    { encoding: 'utf8', env: { HOME: join(root, 'cli'), PATH: '/usr/bin:/bin', TMPDIR: tmpdir() } }
  )
  const text = `${result.stdout}${result.stderr}`
  let json: unknown = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // Refusals print their message.
  }
  return { ok: result.status === 0, text, json }
}

function result(args: string[]): Record<string, unknown> {
  const run = cli(args)
  if (!run.ok) {
    throw new Error(`orca ${args.join(' ')} failed:\n${run.text}`)
  }
  return (run.json as { result: Record<string, unknown> }).result
}

/** Every start the stand-in saw: its arguments, working folder and Claude account pointer. */
function starts(): { argv: string[]; cwd: string; pointer: string }[] {
  const folder = join(root, 'starts')
  return readdirSync(folder)
    .filter((name) => name.endsWith('.argv'))
    .map((name) => {
      const env = readFileSync(join(folder, name.replace(/\.argv$/, '.env')), 'utf8')
      return {
        argv: readFileSync(join(folder, name), 'utf8').split('\n').slice(0, -1),
        cwd: /^cwd=(.*)$/m.exec(env)?.[1] ?? '',
        pointer: /^pointer=(.*)$/m.exec(env)?.[1] ?? ''
      }
    })
}

async function startIn(cwdPart: string): Promise<{ argv: string[]; cwd: string; pointer: string }> {
  for (let i = 0; i < 120; i += 1) {
    const found = starts().find((start) => start.cwd.includes(cwdPart))
    if (found) {
      return found
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`No Claude start in ${cwdPart}; saw ${JSON.stringify(starts())}`)
}

function keptServers(argv: string[]): string[] {
  const file = argv.find((arg) => arg.startsWith('--mcp-config='))?.slice('--mcp-config='.length)
  if (!file) {
    throw new Error(`no --mcp-config in ${argv.join(' ')}`)
  }
  return Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers)
}

function counts(): { worktrees: number; terminals: number; automations: number } {
  return {
    worktrees: (result(['worktree', 'list']).worktrees as unknown[]).length,
    terminals: (result(['terminal', 'list']).terminals as unknown[]).length,
    automations: (result(['automations', 'list']).automations as unknown[]).length
  }
}

describe.skipIf(!enabled)('orcad loads agent and MCP profiles (release build)', () => {
  let repo = ''

  beforeAll(async () => {
    node = packagedNode()
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orcad-prof-')))
    for (const dir of ['home/.claude', 'data', 'cli', 'bin', 'starts', 'repo']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    repo = join(root, 'repo')
    writeFileSync(
      join(root, 'bin', 'claude'),
      `#!/bin/sh\n[ "$1" = --version ] && { echo '2.1.331 (Claude Code)'; exit 0; }\nprintf '%s\\n' "$@" > '${root}/starts/'$$.argv.tmp\nprintf 'cwd=%s\\npointer=%s\\n' "$PWD" "$ORCA_CLAUDE_PROFILE_POINTER" > '${root}/starts/'$$.env\nmv '${root}/starts/'$$.argv.tmp '${root}/starts/'$$.argv\nexec sleep 600\n`
    )
    chmodSync(join(root, 'bin', 'claude'), 0o755)
    writeFileSync(
      join(root, 'home', '.claude', '.claude.json'),
      JSON.stringify({
        mcpServers: {
          'alpha-notes': { command: 'alpha-notes-mcp' },
          'beta-tracker': { command: 'beta-mcp' }
        }
      })
    )
    const git = (...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'README.md'), 'demo\n')
    git('add', 'README.md')
    git(
      '-c',
      'user.name=demo',
      '-c',
      'user.email=demo@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'init'
    )

    orcad = spawn(
      node,
      [join(ORCAD, 'orcad-server.js'), '--port', '0', '--bind', '127.0.0.1', '--json'],
      {
        env: {
          HOME: join(root, 'home'),
          PATH: `${join(root, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
          CLAUDE_CONFIG_DIR: join(root, 'home', '.claude'),
          ORCA_USER_DATA: join(root, 'data'),
          TMPDIR: tmpdir(),
          // A macOS pane starts through login(1), which runs the account's own home and profile.
          ORCA_DISABLE_MACOS_LOGIN_SHELL: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const pairing = await new Promise<string>((done, fail) => {
      let out = ''
      orcad!.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString()
        const url = /"url":"(orca:\/\/pair\?code=[^"]+)"/.exec(out)?.[1]
        if (url) {
          done(url)
        }
      })
      orcad!.stderr!.resume()
      orcad!.once('exit', (code) => fail(new Error(`orcad exited ${code} before ready`)))
    })
    const added = spawnSync(
      node,
      [
        join(ORCAD, 'out', 'cli', 'index.js'),
        'environment',
        'add',
        '--name',
        'lab',
        '--pairing-code',
        pairing
      ],
      {
        encoding: 'utf8',
        env: { HOME: join(root, 'cli'), PATH: '/usr/bin:/bin', TMPDIR: tmpdir() }
      }
    )
    expect(added.status, added.stderr).toBe(0)
    result([
      'settings',
      'set',
      'forkMcpProfiles',
      JSON.stringify([{ name: 'tools-one', mode: 'allow', servers: ['alpha-notes'] }])
    ])
    result([
      'profiles',
      'set',
      'narrow',
      '--agent',
      'claude',
      '--mcp-profile',
      'tools-one',
      '--permission-mode',
      'accept-edits'
    ])
    result([
      'profiles',
      'set',
      'mode-only',
      '--agent',
      'claude',
      '--permission-mode',
      'accept-edits'
    ])
    result(['repo', 'add', '--path', repo])
  }, 180_000)

  afterAll(async () => {
    if (orcad && orcad.exitCode === null) {
      const exited = new Promise((done) => orcad!.once('exit', done))
      orcad.kill('SIGTERM')
      await exited
    }
    // The terminal daemon outlives orcad by design; stop the one this orcad started, by its pid.
    const listed = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
    for (const line of listed.split('\n')) {
      if (root && line.includes(join(root, 'data', 'daemon'))) {
        process.kill(Number(line.trim().split(/\s+/)[0]), 'SIGTERM')
      }
    }
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('automations create --profile keeps the MCP profile, and a run loads only its servers in the capped mode', async () => {
    const created = result([
      'automations',
      'create',
      '--profile',
      'narrow',
      '--name',
      'nightly-check',
      '--repo',
      `path:${repo}`,
      '--prompt',
      'Reply with the word pong.',
      '--trigger',
      'daily',
      '--time',
      '03:00'
    ])
    const automation = created.automation as { id: string; forkMcpProfile?: string }
    expect(automation.forkMcpProfile).toBe('tools-one')
    result(['automations', 'run', '--id', automation.id])
    const run = await startIn('auto-nightly-check')
    expect(run.argv).toContain('--strict-mcp-config')
    expect(run.argv.join(' ')).toContain('--permission-mode acceptEdits')
    expect(keptServers(run.argv)).toEqual(['alpha-notes'])
  }, 120_000)

  it('agent launch --profile narrows a Claude terminal and applies the mode', async () => {
    result([
      'agent',
      'launch',
      '--profile',
      'narrow',
      '--worktree',
      `path:${repo}`,
      '--surface',
      'terminal',
      '--prompt',
      'Reply with the word pong.'
    ])
    const run = await startIn(`${repo}`)
    expect(run.cwd).toBe(repo)
    expect(run.argv).toContain('--strict-mcp-config')
    expect(run.argv.join(' ')).toContain('--permission-mode acceptEdits Reply with the word pong.')
    expect(keptServers(run.argv)).toEqual(['alpha-notes'])
  }, 120_000)

  it('worktree create --profile starts the new workspace agent in the profile mode, not full access', async () => {
    result([
      'worktree',
      'create',
      '--repo',
      `path:${repo}`,
      '--name',
      'try-mode',
      '--profile',
      'mode-only',
      '--agent',
      'claude'
    ])
    const run = await startIn('try-mode')
    expect(run.argv.join(' ')).toContain('--permission-mode acceptEdits')
    expect(run.argv).not.toContain('--dangerously-skip-permissions')
    expect(run.argv).not.toContain('--strict-mcp-config')
  }, 120_000)

  it('orchestration worker-start --profile narrows the worker and applies the mode', async () => {
    const shell = result(['terminal', 'create', '--worktree', `path:${repo}`]) as {
      handle?: string
      terminal?: { handle: string }
    }
    const from = shell.handle ?? shell.terminal!.handle
    const started = result([
      'orchestration',
      'worker-start',
      '--from',
      from,
      '--profile',
      'narrow',
      '--agent',
      'claude',
      '--repo',
      `path:${repo}`,
      '--worktree',
      'new-top-level',
      '--name',
      'profile-worker',
      '--spec',
      'Reply with the word pong.'
    ])
    expect(JSON.stringify(started)).toContain('profile-worker')
    const run = await startIn('profile-worker')
    expect(run.argv).toContain('--strict-mcp-config')
    expect(run.argv.join(' ')).toContain('--permission-mode acceptEdits')
    expect(keptServers(run.argv)).toEqual(['alpha-notes'])
  }, 120_000)

  it('a deleted agent profile is refused on every start, and nothing is made', () => {
    result(['profiles', 'remove', 'narrow'])
    const before = counts()
    const startsBefore = starts().length
    const refusals = [
      cli([
        'agent',
        'launch',
        '--profile',
        'narrow',
        '--worktree',
        `path:${repo}`,
        '--surface',
        'terminal'
      ]),
      cli([
        'worktree',
        'create',
        '--repo',
        `path:${repo}`,
        '--name',
        'try-gone',
        '--profile',
        'narrow',
        '--agent',
        'claude'
      ]),
      cli([
        'automations',
        'create',
        '--profile',
        'narrow',
        '--name',
        'gone',
        '--repo',
        `path:${repo}`,
        '--prompt',
        'x',
        '--trigger',
        'daily'
      ]),
      cli([
        'orchestration',
        'worker-start',
        '--from',
        'none',
        '--profile',
        'narrow',
        '--agent',
        'claude',
        '--repo',
        `path:${repo}`,
        '--worktree',
        'new-top-level',
        '--spec',
        'x'
      ])
    ]
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false)
      expect(refusal.text).toMatch(/Unknown agent profile \\?"narrow\\?"/)
    }
    expect(counts()).toEqual(before)
    expect(starts().length).toBe(startsBefore)
  }, 120_000)

  it('a run whose MCP profile is gone is refused with the reason', async () => {
    result(['settings', 'set', 'forkMcpProfiles', '[]'])
    const id = (result(['automations', 'list']).automations as { id: string }[])[0]!.id
    const startsBefore = starts().length
    result(['automations', 'run', '--id', id])
    let runs = ''
    for (let i = 0; i < 60 && !runs.includes('did not run'); i += 1) {
      await new Promise((done) => setTimeout(done, 500))
      runs = JSON.stringify(result(['automations', 'runs', '--id', id]))
    }
    expect(runs).toContain('did not run: Unknown MCP profile \\"tools-one\\"')
    expect(starts().length).toBe(startsBefore)
  }, 120_000)
})
