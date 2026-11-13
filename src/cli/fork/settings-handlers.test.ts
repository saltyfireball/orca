// Settings from the CLI (FORK.md): `orca settings` against a fake app; no app is contacted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_FLAGS,
  normalizeCommandPositionals,
  parseArgs,
  specPaths,
  validateCommandAndFlags
} from '../args'
import type { HandlerContext } from '../dispatch'
import { formatCommandHelp } from '../help'
import { RuntimeClientError } from '../runtime-client'
import { COMMAND_SPECS } from '../specs'
import { getDefaultSettings } from '../../shared/constants'
import { redactForkSettings } from '../../shared/fork/settings-catalog/settings-plan'
import { FORK_HANDLER_GROUPS } from './fork-handler-groups'
import { FORK_SETTINGS_HANDLERS, parseSettingValue } from './settings-handlers'
import { FORK_SETTINGS_COMMAND_SPECS, withForkSettingsRootHelp } from './settings-specs'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }
const SECRET = 'cookie-value-that-must-not-leak'
const snapshot = redactForkSettings(
  { ...defaults, terminalFontSize: 17, opencodeSessionCookie: SECRET },
  defaults
)

type Call = { method: string; params: unknown }
let calls: Call[]
let printed: string[]
let dir: string

function reply(result: unknown) {
  return { id: '1', ok: true, result, _meta: { runtimeId: 'test' } }
}

/** Runs `orca <argv>` through the real argument parser into the handler, on a fake client. */
async function run(argv: string[], updateResult?: unknown): Promise<string> {
  printed = []
  const parsed = normalizeCommandPositionals(
    COMMAND_SPECS,
    parseArgs(argv, COMMAND_SPECS.flatMap(specPaths), COMMAND_SPECS)
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const client = {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params })
      return reply(
        method === 'fork.settings.get'
          ? snapshot
          : (updateResult ?? { applied: true, dryRun: false, changes: [], rejected: [] })
      )
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers use only `client.call`.
  const ctx = {
    flags: parsed.flags,
    client,
    cwd: dir,
    json: parsed.flags.has('json')
  } as unknown as HandlerContext
  await FORK_SETTINGS_HANDLERS[parsed.commandPath.join(' ')](ctx)
  return printed.join('\n')
}

beforeEach(() => {
  calls = []
  printed = []
  dir = mkdtempSync(path.join(tmpdir(), 'fork-settings-cli-'))
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('parseSettingValue', () => {
  it('reads JSON, and anything else as plain text', () => {
    expect(parseSettingValue('15')).toBe(15)
    expect(parseSettingValue('true')).toBe(true)
    expect(parseSettingValue('null')).toBeNull()
    expect(parseSettingValue('["a","b"]')).toEqual(['a', 'b'])
    expect(parseSettingValue('dark')).toBe('dark')
    expect(parseSettingValue('"15"')).toBe('15')
    expect(parseSettingValue('JetBrains Mono')).toBe('JetBrains Mono')
  })
})

describe('orca settings list and get', () => {
  it('lists every key with value, default, type and a mark when changed', async () => {
    const out = await run(['settings', 'list', '--filter', 'terminalFontSize'])
    expect(out).toContain('Terminal')
    expect(out).toMatch(
      new RegExp(
        `^\\* terminalFontSize = 17  \\[default ${defaults.terminalFontSize}\\]  <number>  `,
        'm'
      )
    )
    // The filter also matches descriptions: the editor size names this key in its own.
    expect(out).toContain('2 settings, 1 changed from their default')
  })

  it('keeps only changed keys with --changed, and never prints a secret', async () => {
    const out = await run(['settings', 'list', '--changed'])
    expect(out).toContain('* opencodeSessionCookie = (set, hidden)')
    expect(out).toContain('[secret]')
    expect(out).not.toContain(SECRET)
    expect(out).toContain('2 settings, 2 changed')
  })

  it('marks read-only keys', async () => {
    expect(await run(['settings', 'list', '--filter', 'nestedWorkerMaxDepth'])).toContain(
      '[read-only]'
    )
    expect(await run(['settings', 'get', 'pluginConsents'])).toContain('read-only: the app drops')
  })

  it('prints rows as JSON with --json', async () => {
    const parsed = JSON.parse(await run(['settings', 'get', 'terminalFontSize', '--json']))
    expect(parsed.result).toMatchObject({
      key: 'terminalFontSize',
      value: 17,
      default: defaults.terminalFontSize,
      type: 'number',
      changed: true
    })
    const secret = JSON.parse(await run(['settings', 'get', 'opencodeSessionCookie', '--json']))
    expect(secret.result).toMatchObject({ secret: true, set: true })
    expect(secret.result).not.toHaveProperty('value')
  })

  it('names an unknown key without calling the app', async () => {
    await expect(run(['settings', 'get', 'terminalfontsize'])).rejects.toThrow(
      'Unknown setting "terminalfontsize". Did you mean "terminalFontSize"?'
    )
    expect(calls).toEqual([])
  })
})

describe('orca settings set and reset', () => {
  it('sends the value parsed as JSON, or as text', async () => {
    await run(['settings', 'set', 'terminalFontSize', '15'])
    await run(['settings', 'set', 'theme', 'dark'])
    expect(calls).toEqual([
      { method: 'fork.settings.update', params: { set: { terminalFontSize: 15 } } },
      { method: 'fork.settings.update', params: { set: { theme: 'dark' } } }
    ])
  })

  it('sends every key named to reset', async () => {
    const out = await run(['settings', 'reset', 'terminalFontSize', 'theme'], {
      applied: true,
      dryRun: false,
      changes: [{ key: 'terminalFontSize', old: 17, new: 14 }],
      rejected: []
    })
    expect(calls[0].params).toEqual({ reset: ['terminalFontSize', 'theme'] })
    expect(out).toBe('Changed 1 setting:\n  terminalFontSize: 17 -> 14')
  })

  it('fails with every refused key and its reason', async () => {
    const refused = {
      applied: false,
      dryRun: false,
      changes: [],
      rejected: [{ key: 'nestedWorkerMaxDepth', reason: 'read-only: it limits agents' }]
    }
    const failure = await run(['settings', 'set', 'nestedWorkerMaxDepth', '9'], refused).catch(
      (error: unknown) => error
    )
    expect(failure).toBeInstanceOf(RuntimeClientError)
    expect((failure as RuntimeClientError).code).toBe('invalid_argument')
    expect((failure as RuntimeClientError).message).toBe(
      'Nothing was written. Refused:\n  nestedWorkerMaxDepth: read-only: it limits agents'
    )
    expect(printed).toEqual([])
  })

  it('asks for a value and for a key', async () => {
    await expect(run(['settings', 'set', 'theme'])).rejects.toThrow('Give "theme" a value')
    await expect(run(['settings', 'reset'])).rejects.toThrow('Name at least one setting key')
    expect(calls).toEqual([])
  })
})

describe('orca settings export and apply', () => {
  it('prints the file without --file, and writes it with --file', async () => {
    const out = await run(['settings', 'export', '--changed-only'])
    expect(out).toContain('"terminalFontSize": 17,')
    expect(out).not.toContain(SECRET)
    const told = await run(['settings', 'export', '--file', 'mine.jsonc'])
    const file = path.join(dir, 'mine.jsonc')
    expect(told).toContain(`Wrote the settings to ${file}`)
    expect(readFileSync(file, 'utf8')).toContain('  // ==== Terminal ====')
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET)
  })

  it('exports plain JSON of the writable values with --json', async () => {
    const parsed = JSON.parse(await run(['settings', 'export', '--changed-only', '--json']))
    expect(parsed.result).toEqual({ settings: { terminalFontSize: 17 } })
  })

  it('applies the keys in the file and leaves the rest alone', async () => {
    writeFileSync(
      path.join(dir, 'edit.jsonc'),
      '{\n  // bigger\n  "terminalFontSize": 20,\n  // "theme": "light",\n}\n'
    )
    const out = await run(['settings', 'apply', '--file', 'edit.jsonc', '--dry-run'], {
      applied: false,
      dryRun: true,
      changes: [{ key: 'terminalFontSize', old: 17, new: 20 }],
      rejected: []
    })
    expect(calls).toEqual([
      { method: 'fork.settings.update', params: { set: { terminalFontSize: 20 }, dryRun: true } }
    ])
    expect(out).toBe(
      'Would change 1 setting (dry run, nothing written):\n  terminalFontSize: 17 -> 20'
    )
    await run(['settings', 'apply', '--file', 'edit.jsonc'])
    expect(calls[1].params).toEqual({ set: { terminalFontSize: 20 }, dryRun: false })
  })

  it('refuses a broken or missing file before calling the app', async () => {
    writeFileSync(path.join(dir, 'bad.jsonc'), '{\n  "terminalFontSize": \n}\n')
    await expect(run(['settings', 'apply', '--file', 'bad.jsonc'])).rejects.toThrow(
      /The settings file is not valid JSON/
    )
    await expect(run(['settings', 'apply', '--file', 'none.jsonc'])).rejects.toThrow(/ENOENT/)
    await expect(run(['settings', 'apply'])).rejects.toThrow('Name the settings file')
    expect(calls).toEqual([])
  })
})

describe('orca settings wiring', () => {
  it('says what to do when the running app predates the command', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only `client.call`.
    const ctx = {
      flags: new Map(),
      cwd: dir,
      json: false,
      client: {
        call: async () => {
          throw new RuntimeClientError('method_not_found', 'no such method')
        }
      }
    } as unknown as HandlerContext
    await expect(FORK_SETTINGS_HANDLERS['settings list'](ctx)).rejects.toMatchObject({
      code: 'incompatible_runtime'
    })
  })

  it('has a handler, a route and help text for every command', () => {
    const routed = FORK_HANDLER_GROUPS.flatMap((group) => group.keys)
    for (const spec of FORK_SETTINGS_COMMAND_SPECS) {
      const name = spec.path.join(' ')
      expect(FORK_SETTINGS_HANDLERS[name], name).toBeTypeOf('function')
      expect(routed, name).toContain(name)
      expect(COMMAND_SPECS, name).toContain(spec)
      expect(formatCommandHelp(spec), name).toContain(spec.summary)
      expect(spec.examples?.length, name).toBeGreaterThan(0)
      // Every option of its own has a line of help, not a bare flag name.
      for (const flag of spec.allowedFlags.filter((flag) => !GLOBAL_FLAGS.includes(flag))) {
        expect(formatCommandHelp(spec), `${name} --${flag}`).toMatch(
          new RegExp(`^  --${flag}( <\\S+>)? +\\S`, 'm')
        )
      }
    }
    expect(Object.keys(FORK_SETTINGS_HANDLERS).sort()).toEqual(
      FORK_SETTINGS_COMMAND_SPECS.map((spec) => spec.path.join(' ')).sort()
    )
  })

  it('puts the commands under their own heading in the root help', () => {
    const help = withForkSettingsRootHelp('orca\n\nStartup:\n  open\n\nCommon Commands:\n  x')
    expect(help).toMatch(/Startup:\n {2}open\n\nSettings:\n {2}settings list +\S/)
    expect(help).toContain('  settings apply')
    expect(help.indexOf('Settings:')).toBeLessThan(help.indexOf('Common Commands:'))
    expect(withForkSettingsRootHelp('orca')).toContain('Settings:')
  })
})
