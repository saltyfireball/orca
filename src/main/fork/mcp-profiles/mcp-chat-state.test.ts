import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ForkMcpChatStore } from './mcp-chat-state'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fork-mcp-state-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ForkMcpChatStore', () => {
  it('saves and loads chat state', async () => {
    const file = join(root, 'state', 'chats.json')
    const store = new ForkMcpChatStore(file, () => 42)
    store.update('a', (current) => ({ ...current, kind: 'worker', chosen: 'web' }))
    await store.flush()
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
    const again = new ForkMcpChatStore(file)
    await again.load()
    expect(again.get('a')).toEqual({ kind: 'worker', chosen: 'web', updatedAt: 42 })
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1)
  })

  it('drops broken entries and survives a broken file', async () => {
    const file = join(root, 'chats.json')
    await writeFile(
      file,
      JSON.stringify({ chats: { good: { kind: 'background' }, bad: { kind: 'other' } } })
    )
    const store = new ForkMcpChatStore(file)
    await store.load()
    expect(store.get('good')).toEqual({ kind: 'background', updatedAt: 0 })
    expect(store.get('bad')).toBeUndefined()
    await writeFile(file, '{oops')
    await store.load()
    expect(store.get('good')).toBeUndefined()
  })

  it('works without a file', async () => {
    const store = new ForkMcpChatStore(null)
    await store.load()
    store.update('x', (current) => current)
    await store.flush()
    expect(store.get('x')?.kind).toBe('interactive')
  })
})
