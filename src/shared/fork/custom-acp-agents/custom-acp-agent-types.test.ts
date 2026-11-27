// BAD-873: what a custom ACP agent may be saved as, and how a bot names the one it runs.
import { describe, expect, it } from 'vitest'
import { buildNewTabAgentMenuRows } from '../../agent-launch/picker/agent-launch-picker-rows'
import { botNewChatAgents } from '../../bots/bot-agent-choices'
import type { Bot } from '../../bots/bot-record-schemas'
import { applyBotUpdates } from '../../rpc-contract/bots-params'
import {
  customAcpAgentNameProblem,
  customAcpAgentProblem,
  customAcpEnvNameProblem,
  normalizeForkCustomAcpAgents
} from './custom-acp-agent-types'
import { forkCustomAcpBotOption } from './custom-acp-bot'

const pebble = { name: 'pebble', command: '/opt/pebble/bin/pebble-acp' }

describe('custom ACP agent rules', () => {
  it('takes lowercase names that are no built-in agent id', () => {
    expect(customAcpAgentNameProblem('pebble-2')).toBeNull()
    expect(customAcpAgentNameProblem('Pebble')).toContain('lowercase')
    expect(customAcpAgentNameProblem('-pebble')).toContain('lowercase')
    expect(customAcpAgentNameProblem('claude')).toContain('built-in agent id')
    expect(customAcpAgentNameProblem('custom-acp')).toContain('built-in agent id')
  })

  it('refuses variables Orca sets and malformed names', () => {
    expect(customAcpEnvNameProblem('PEBBLE_TOKEN')).toBeNull()
    expect(customAcpEnvNameProblem('ORCA_CUSTOM_AGENT_HOME')).toContain('set by Orca')
    expect(customAcpEnvNameProblem('HOME')).toContain('set by Orca')
    expect(customAcpEnvNameProblem('1BAD')).toContain('not a valid')
  })

  it('needs one program and an absolute working folder', () => {
    expect(customAcpAgentProblem(pebble)).toBeNull()
    expect(customAcpAgentProblem({ ...pebble, command: ' ' })).toContain('one program')
    expect(customAcpAgentProblem({ ...pebble, command: 'a\nb' })).toContain('one program')
    expect(customAcpAgentProblem({ ...pebble, cwd: 'relative/folder' })).toContain('absolute')
    expect(customAcpAgentProblem({ ...pebble, env: ['PATH'] })).toContain('set by Orca')
  })

  it('drops malformed and duplicate saved agents, keeping the first of a name', () => {
    expect(
      normalizeForkCustomAcpAgents([
        { ...pebble, args: ['--acp'], ownsPrompt: true, extra: 1 },
        { ...pebble, command: '/other' },
        { name: 'Bad Name', command: '/x' },
        'junk',
        { name: 'lantern-agent', command: 'lantern', env: ['LANTERN_KEY'], cwd: '' }
      ])
    ).toEqual([
      { ...pebble, args: ['--acp'], ownsPrompt: true },
      { name: 'lantern-agent', command: 'lantern', env: ['LANTERN_KEY'] }
    ])
    expect(normalizeForkCustomAcpAgents(undefined)).toEqual([])
  })
})

describe('a bot on a custom agent', () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: applyBotUpdates reads only these fields of the bot.
  const bot = { id: 'b1', name: 'Lantern', agent: 'claude', members: [] } as unknown as Bot

  it('keeps the name only while it runs custom-acp, and clears it on null', () => {
    const moved = applyBotUpdates(bot, { agent: 'custom-acp', customAcpAgent: 'pebble' })
    expect(moved).toMatchObject({ agent: 'custom-acp', customAcpAgent: 'pebble' })
    expect(forkCustomAcpBotOption(moved)).toEqual({ customAcpAgent: 'pebble' })
    expect(applyBotUpdates(moved, { name: 'Lantern 2' }).customAcpAgent).toBe('pebble')
    expect(applyBotUpdates(moved, { agent: 'codex' }).customAcpAgent).toBeUndefined()
    expect(applyBotUpdates(moved, { customAcpAgent: null }).customAcpAgent).toBeUndefined()
    expect(applyBotUpdates(bot, { customAcpAgent: 'pebble' }).customAcpAgent).toBeUndefined()
    expect(forkCustomAcpBotOption(bot)).toEqual({})
  })
})

describe('the generic agent menus', () => {
  // custom-acp is outside TUI_AGENT_AUTO_PICK_ORDER, which every agent row goes through.
  it('never list custom-acp itself, so neither the + menu nor a new bot offers it', () => {
    const rows = buildNewTabAgentMenuRows({
      settings: {},
      detectedOnHost: ['claude', 'custom-acp'],
      chatAgents: ['claude', 'custom-acp'],
      hostChatAnswer: () => 'yes',
      chatProgram: () => 'available'
    })
    expect(rows.map((row) => row.agent)).not.toContain('custom-acp')
    const model = { state: 'settled' as const, rows, detection: { detectedIds: ['claude'] } }
    expect(botNewChatAgents({ agent: 'claude' }, model).map((entry) => entry.agent)).toEqual([
      'claude'
    ])
  })
})
