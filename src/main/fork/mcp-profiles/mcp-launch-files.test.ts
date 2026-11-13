import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeConfigPaths,
  hasManagedMcpPolicy,
  managedMcpPolicyFiles,
  removeLaunchMcpConfig,
  sweepLaunchMcpConfigs,
  writeLaunchMcpConfig
} from './mcp-launch-files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fork-mcp-files-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('writeLaunchMcpConfig', () => {
  it('writes an owner-only file in an owner-only folder', async () => {
    const folder = join(root, 'launch')
    const file = await writeLaunchMcpConfig(
      folder,
      'chat-1',
      new Map([['a', { command: 'a', env: { K: 'v' } }]])
    )
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      mcpServers: { a: { command: 'a', env: { K: 'v' } } }
    })
    if (process.platform !== 'win32') {
      expect((await stat(folder)).mode & 0o777).toBe(0o700)
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
    await writeLaunchMcpConfig(folder, 'chat-1', new Map())
    expect(await readdir(folder)).toEqual(['chat-1.json'])
    await removeLaunchMcpConfig(folder, 'chat-1')
    expect(await readdir(folder)).toEqual([])
  })

  it('refuses odd chat ids', async () => {
    await expect(writeLaunchMcpConfig(root, '../x', new Map())).rejects.toThrow()
  })
})

describe('sweepLaunchMcpConfigs', () => {
  it('removes stale files, or all of them', async () => {
    const old = join(root, 'old.json')
    const fresh = join(root, 'fresh.json')
    const other = join(root, 'keep.txt')
    await Promise.all([writeFile(old, '{}'), writeFile(fresh, '{}'), writeFile(other, 'x')])
    // A fixed time far past the one-day cutoff.
    const past = new Date('2000-01-01T00:00:00Z')
    await utimes(old, past, past)
    expect(await sweepLaunchMcpConfigs(root)).toBe(1)
    expect((await readdir(root)).sort()).toEqual(['fresh.json', 'keep.txt'])
    expect(await sweepLaunchMcpConfigs(root, { all: true })).toBe(1)
    expect(await readdir(root)).toEqual(['keep.txt'])
    expect(await sweepLaunchMcpConfigs(join(root, 'missing'))).toBe(0)
  })
})

describe('claudeConfigPaths', () => {
  it('uses ~/.claude.json only for the unset default folder', () => {
    const home = '/h'
    expect(claudeConfigPaths({ configDir: '/h/.claude', configDirSet: false, home })).toEqual({
      globalConfig: join('/h', '.claude.json'),
      userSettings: join('/h/.claude', 'settings.json')
    })
    expect(claudeConfigPaths({ configDir: '/h/.claude', configDirSet: true, home })).toEqual({
      globalConfig: join('/h/.claude', '.claude.json'),
      userSettings: join('/h/.claude', 'settings.json')
    })
    expect(claudeConfigPaths({ configDir: '/acct', configDirSet: false, home }).globalConfig).toBe(
      join('/acct', '.claude.json')
    )
  })
})

describe('managed MCP policy', () => {
  it('lists per-platform files and checks the given ones', async () => {
    expect(managedMcpPolicyFiles('linux')).toEqual(['/etc/claude-code/managed-mcp.json'])
    expect(managedMcpPolicyFiles('darwin')[0]).toContain('managed-mcp.json')
    expect(managedMcpPolicyFiles('win32')).toHaveLength(2)
    const policy = join(root, 'managed-mcp.json')
    expect(await hasManagedMcpPolicy([policy])).toBe(false)
    await writeFile(policy, '{}')
    expect(await hasManagedMcpPolicy([policy])).toBe(true)
  })
})
