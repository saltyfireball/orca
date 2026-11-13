import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  discoverClaudeMcpServers,
  forkMcpServerViews,
  loadableClaudeMcpServers
} from './claude-mcp-discovery'

let root: string
let paths: { folder: string; globalConfig: string; userSettings: string }

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(value))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fork-mcp-discovery-'))
  const folder = join(root, 'repo', 'pkg')
  await mkdir(folder, { recursive: true })
  paths = {
    folder,
    globalConfig: join(root, 'config', '.claude.json'),
    userSettings: join(root, 'config', 'settings.json')
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('discoverClaudeMcpServers', () => {
  it('reads user, local and approved project servers with precedence', async () => {
    await json(paths.globalConfig, {
      mcpServers: {
        shared: { command: 'user-shared', env: { TOKEN: 'secret-user' } },
        off: { url: 'https://example.invalid/mcp' }
      },
      projects: {
        [paths.folder]: {
          mcpServers: { local: { type: 'sse', url: 'https://example.invalid/sse' } },
          disabledMcpServers: ['off']
        }
      }
    })
    await json(join(paths.folder, '.mcp.json'), {
      mcpServers: { shared: { command: 'project-shared' }, pending: { command: 'p' } }
    })
    await json(join(root, 'repo', '.mcp.json'), {
      mcpServers: { parent: { command: 'parent' }, shared: { command: 'far' } }
    })
    await json(paths.userSettings, { enabledMcpjsonServers: ['shared', 'parent'] })
    const discovery = await discoverClaudeMcpServers(paths)
    const status = Object.fromEntries(
      discovery.servers.map((s) => [`${s.scope}:${s.name}`, s.status])
    )
    expect(status).toEqual({
      'local:local': 'enabled',
      'project:shared': 'enabled',
      'project:pending': 'unapproved',
      'project:parent': 'enabled',
      'user:shared': 'shadowed',
      'user:off': 'disabled'
    })
    const loadable = loadableClaudeMcpServers(discovery)
    expect([...loadable.keys()].sort()).toEqual(['local', 'parent', 'shared'])
    expect(loadable.get('shared')).toEqual({ command: 'project-shared' })
  })

  it('never shows definitions in views', async () => {
    await json(paths.globalConfig, {
      mcpServers: { s: { command: 'run', args: ['--token', 'x'], env: { K: 'secret' } } }
    })
    const views = forkMcpServerViews(await discoverClaudeMcpServers({ ...paths, folder: null }))
    expect(views).toEqual([
      {
        name: 's',
        scope: 'user',
        status: 'enabled',
        transport: 'stdio',
        source: paths.globalConfig,
        command: 'run'
      }
    ])
    expect(JSON.stringify(views)).not.toContain('secret')
  })

  it('honors enableAll and disabled lists from project settings', async () => {
    await json(join(paths.folder, '.mcp.json'), {
      mcpServers: { a: { command: 'a' }, b: { command: 'b' } }
    })
    await json(join(paths.folder, '.claude', 'settings.local.json'), {
      enableAllProjectMcpServers: true,
      disabledMcpjsonServers: ['b']
    })
    const discovery = await discoverClaudeMcpServers(paths)
    expect(discovery.servers.map((s) => [s.name, s.status])).toEqual([
      ['a', 'enabled'],
      ['b', 'disabled']
    ])
  })

  it('notes broken files and handles missing ones', async () => {
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(paths.globalConfig, '{not json')
    const discovery = await discoverClaudeMcpServers({ ...paths, folder: null })
    expect(discovery.servers).toEqual([])
    expect(discovery.notes).toEqual([`Could not parse ${paths.globalConfig} as JSON.`])
  })
})
