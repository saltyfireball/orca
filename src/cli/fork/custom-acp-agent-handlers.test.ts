// BAD-873: `orca agent custom`, `orca agent launch --agent <custom>` and `orca bot set --agent
// <custom>` against a fake client; no app is contacted. Env values come from the shell or a file,
// never the command line.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import { REPEATED_FLAG_SEPARATOR } from '../arguments/args'
import { RuntimeClientError } from '../runtime/connection/types'
import { FORK_BOT_SET_HANDLERS } from './bot-set-handlers'
import {
  FORK_CUSTOM_ACP_AGENT_HANDLERS,
  parseCustomAcpEnvFile,
  readCustomAcpEnv
} from './custom-acp-agent-handlers'
import { launchForkCustomAcpAgent } from './custom-acp-agent-launch'

const PEBBLE_ROW = { name: 'pebble', command: '/opt/pebble/bin/pebble-acp', env: ['PEBBLE_TOKEN'] }
const LANTERN = { id: 'bot-lantern', name: 'Lantern', agent: 'claude', launch: null }

let calls: { method: string; params: unknown }[] = []
let printed: string[] = []
let folder = ''

function context(flags: Record<string, string | boolean>): HandlerContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers read only flags, json, cwd and client.call.
  return {
    flags: new Map(Object.entries(flags)),
    json: false,
    cwd: folder,
    client: {
      isRemote: false,
      call: async (method: string, params: unknown) => {
        calls.push({ method, params })
        const results: Record<string, () => unknown> = {
          'fork.customAcpAgents.list': () => ({ agents: [PEBBLE_ROW] }),
          'fork.customAcpAgents.add': () => ({ agent: PEBBLE_ROW }),
          'fork.customAcpAgents.startChat': () => ({ sessionId: 'chat-1' }),
          'bots.list': () => ({ bots: [LANTERN] }),
          'bots.update': () => ({
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: bot set always sends bots.update {botId, updates}.
            bot: { ...LANTERN, ...(params as { updates: object }).updates }
          })
        }
        return { id: '1', ok: true, result: results[method]?.(), _meta: { runtimeId: 't' } }
      }
    }
  } as unknown as HandlerContext
}

beforeEach(() => {
  calls = []
  printed = []
  folder = mkdtempSync(join(tmpdir(), 'custom-acp-cli-'))
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(folder, { recursive: true, force: true })
})

describe('custom agent env', () => {
  it('takes a named variable from the shell and refuses a value on the command line', async () => {
    const shell = { PEBBLE_TOKEN: 'made-up-value-1' }
    expect(await readCustomAcpEnv(new Map([['env', 'PEBBLE_TOKEN']]), folder, shell)).toEqual({
      PEBBLE_TOKEN: 'made-up-value-1'
    })
    const inline = readCustomAcpEnv(new Map([['env', 'PEBBLE_TOKEN=made-up-value-2']]), folder, {})
    await expect(inline).rejects.toThrow('--env takes a variable name only; give PEBBLE_TOKEN')
    await expect(inline).rejects.not.toThrow('made-up-value-2')
    await expect(readCustomAcpEnv(new Map([['env', 'PEBBLE_TOKEN']]), folder, {})).rejects.toThrow(
      'not set in this shell'
    )
    await expect(
      readCustomAcpEnv(new Map([['env', 'PATH']]), folder, { PATH: '/usr/bin' })
    ).rejects.toThrow('PATH is set by Orca')
  })

  it('reads NAME=VALUE lines from a file, with export, quotes and comments', async () => {
    expect(
      parseCustomAcpEnvFile('# made up\nexport PEBBLE_TOKEN="a b"\n\nPEBBLE_REGION=north\n')
    ).toEqual({ PEBBLE_TOKEN: 'a b', PEBBLE_REGION: 'north' })
    expect(() => parseCustomAcpEnvFile('PEBBLE_TOKEN')).toThrow('Line 1')
    expect(() => parseCustomAcpEnvFile('\nPEBBLE_TOKEN=a\nnot a line')).toThrow('Line 3')
    writeFileSync(join(folder, 'pebble.env'), "PEBBLE_TOKEN='from-file'\n")
    expect(await readCustomAcpEnv(new Map([['env-file', 'pebble.env']]), folder, {})).toEqual({
      PEBBLE_TOKEN: 'from-file'
    })
  })
})

describe('orca agent custom add', () => {
  it('sends the program, its arguments and env values to the host, and prints no value', async () => {
    writeFileSync(join(folder, 'pebble.env'), 'PEBBLE_TOKEN=made-up-value-3\n')
    await FORK_CUSTOM_ACP_AGENT_HANDLERS['agent custom add']!(
      context({
        name: 'pebble',
        command: '/opt/pebble/bin/pebble-acp',
        arg: ['--acp', '--quiet'].join(REPEATED_FLAG_SEPARATOR),
        'args-json': '["--level","2"]',
        'env-file': 'pebble.env',
        'owns-prompt': true
      })
    )
    expect(calls).toEqual([
      {
        method: 'fork.customAcpAgents.add',
        params: {
          name: 'pebble',
          command: '/opt/pebble/bin/pebble-acp',
          args: ['--acp', '--quiet', '--level', '2'],
          env: { PEBBLE_TOKEN: 'made-up-value-3' },
          ownsPrompt: true
        }
      }
    ])
    expect(printed.join('\n')).toContain('env: PEBBLE_TOKEN')
    expect(printed.join('\n')).not.toContain('made-up-value-3')
  })

  it('says plainly when the host has no custom agents', async () => {
    const ctx = context({})
    ctx.client.call = async () => {
      throw new RuntimeClientError('method_not_found', 'x')
    }
    await expect(FORK_CUSTOM_ACP_AGENT_HANDLERS['agent custom list']!(ctx)).rejects.toThrow(
      'This Orca host has no custom agents'
    )
  })
})

describe('orca agent launch --agent <custom>', () => {
  it('starts a chat on a saved agent and leaves built-in agents alone', async () => {
    expect(await launchForkCustomAcpAgent(context({ agent: 'claude' }))).toBe(false)
    expect(calls).toEqual([])
    const ctx = context({ agent: 'pebble', worktree: 'id:r1::/work', prompt: 'hello', focus: true })
    expect(await launchForkCustomAcpAgent(ctx)).toBe(true)
    expect(calls.at(-1)).toEqual({
      method: 'fork.customAcpAgents.startChat',
      params: { name: 'pebble', worktree: 'id:r1::/work', prompt: 'hello', focus: true }
    })
  })

  it('refuses a model, the terminal surface, profiles and a launch retry with the reason', async () => {
    await expect(
      launchForkCustomAcpAgent(context({ agent: 'pebble', model: 'm' }))
    ).rejects.toThrow('picks its own model')
    await expect(
      launchForkCustomAcpAgent(context({ agent: 'pebble', surface: 'terminal' }))
    ).rejects.toThrow('runs as a chat only')
    for (const [flag, reason] of [
      ['profile', 'agent profiles do not apply'],
      ['mcp-profile', 'MCP profiles do not apply'],
      ['retry-launch', 'no launch retry']
    ]) {
      await expect(
        launchForkCustomAcpAgent(context({ agent: 'pebble', [flag]: 'x' }))
      ).rejects.toThrow(reason)
    }
    expect(calls.map((call) => call.method)).not.toContain('fork.customAcpAgents.startChat')
  })
})

describe('orca bot set --bot <name> --agent <custom>', () => {
  it('moves the bot to the custom agent by name, and refuses custom-acp itself and a model', async () => {
    await FORK_BOT_SET_HANDLERS['bot set']!(context({ bot: 'Lantern', agent: 'pebble' }))
    expect(calls.at(-1)).toEqual({
      method: 'bots.update',
      params: { botId: 'bot-lantern', updates: { agent: 'custom-acp', customAcpAgent: 'pebble' } }
    })
    expect(printed.join('\n')).toContain('Lantern (pebble)')
    await expect(
      FORK_BOT_SET_HANDLERS['bot set']!(context({ bot: 'Lantern', agent: 'custom-acp' }))
    ).rejects.toThrow('Name the custom agent itself')
    await expect(
      FORK_BOT_SET_HANDLERS['bot set']!(context({ bot: 'Lantern', agent: 'pebble', model: 'm' }))
    ).rejects.toThrow('picks its own model')
    await expect(
      FORK_BOT_SET_HANDLERS['bot set']!(context({ bot: 'Lantern', agent: 'gravel' }))
    ).rejects.toThrow('neither a bot agent nor a custom agent')
  })
})
