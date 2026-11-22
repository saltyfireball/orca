import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readOwnerToken } from './bot-item-answer'

let dir = ''

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readOwnerToken', () => {
  it('reads --owner-token-file only when nobody else can read it, else the environment', async () => {
    dir = mkdtempSync(join(tmpdir(), 'owner-token-cli-'))
    const file = join(dir, 'token')
    writeFileSync(file, 'orcaown_from-file\n')
    const flags = new Map<string, string | boolean>([['owner-token-file', file]])

    chmodSync(file, 0o644)
    const refused = await readOwnerToken(flags, dir, {}, 'linux').catch((error: Error) => error)
    expect(refused).toBeInstanceOf(Error)
    expect(String(refused)).not.toContain('orcaown_from-file')

    chmodSync(file, 0o600)
    expect(await readOwnerToken(flags, dir, {}, 'linux')).toBe('orcaown_from-file')
    expect(await readOwnerToken(new Map(), dir, { ORCA_OWNER_TOKEN: 'orcaown_env' }, 'linux')).toBe(
      'orcaown_env'
    )
    await expect(readOwnerToken(new Map(), dir, {}, 'linux')).rejects.toThrow('No owner token')
  })
})
