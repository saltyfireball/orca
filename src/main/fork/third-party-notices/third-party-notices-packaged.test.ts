// The packaged path Settings > Blackfish > About opens is where the fork's builder overlay puts
// the notices file: the overlay's own resource mapping is laid out as electron-builder copies it.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, ipcMain: { handle: vi.fn() }, shell: {} }))

import { THIRD_PARTY_NOTICES_FILE } from '../../../shared/fork/third-party-notices'
import { openThirdPartyNotices } from './third-party-notices-bridge'

type Resource = { from: string; to: string }

const repoRoot = path.resolve(__dirname, '../../../..')
const overlay = createRequire(import.meta.url)(
  path.join(repoRoot, 'config/scripts/fork/electron-builder.fork.config.cjs')
) as Record<'mac' | 'win' | 'linux', { extraResources: (Resource | string)[] }>

let resourcesPath: string | undefined
afterEach(() => {
  if (resourcesPath) {
    rmSync(resourcesPath, { recursive: true, force: true })
  }
})

describe('packaged third-party notices', () => {
  it.each(['mac', 'win', 'linux'] as const)('the %s bundle opens the shipped file', async (os) => {
    const mapping = overlay[os].extraResources.find(
      (entry): entry is Resource =>
        typeof entry === 'object' && entry.from === THIRD_PARTY_NOTICES_FILE
    )
    expect(mapping).toBeDefined()
    resourcesPath = mkdtempSync(path.join(tmpdir(), 'notices-resources-'))
    const shipped = path.join(resourcesPath, mapping!.to)
    mkdirSync(path.dirname(shipped), { recursive: true })
    copyFileSync(path.join(repoRoot, mapping!.from), shipped)

    const opened: string[] = []
    const result = await openThirdPartyNotices(
      {
        isPackaged: true,
        resourcesPath,
        appPath: path.join(resourcesPath, 'app.asar'),
        cwd: tmpdir()
      },
      async (file) => {
        opened.push(file)
        return ''
      }
    )
    expect(result).toEqual({ ok: true })
    expect(opened).toEqual([shipped])
    const text = readFileSync(opened[0], 'utf8')
    expect(text.startsWith('THIRD-PARTY NOTICES\n')).toBe(true)
    expect(text).toContain('Copyright (c) 2026 Lovecast Inc.')
  })

  it('says the file is missing instead of opening another path', async () => {
    resourcesPath = mkdtempSync(path.join(tmpdir(), 'notices-resources-'))
    const openPath = vi.fn(async () => '')
    const result = await openThirdPartyNotices(
      { isPackaged: true, resourcesPath, appPath: repoRoot, cwd: repoRoot },
      openPath
    )
    expect(result).toEqual({
      ok: false,
      error: `${THIRD_PARTY_NOTICES_FILE} is not in this build.`
    })
    expect(openPath).not.toHaveBeenCalled()
  })
})
