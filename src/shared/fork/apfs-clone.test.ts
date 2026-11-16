import { describe, expect, it } from 'vitest'
import {
  FORK_APFS_CLONE_MAX_FOLDERS,
  forkApfsCloneCheckoutEnabled,
  forkApfsCloneFolders,
  normalizeForkApfsCloneFolder,
  parseForkApfsCloneFolderText
} from './apfs-clone'

describe('APFS clone settings', () => {
  it('turns the checkout clone on only when it is true', () => {
    expect(forkApfsCloneCheckoutEnabled(undefined)).toBe(false)
    expect(forkApfsCloneCheckoutEnabled({})).toBe(false)
    expect(forkApfsCloneCheckoutEnabled({ forkApfsCloneCheckout: false })).toBe(false)
    expect(forkApfsCloneCheckoutEnabled({ forkApfsCloneCheckout: true })).toBe(true)
  })

  it('defaults the folders to node_modules and keeps an empty list empty', () => {
    expect(forkApfsCloneFolders({})).toEqual(['node_modules'])
    expect(forkApfsCloneFolders({ forkApfsCloneFolders: [] })).toEqual([])
  })

  it('keeps only plain relative paths inside the project', () => {
    expect(normalizeForkApfsCloneFolder(' packages/app/node_modules/ ')).toBe(
      'packages/app/node_modules'
    )
    expect(normalizeForkApfsCloneFolder('vendor\\bundle')).toBe('vendor/bundle')
    for (const bad of [
      '',
      '/etc',
      '~/x',
      'C:/x',
      '../x',
      'a/../b',
      './a',
      '.git',
      'a/.GIT/b',
      'a//b',
      'a\nb',
      'x'.repeat(201),
      42
    ]) {
      expect(normalizeForkApfsCloneFolder(bad)).toBeNull()
    }
  })

  it('deduplicates, drops bad entries and caps the list', () => {
    expect(forkApfsCloneFolders({ forkApfsCloneFolders: ['a', 'a/', '../b', 'c'] })).toEqual([
      'a',
      'c'
    ])
    const many = Array.from({ length: 30 }, (_, i) => `f${i}`)
    expect(forkApfsCloneFolders({ forkApfsCloneFolders: many })).toHaveLength(
      FORK_APFS_CLONE_MAX_FOLDERS
    )
  })

  it('parses the Settings text field', () => {
    expect(parseForkApfsCloneFolderText('node_modules, .venv\nbuild,,../x')).toEqual([
      'node_modules',
      '.venv',
      'build'
    ])
    expect(parseForkApfsCloneFolderText('  ')).toEqual([])
  })
})
