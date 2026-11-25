// The release orcad (`pnpm build:orcad`) for tests that need a real server with no desktop app: each
// orcad runs in its own HOME and user data folder on loopback, on a port kept across a restart, and
// the built CLI reaches it. Its terminal daemon outlives a restart, as on a real server. Tests using
// it run only with ORCA_BUILT_ORCAD_TEST=1.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const ORCAD = join(ROOT, 'out', 'orcad')

export const builtOrcadTestEnabled = process.env.ORCA_BUILT_ORCAD_TEST === '1'

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

async function freePort(): Promise<string> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as AddressInfo).port
  await new Promise((done) => server.close(done))
  return String(port)
}

export type CliRun = { ok: boolean; text: string; json: unknown }

/** A folder of orcads, a `bin` for stand-in agents and the CLI's own user, whose saved
 *  environments are the `home` orcad's (ORCA_USER_DATA_PATH is its data folder). */
export function orcadLab(prefix: string) {
  const node = packagedNode()
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  for (const dir of ['cli', 'bin']) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  const servers = new Map<string, ChildProcess>()
  const ports = new Map<string, string>()
  const cliEnv = (): NodeJS.ProcessEnv => ({
    HOME: join(root, 'cli'),
    PATH: '/usr/bin:/bin',
    TMPDIR: tmpdir(),
    ORCA_USER_DATA_PATH: join(root, 'home', 'data')
  })

  /** The built CLI; `environment` names a paired orcad, none the `home` one. */
  const cli = (args: string[], environment?: string): CliRun => {
    const result = spawnSync(
      node,
      [
        join(ORCAD, 'out', 'cli', 'index.js'),
        ...args,
        ...(environment ? ['--environment', environment] : []),
        '--json'
      ],
      { encoding: 'utf8', env: cliEnv() }
    )
    let json: unknown = null
    try {
      json = JSON.parse(result.stdout)
    } catch {
      // Refusals print their message.
    }
    return { ok: result.status === 0, text: `${result.stdout}${result.stderr}`, json }
  }

  const result = (args: string[], environment?: string): Record<string, unknown> => {
    const run = cli(args, environment)
    if (!run.ok) {
      throw new Error(`orca ${args.join(' ')} failed:\n${run.text}`)
    }
    return (run.json as { result: Record<string, unknown> }).result
  }

  /** Starts (or restarts, on the same port and folders) one orcad; resolves to its pairing URL. */
  const start = async (name: string): Promise<string> => {
    const base = join(root, name)
    for (const dir of ['home/.claude', 'data']) {
      mkdirSync(join(base, dir), { recursive: true })
    }
    if (!ports.has(name)) {
      ports.set(name, await freePort())
    }
    const orcad = spawn(
      node,
      [join(ORCAD, 'orcad-server.js'), '--port', ports.get(name)!, '--bind', '127.0.0.1', '--json'],
      {
        env: {
          HOME: join(base, 'home'),
          PATH: `${join(root, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
          CLAUDE_CONFIG_DIR: join(base, 'home', '.claude'),
          ORCA_USER_DATA: join(base, 'data'),
          TMPDIR: tmpdir(),
          // A macOS pane starts through login(1), which runs the account's own home and profile.
          ORCA_DISABLE_MACOS_LOGIN_SHELL: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    servers.set(name, orcad)
    return new Promise<string>((done, fail) => {
      let out = ''
      orcad.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString()
        const url = /"url":"(orca:\/\/pair\?code=[^"]+)"/.exec(out)?.[1]
        if (url) {
          done(url)
        }
      })
      orcad.stderr!.on('data', (chunk: Buffer) => {
        if (process.env.ORCAD_TEST_LOG) {
          process.stderr.write(`[${name}] ${chunk}`)
        }
      })
      orcad.once('exit', (code) => fail(new Error(`${name} orcad exited ${code} before ready`)))
    })
  }

  const stop = async (name: string): Promise<void> => {
    const orcad = servers.get(name)
    if (orcad && orcad.exitCode === null) {
      const exited = new Promise((done) => orcad.once('exit', done))
      orcad.kill('SIGTERM')
      await exited
    }
  }

  /** Saves `name` as an environment of the CLI (and so of the `home` orcad). */
  const pair = (name: string, pairing: string): void => {
    const added = spawnSync(
      node,
      [
        join(ORCAD, 'out', 'cli', 'index.js'),
        'environment',
        'add',
        '--name',
        name,
        '--pairing-code',
        pairing
      ],
      { encoding: 'utf8', env: cliEnv() }
    )
    if (added.status !== 0) {
      throw new Error(`environment add ${name} failed:\n${added.stderr}`)
    }
  }

  /** Stops every orcad and the terminal daemons they started (by pid), then removes the folder. */
  const close = async (): Promise<void> => {
    for (const name of servers.keys()) {
      await stop(name)
    }
    const listed = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
    const daemons = listed
      .split('\n')
      .filter((line) => line.includes(root) && line.includes(join('data', 'daemon')))
      .map((line) => Number(line.trim().split(/\s+/)[0]))
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    for (const pid of daemons) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
    // A daemon writes its folder until it exits.
    for (let waited = 0; waited < 10_000 && daemons.some(alive); waited += 200) {
      await settle(200)
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }

  return { root, cli, result, start, stop, pair, close }
}

export type OrcadLab = ReturnType<typeof orcadLab>

/** A git repo with one commit, for `repo add`. */
export function initDemoRepo(path: string): void {
  mkdirSync(path, { recursive: true })
  const git = (...args: string[]) => spawnSync('git', ['-C', path, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  spawnSync('sh', ['-c', 'printf "demo\\n" > README.md'], { cwd: path })
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
}

export async function settle(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms))
}
