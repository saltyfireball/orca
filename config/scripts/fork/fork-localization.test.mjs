import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectLocalizationKeyReferences,
  collectSourceFiles
} from '../localization/catalog-validation/verify-localization-catalog.mjs'
import { FORK_LOCALIZED_SOURCE_DIRS, isForkLocalizedSource } from './fork-localization.mjs'

const repoRoot = resolve(import.meta.dirname, '../../..')
const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mts|cts)$/
const TEST_RE = /\.(?:test|spec)\./

/** Upstream's catalog for the surface a fork folder belongs to. */
function catalogFor(dir) {
  return dir.startsWith('mobile/')
    ? 'mobile/src/i18n/locales/en.json'
    : 'src/renderer/src/i18n/locales/en.json'
}

function flatten(value, prefix = '', keys = new Set()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object') {
      flatten(child, path, keys)
    } else {
      keys.add(path)
    }
  }
  return keys
}

function forkSourceFiles(dir) {
  return readdirSync(join(repoRoot, dir), { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => SOURCE_RE.test(entry) && !TEST_RE.test(entry))
    .map((entry) => join(repoRoot, dir, entry))
}

describe('fork localization', () => {
  it('matches only paths inside the fork folders', () => {
    expect(isForkLocalizedSource('mobile/src/components/fork/MobileMarkdownRunSheet.tsx')).toBe(
      true
    )
    expect(isForkLocalizedSource('src/main/fork/app.ts')).toBe(true)
    expect(isForkLocalizedSource('src/main/forked/app.ts')).toBe(false)
    expect(isForkLocalizedSource('src/renderer/src/components/fork/x.tsx')).toBe(false)
  })

  it("keeps upstream's catalog verifiers off the fork folders", async () => {
    for (const dir of FORK_LOCALIZED_SOURCE_DIRS) {
      expect(await collectSourceFiles(repoRoot, join(repoRoot, dir))).toEqual([])
    }
  })

  for (const dir of FORK_LOCALIZED_SOURCE_DIRS) {
    it(`gives every ${dir} string one inline English default and no upstream catalog entry`, () => {
      const upstreamKeys = flatten(
        JSON.parse(readFileSync(join(repoRoot, catalogFor(dir)), 'utf8'))
      )
      const fallbacks = new Map()
      for (const file of forkSourceFiles(dir)) {
        const source = readFileSync(file, 'utf8')
        for (const reference of collectLocalizationKeyReferences(file, source, repoRoot)) {
          const where = `${relative(repoRoot, file)}: ${reference.key}`
          // The inline default is what renders, so a fork string must carry one.
          expect(typeof reference.fallback, where).toBe('string')
          expect(upstreamKeys.has(reference.key), `${where} is in ${catalogFor(dir)}`).toBe(false)
          const previous = fallbacks.get(reference.key)
          expect(previous ?? reference.fallback, where).toBe(reference.fallback)
          fallbacks.set(reference.key, reference.fallback)
        }
      }
    })
  }

  it('still finds the Run button strings', () => {
    const files = forkSourceFiles('mobile/src/components/fork')
    const keys = files.flatMap((file) =>
      collectLocalizationKeyReferences(file, readFileSync(file, 'utf8'), repoRoot).map(
        (reference) => reference.key
      )
    )
    expect(keys).toContain('components.markdownBlocks.runCode.action')
  })
})
