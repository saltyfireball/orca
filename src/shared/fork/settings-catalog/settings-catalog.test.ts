// Settings from the CLI (FORK.md): the catalog covers the settings object, exactly.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../constants'
import {
  FORK_SETTINGS_READ_ONLY_KEYS,
  FORK_SETTINGS_SECRET_KEYS,
  forkSettingReadOnlyReason
} from './settings-access'
import {
  FORK_SETTINGS_AREAS,
  forkSettingEntries,
  forkSettingEntry,
  suggestForkSettingKey
} from './settings-catalog'
import { checkForkSettingValue } from './settings-shape'

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const defaults: Record<string, unknown> = { ...getDefaultSettings('/home/someone') }

describe('fork settings catalog', () => {
  it('has an entry for every key of the default settings object', () => {
    const missing = Object.keys(defaults).filter((key) => !forkSettingEntry(key))
    expect(missing, 'run: pnpm run generate:fork-settings-catalog').toEqual([])
  })

  it('matches the GlobalSettings type: no key missing, none left over', () => {
    // The generator reads the type; --check fails when its output is not what is committed.
    const run = (): string =>
      execFileSync(
        process.execPath,
        [path.join(repoRoot, 'config/scripts/fork/generate-fork-settings-catalog.mjs'), '--check'],
        { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' }
      )
    expect(run).not.toThrow()
  }, 60_000)

  it('names each key once and gives it a plain one-line description', () => {
    const entries = forkSettingEntries()
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length)
    for (const entry of entries) {
      expect(entry.description.length, entry.key).toBeGreaterThan(0)
      expect(entry.description, entry.key).toMatch(/^[\x20-\x7E]+$/)
      expect(entry.type.length, entry.key).toBeGreaterThan(0)
      expect(
        FORK_SETTINGS_AREAS.some((area) => area.id === entry.area),
        entry.key
      ).toBe(true)
    }
  })

  it('describes types that accept every default value', () => {
    const problems = forkSettingEntries()
      .filter((entry) => defaults[entry.key] !== undefined)
      .map((entry) => [entry.key, checkForkSettingValue(entry.shape, defaults[entry.key])])
      .filter(([, problem]) => problem !== null)
    expect(problems).toEqual([])
  })

  it('suggests the key meant by a name in the wrong letter case', () => {
    expect(suggestForkSettingKey('terminalfontsize')).toBe('terminalFontSize')
    expect(suggestForkSettingKey('noSuchSetting')).toBeUndefined()
  })
})

describe('fork settings access', () => {
  it('guards only keys that exist', () => {
    for (const key of [...FORK_SETTINGS_READ_ONLY_KEYS, ...FORK_SETTINGS_SECRET_KEYS]) {
      expect(forkSettingEntry(key), key).toBeDefined()
    }
  })

  it('keeps the keys the settings handler drops read-only', () => {
    for (const key of [
      'activeRuntimeEnvironmentId',
      'floatingTerminalTrustedCwds',
      'antigravityChatAuth',
      'pluginConsents',
      'disabledPlugins',
      'pluginExternalHostGrants',
      'browserPasswordsFillRequiresReauth',
      'nestedWorkerMaxDepth'
    ]) {
      expect(forkSettingReadOnlyReason(key), key).not.toBeNull()
      expect(forkSettingEntry(key)?.readOnly, key).not.toBeNull()
    }
    expect(forkSettingReadOnlyReason('terminalFontSize')).toBeNull()
  })

  it('treats every one-time marker as read-only', () => {
    // A new marker must join MARKERS in settings-access.ts.
    const markers = forkSettingEntries().filter((entry) =>
      /Migrated|MigrationApplied|Defaulted|KeybindingSeed$/.test(entry.key)
    )
    expect(markers.length).toBeGreaterThan(10)
    expect(markers.filter((entry) => !entry.readOnly).map((entry) => entry.key)).toEqual([])
  })

  it('hides every setting whose name or fields look like a credential', () => {
    // Reviewed and not a credential: a flag, a rule, a method name, a file path or a color.
    const reviewed = new Set([
      'browserPasswordsFillRequiresReauth',
      'browserPasswordsOfferToSave',
      'forkCacheColdThresholdTokens',
      'antigravityChatAuth',
      'geminiCliOAuthEnabled',
      'httpProxyBypassRules',
      'nativeChatInheritShellEnvironment',
      'nativeChatShellEnvironmentVariables',
      'activeRuntimeEnvironmentId',
      'claudeManagedAccounts',
      'codexManagedAccounts',
      'voice',
      'forkCustomAppThemes'
    ])
    const looksSecret =
      /token|secret|cookie|password|api_?key|credential|oauth|proxy|env(ironment)?\b|"[a-z]*auth[a-z]*"/i
    const suspects = forkSettingEntries()
      .filter(
        (entry) =>
          looksSecret.test(entry.key.replace(/([a-z])([A-Z])/g, '$1 $2')) ||
          looksSecret.test(JSON.stringify(entry.shape))
      )
      .filter((entry) => !entry.secret && !reviewed.has(entry.key))
      .map((entry) => entry.key)
    expect(suspects, 'add to SECRETS in settings-access.ts, or to the reviewed list here').toEqual(
      []
    )
    expect(FORK_SETTINGS_SECRET_KEYS).toEqual(
      expect.arrayContaining(['opencodeSessionCookie', 'httpProxyUrl', 'agentDefaultEnv'])
    )
  })
})
