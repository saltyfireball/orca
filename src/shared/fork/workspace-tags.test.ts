import { describe, expect, it } from 'vitest'
import {
  FORK_ARCHIVE_RETRY_MS,
  filterByTag,
  forkWorkspaceTagKey,
  nextTagFilter,
  parseTags,
  readForkWorkspaceTagSettings,
  shouldForkArchiveOnMerge,
  tagCounts,
  withWorkspaceTags
} from './workspace-tags'

describe('workspace tags', () => {
  it('parses words, lower case, deduplicated, at most 8', () => {
    expect(parseTags('Review, client-a  #blocked review')).toEqual([
      'review',
      'client-a',
      'blocked'
    ])
    expect(parseTags('a b c d e f g h i j')).toHaveLength(8)
    expect(parseTags('bad!tag ok')).toEqual(['ok'])
    expect(parseTags('')).toEqual([])
  })

  it('reads settings with defaults: tags on, archive off, no filter', () => {
    const settings = readForkWorkspaceTagSettings({})
    expect(settings).toEqual({ enabled: true, tags: {}, filter: null, archiveOnMerge: false })
    const read = readForkWorkspaceTagSettings({
      forkWorkspaceTags: { a: ['X', 'y'], b: [] },
      forkWorkspaceTagFilter: { tag: 'x', mode: 'only' }
    })
    expect(read.tags).toEqual({ a: ['x', 'y'] })
    expect(read.filter).toEqual({ tag: 'x', mode: 'only' })
  })

  it('keys a remote workspace by its host', () => {
    expect(forkWorkspaceTagKey('repo::/a')).toBe('repo::/a')
    expect(forkWorkspaceTagKey('repo::/a', 'local')).toBe('repo::/a')
    expect(forkWorkspaceTagKey('repo::/a', 'runtime:alpha')).toBe('runtime:alpha|repo::/a')
  })

  it('sets and clears one workspace', () => {
    const one = withWorkspaceTags({}, 'a', ['x'])
    expect(one).toEqual({ a: ['x'] })
    expect(withWorkspaceTags(one, 'a', [])).toEqual({})
  })

  it('cycles the filter: only, hide, none', () => {
    const only = nextTagFilter(null, 'x')
    expect(only).toEqual({ tag: 'x', mode: 'only' })
    const hide = nextTagFilter(only, 'x')
    expect(hide).toEqual({ tag: 'x', mode: 'hide' })
    expect(nextTagFilter(hide, 'x')).toBeNull()
    expect(nextTagFilter(hide, 'y')).toEqual({ tag: 'y', mode: 'only' })
  })

  it('filters the list', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    const tags = { a: ['x'] }
    const only = { enabled: true, tags, filter: { tag: 'x', mode: 'only' as const } }
    expect(filterByTag(list, only)).toEqual([{ id: 'a' }])
    expect(filterByTag(list, { ...only, filter: { tag: 'x', mode: 'hide' } })).toEqual([
      { id: 'b' }
    ])
    expect(filterByTag(list, { ...only, enabled: false })).toBe(list)
    expect(filterByTag(list, { ...only, filter: null })).toBe(list)
  })

  it('counts tags, most used first', () => {
    expect(tagCounts({ a: ['x', 'y'], b: ['x'] })).toEqual([
      { tag: 'x', count: 2 },
      { tag: 'y', count: 1 }
    ])
  })
})

describe('archive on merge', () => {
  const base = {
    isArchived: false,
    isMainWorktree: false,
    hasBranch: true,
    merged: true,
    active: false,
    busy: false,
    snoozedUntilMerge: false,
    lastTriedAt: 0
  }
  const now = 10 * FORK_ARCHIVE_RETRY_MS

  it('archives a merged, idle, linked workspace', () => {
    expect(shouldForkArchiveOnMerge(base, now)).toBe(true)
  })

  it.each([
    ['not merged', { merged: false }],
    ['already archived', { isArchived: true }],
    ['the main checkout', { isMainWorktree: true }],
    ['detached', { hasBranch: false }],
    ['open', { active: true }],
    ['busy', { busy: true }],
    ['snoozed until merge', { snoozedUntilMerge: true }],
    ['tried a moment ago', { lastTriedAt: now - 1000 }]
  ])('leaves it alone when %s', (_why, change) => {
    expect(shouldForkArchiveOnMerge({ ...base, ...change }, now)).toBe(false)
  })
})
