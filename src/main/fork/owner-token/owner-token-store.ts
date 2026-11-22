// Owner token (BAD-737, FORK.md): the hash of the one owner token, in fork-owner-token.json beside the
// settings (owner-only file mode). Minting replaces it, revoking deletes it; the token itself is
// returned once by mint and never written.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeDurableSecureJsonFile } from '../../../shared/secure-storage/secure-file'
import {
  FORK_OWNER_TOKEN_PREFIX,
  type ForkOwnerTokenMintResult,
  type ForkOwnerTokenStatus
} from '../../../shared/fork/owner-token'

export const OWNER_TOKEN_FILE = 'fork-owner-token.json'

type TokenFile = { version: 1; sha256: string; createdAt: number }

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export class OwnerTokenStore {
  private readonly path: string

  constructor(userDataPath: string) {
    this.path = join(userDataPath, OWNER_TOKEN_FILE)
  }

  private read(): TokenFile | null {
    if (!existsSync(this.path)) {
      return null
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TokenFile>
      return typeof raw.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(raw.sha256) &&
        typeof raw.createdAt === 'number'
        ? { version: 1, sha256: raw.sha256, createdAt: raw.createdAt }
        : null
    } catch {
      // Why: an unreadable file authorizes nobody.
      return null
    }
  }

  status(): ForkOwnerTokenStatus {
    const file = this.read()
    return { exists: file !== null, createdAt: file?.createdAt ?? null }
  }

  /** A new token, replacing any earlier one. */
  mint(now = Date.now()): ForkOwnerTokenMintResult {
    const token = `${FORK_OWNER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    writeDurableSecureJsonFile(this.path, {
      version: 1,
      sha256: digest(token).toString('hex'),
      createdAt: now
    } satisfies TokenFile)
    return { token, createdAt: now }
  }

  revoke(): boolean {
    const had = existsSync(this.path)
    rmSync(this.path, { force: true })
    return had
  }

  /** Constant time over the digests, so the comparison says nothing about how close a guess was. */
  verify(token: string): boolean {
    const file = this.read()
    if (!file) {
      return false
    }
    const expected = Buffer.from(file.sha256, 'hex')
    const given = digest(token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }
}
