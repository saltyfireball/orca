import { describe, expect, it } from 'vitest'
import { createTranscriptPathRewriter, worktreeMoveRewrites } from './transcript-path-rewrite'

const rewrites = worktreeMoveRewrites({
  sourcePath: '/home/alice/work/repo',
  targetPath: '/srv/bob/ws/repo',
  sourceHome: '/home/alice',
  targetHome: '/srv/bob',
  rewriteHome: true
})

describe('createTranscriptPathRewriter', () => {
  const rewrite = createTranscriptPathRewriter(rewrites)

  it('rewrites the worktree path before the home path', () => {
    expect(rewrite('{"cwd":"/home/alice/work/repo"}')).toBe('{"cwd":"/srv/bob/ws/repo"}')
    expect(rewrite('cat /home/alice/work/repo/src/a.ts')).toBe('cat /srv/bob/ws/repo/src/a.ts')
    expect(rewrite('see /home/alice/.config/x')).toBe('see /srv/bob/.config/x')
  })

  it('leaves names that only start with a rewritten path', () => {
    expect(rewrite('/home/alice/work/repo-two/a')).toBe('/srv/bob/work/repo-two/a')
    expect(rewrite('/home/alicex/file')).toBe('/home/alicex/file')
    expect(rewrite('/home/alice/work/repo.git')).toBe('/srv/bob/work/repo.git')
  })

  it('rewrites a path that ends a sentence', () => {
    expect(rewrite('I edited /home/alice/work/repo.')).toBe('I edited /srv/bob/ws/repo.')
  })

  it('never rewrites a path twice', () => {
    const chain = createTranscriptPathRewriter([
      { from: '/a/one', to: '/a/two' },
      { from: '/a/two', to: '/a/three' }
    ])
    expect(chain('/a/one and /a/two')).toBe('/a/two and /a/three')
  })

  it('rewrites JSON-escaped Windows paths', () => {
    const win = createTranscriptPathRewriter([{ from: 'C:\\Users\\alice\\repo', to: '/srv/repo' }])
    const line = JSON.stringify({ cwd: 'C:\\Users\\alice\\repo\\src' })
    expect(JSON.parse(win(line))).toEqual({ cwd: '/srv/repo\\src' })
  })

  it('skips the root, empty and unchanged paths, and trims trailing separators', () => {
    const noop = createTranscriptPathRewriter([
      { from: '/', to: '/x' },
      { from: '', to: '/x' },
      { from: '/same', to: '/same' }
    ])
    expect(noop('/ /same')).toBe('/ /same')
    const trailing = createTranscriptPathRewriter([{ from: '/a/b/', to: '/c/d/' }])
    expect(trailing('/a/b/file')).toBe('/c/d/file')
  })

  it('keeps the home folder when that setting is off', () => {
    const only = createTranscriptPathRewriter(
      worktreeMoveRewrites({
        sourcePath: '/home/alice/work/repo',
        targetPath: '/srv/bob/ws/repo',
        sourceHome: '/home/alice',
        targetHome: '/srv/bob',
        rewriteHome: false
      })
    )
    expect(only('/home/alice/work/repo /home/alice/.x')).toBe('/srv/bob/ws/repo /home/alice/.x')
  })
})
