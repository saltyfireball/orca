import { describe, expect, it } from 'vitest'
import { isSafeWorktreeMoveRef, stripWorktreeMoveControlChars } from './worktree-move-ref'

describe('isSafeWorktreeMoveRef', () => {
  it('accepts ordinary branch and remote names', () => {
    for (const name of [
      'main',
      'origin',
      'feature/SLRM-2265-x',
      'release-1.2',
      'a_b/c.d',
      'u/\u00e9'
    ]) {
      expect(isSafeWorktreeMoveRef(name)).toBe(true)
    }
  })

  it('refuses a leading dash, whitespace and control characters', () => {
    for (const name of [
      '--upload-pack=evil',
      '-b',
      'a b',
      'a\tb',
      'a\nb',
      'a\u0000b',
      'a\u007fb',
      ' main',
      'main '
    ]) {
      expect(isSafeWorktreeMoveRef(name)).toBe(false)
    }
  })

  it('refuses names git check-ref-format --branch refuses', () => {
    for (const name of [
      '',
      '@',
      'a..b',
      'a@{b',
      'a//b',
      '/a',
      'a/',
      'a.',
      '.hidden',
      'a/.hidden',
      'a.lock',
      'a/b.lock/c',
      'a~1',
      'a^',
      'a:b',
      'a?',
      'a*',
      'a[b',
      'a\\b',
      'x'.repeat(256)
    ]) {
      expect(isSafeWorktreeMoveRef(name)).toBe(false)
    }
    expect(isSafeWorktreeMoveRef(null)).toBe(false)
    expect(isSafeWorktreeMoveRef(42)).toBe(false)
  })
})

describe('stripWorktreeMoveControlChars', () => {
  it('removes escapes and control characters but keeps newlines and tabs', () => {
    expect(stripWorktreeMoveControlChars('a\u001b[31mred\u0007\u0000\u009b b\tc\nd')).toBe(
      'a[31mred b\tc\nd'
    )
  })
})
