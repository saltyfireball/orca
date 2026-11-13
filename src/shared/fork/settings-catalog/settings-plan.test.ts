// Settings from the CLI (FORK.md): what a requested change would write, and what is refused.
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../constants'
import { parseForkSettingsFile, renderForkSettingsFile } from './settings-jsonc'
import {
  FORK_SECRET_SET_TEXT,
  FORK_SECRET_UNSET_TEXT,
  planForkSettingsUpdate,
  redactForkSettings
} from './settings-plan'

const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }
const SECRET = 'cookie-value-that-must-not-leak'
const current: Record<string, unknown> = {
  ...defaults,
  terminalFontSize: 17,
  theme: 'dark',
  opencodeSessionCookie: SECRET,
  agentDefaultEnv: { claude: { SOME_API_KEY: SECRET } }
}

function plan(set?: Record<string, unknown>, reset?: string[]) {
  return planForkSettingsUpdate({ current, defaults, set, reset })
}

describe('planForkSettingsUpdate', () => {
  it('plans a valid change with its old and new value', () => {
    expect(plan({ terminalFontSize: 15 })).toEqual({
      update: { terminalFontSize: 15 },
      changes: [{ key: 'terminalFontSize', old: 17, new: 15 }],
      rejected: []
    })
  })

  it('skips a value that is already stored', () => {
    expect(plan({ terminalFontSize: 17, theme: 'dark' })).toEqual({
      update: {},
      changes: [],
      rejected: []
    })
  })

  it('refuses an unknown key, naming it', () => {
    expect(plan({ noSuchSetting: 1 }).rejected).toEqual([
      { key: 'noSuchSetting', reason: 'unknown setting' }
    ])
    expect(plan({ TerminalFontSize: 1 }).rejected[0].reason).toBe(
      'unknown setting; did you mean "terminalFontSize"?'
    )
  })

  it('refuses a value of the wrong type, naming the key and the type', () => {
    const { rejected, update } = plan({ terminalFontSize: 'big', theme: 'purple' })
    expect(update).toEqual({})
    expect(rejected).toEqual([
      { key: 'terminalFontSize', reason: 'wrong type: expected number (number)' },
      {
        key: 'theme',
        reason: expect.stringContaining('wrong type: expected one of "dark", "light", "system"')
      }
    ])
  })

  it('refuses every read-only key, to set and to reset', () => {
    for (const key of [
      'activeRuntimeEnvironmentId',
      'floatingTerminalTrustedCwds',
      'pluginConsents',
      'disabledPlugins',
      'pluginExternalHostGrants',
      'antigravityChatAuth',
      'nestedWorkerMaxDepth',
      'browserPasswordsFillRequiresReauth',
      'claudeManagedAccounts'
    ]) {
      expect(plan({ [key]: 'x' }).rejected[0]?.reason, key).toMatch(/^read-only: /)
      expect(plan({ [key]: 'x' }).update, key).toEqual({})
    }
    expect(plan(undefined, ['nestedWorkerMaxDepth']).rejected[0].reason).toMatch(/^read-only: /)
  })

  it('resets to the default, and clears a key that has none', () => {
    const optional = { ...current, forkUsageCardPattern: 'X-\\d+' }
    expect(defaults.forkUsageCardPattern).toBeUndefined()
    const result = planForkSettingsUpdate({
      current: optional,
      defaults,
      reset: ['terminalFontSize', 'forkUsageCardPattern', 'theme']
    })
    expect(result.rejected).toEqual([])
    expect(result.update).toEqual({
      terminalFontSize: defaults.terminalFontSize,
      forkUsageCardPattern: undefined,
      theme: defaults.theme
    })
    expect('forkUsageCardPattern' in result.update).toBe(true)
    expect(result.changes[1]).toEqual({ key: 'forkUsageCardPattern', old: 'X-\\d+' })
  })

  it('refuses a key named both to set and to reset', () => {
    expect(plan({ theme: 'light' }, ['theme']).rejected).toEqual([
      { key: 'theme', reason: 'named both to set and to reset' }
    ])
  })

  it('never shows a secret, old or new', () => {
    const result = plan({ opencodeSessionCookie: 'new-cookie' }, ['agentDefaultEnv'])
    expect(result.update.opencodeSessionCookie).toBe('new-cookie')
    expect(result.changes).toEqual([
      {
        key: 'opencodeSessionCookie',
        old: FORK_SECRET_SET_TEXT,
        new: FORK_SECRET_SET_TEXT,
        secret: true
      },
      {
        key: 'agentDefaultEnv',
        old: FORK_SECRET_SET_TEXT,
        new: FORK_SECRET_UNSET_TEXT,
        secret: true
      }
    ])
    expect(JSON.stringify(result.changes)).not.toContain(SECRET)
    expect(JSON.stringify(result.changes)).not.toContain('new-cookie')
  })
})

describe('redactForkSettings', () => {
  it('returns catalog keys only and no secret value', () => {
    const out = redactForkSettings({ ...current, retiredLegacyKey: SECRET }, defaults)
    expect(JSON.stringify(out)).not.toContain(SECRET)
    expect(out.values).not.toHaveProperty('retiredLegacyKey')
    expect(out.values).not.toHaveProperty('opencodeSessionCookie')
    expect(out.defaults).not.toHaveProperty('httpProxyUrl')
    expect(out.secretsSet).toEqual(['agentDefaultEnv', 'opencodeSessionCookie'])
    expect(out.values.terminalFontSize).toBe(17)
  })
})

describe('an exported file', () => {
  it('applies back with no change and nothing refused', () => {
    const snapshot = redactForkSettings(current, defaults)
    const file = renderForkSettingsFile(snapshot)
    expect(plan(parseForkSettingsFile(file))).toEqual({ update: {}, changes: [], rejected: [] })
  })

  it('applies an edit made in it', () => {
    const file = renderForkSettingsFile(redactForkSettings(current, defaults)).replace(
      '"terminalFontSize": 17,',
      '"terminalFontSize": 12,'
    )
    expect(plan(parseForkSettingsFile(file)).changes).toEqual([
      { key: 'terminalFontSize', old: 17, new: 12 }
    ])
  })
})
