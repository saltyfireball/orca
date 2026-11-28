#!/usr/bin/env node
// THIRD_PARTY_NOTICES.txt (BAD-897, FORK.md "Third-party notices"): the license notices of Orca,
// T3 Code and every package in pnpm-lock.yaml, read from each installed package's own license
// files. Regenerate both copies (the desktop's at the root, the iOS app's in mobile/) before each
// release with `pnpm run notices:generate`. Usage: third-party-notices.mjs [root] [--production],
// where --production leaves out devDependencies (the desktop keeps them: its renderer bundles some).
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { parseAllDocuments } from 'yaml'

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** Notices no lockfile holds: the upstream app this fork is built on, and the project whose
 * ideas several fork features port. */
export const HAND_NOTICES = [
  {
    title: 'Orca (https://github.com/stablyai/orca), which this app is built on',
    text: `MIT License\n\nCopyright (c) 2026 Lovecast Inc.\n\n${MIT_BODY}`
  },
  {
    title: 'T3 Code (https://github.com/pingdotgg/t3code), whose designs several features port',
    text: `MIT License\n\nCopyright (c) 2026 T3 Tools Inc.\n\n${MIT_BODY}`
  }
]

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i

/** `name@version` of a lockfile snapshot key or dependency value, peer suffix dropped. */
function packageId(name, version) {
  const bare = version.split('(')[0]
  // An alias (`string-width-cjs: string-width@4.2.3`) names its real package in the value.
  return /^@?[^@]+@/.test(bare) && !/^\d/.test(bare) ? bare : `${name}@${bare}`
}

function splitId(id) {
  const at = id.lastIndexOf('@')
  return { name: id.slice(0, at), version: id.slice(at + 1) }
}

/** The pnpm v9 lockfile's importers and snapshots (the last YAML document; pnpm may put its own
 * package-manager lock first). */
export function parseLockfile(text) {
  const docs = parseAllDocuments(text).map((doc) => doc.toJS())
  const lock = docs.at(-1) ?? {}
  return {
    importers: lock.importers ?? {},
    packages: lock.packages ?? {},
    snapshots: lock.snapshots ?? {}
  }
}

/** Every package the importers reach, as `{ id, name, version, via }`: `via` is the folder its
 * importer or parent resolves it from, `alias` the folder name it is installed under. */
export function lockfilePackages(lock, { production = false } = {}) {
  const fields = production
    ? ['dependencies', 'optionalDependencies']
    : ['dependencies', 'optionalDependencies', 'devDependencies']
  const seen = new Map()
  const queue = []
  const visit = (alias, version, via) => {
    if (/^(link|file|workspace):/.test(version)) {
      return
    }
    const key = /^@?[^@(]+@/.test(version) && !/^\d/.test(version) ? version : `${alias}@${version}`
    // Peer variants of one package are separate snapshots and may reach different packages.
    if (seen.has(key)) {
      return
    }
    const id = packageId(alias, version)
    const meta = lock.packages?.[id] ?? {}
    const platform = Boolean(meta.os || meta.cpu || meta.libc)
    const entry = { id, ...splitId(id), alias, via, key, platform }
    seen.set(key, entry)
    queue.push(entry)
  }
  for (const [importerPath, importer] of Object.entries(lock.importers)) {
    for (const field of fields) {
      for (const [alias, dep] of Object.entries(importer[field] ?? {})) {
        visit(alias, String(dep.version), { importer: importerPath })
      }
    }
  }
  while (queue.length > 0) {
    const entry = queue.shift()
    const snapshot = lock.snapshots[entry.key] ?? {}
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [alias, version] of Object.entries(snapshot[field] ?? {})) {
        visit(alias, String(version), { parent: entry.key })
      }
    }
  }
  return [...seen.values()]
}

/** Node's lookup of `name` from folder `from`: each ancestor's node_modules, nearest first. */
function resolvePackageDir(from, name) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name)
      if (existsSync(path.join(candidate, 'package.json'))) {
        return realpathSync(candidate)
      }
    }
    if (path.dirname(dir) === dir) {
      return null
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function licenseField(manifest) {
  const value = manifest?.license ?? manifest?.licenses
  if (typeof value === 'string') {
    return value
  }
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.map((item) => item?.type ?? String(item)).join(' OR ') || 'UNKNOWN'
}

function licenseTexts(dir) {
  return readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file) && statSync(path.join(dir, file)).isFile())
    .sort()
    .map((file) => readFileSync(path.join(dir, file), 'utf8').replace(/\r\n?/g, '\n').trim())
    .filter(Boolean)
}

/** Reads each package's license from its installed folder under `root`. */
export function collectNotices(root, packages) {
  const dirs = new Map()
  const ids = new Map(packages.map((entry) => [entry.key, entry.id]))
  const found = new Map()
  const missing = new Set()
  const platform = new Set()
  for (const entry of packages) {
    if (entry.platform) {
      // Which platform's binaries are installed depends on the machine, so these are listed by
      // name on every machine and never read, keeping the file the same wherever it is made.
      const parent = entry.via.parent ? ids.get(entry.via.parent) : entry.via.importer
      platform.add(`${entry.id} (pulled in by ${parent})`)
    }
    const from = entry.via.importer
      ? path.join(root, entry.via.importer)
      : dirs.get(entry.via.parent)
    const dir = from ? resolvePackageDir(from, entry.alias) : null
    const manifest = dir ? readJson(path.join(dir, 'package.json')) : null
    if (!dir || manifest?.version !== entry.version) {
      if (!entry.platform) {
        missing.add(entry.id)
      }
      continue
    }
    dirs.set(entry.key, dir)
    if (!entry.platform && !found.has(entry.id)) {
      found.set(entry.id, {
        id: entry.id,
        license: licenseField(manifest),
        texts: licenseTexts(dir)
      })
    }
  }
  return {
    found: [...found.values()],
    missing: [...missing].filter((id) => !found.has(id)),
    platform: [...platform]
  }
}

function sortedUnique(items) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, 'en'))
}

/** The notices file: hand notices, then each distinct license text once with its packages. */
export function renderNotices({ found, missing, platform = [] }) {
  const rule = '='.repeat(78)
  const out = [
    'THIRD-PARTY NOTICES',
    '',
    'This app includes software from the projects below. Each notice is reproduced as its',
    'project ships it. Packages that share the same license text are listed together above it.',
    ''
  ]
  for (const notice of HAND_NOTICES) {
    out.push(rule, notice.title, rule, '', notice.text, '')
  }
  const groups = new Map()
  const withoutText = []
  for (const item of found) {
    if (item.texts.length === 0) {
      withoutText.push(`${item.id} (${item.license})`)
      continue
    }
    const text = item.texts.join('\n\n')
    groups.set(text, [...(groups.get(text) ?? []), `${item.id} (${item.license})`])
  }
  const ordered = [...groups.entries()]
    .map(([text, ids]) => [text, sortedUnique(ids)])
    .sort(([, a], [, b]) => a[0].localeCompare(b[0], 'en'))
  for (const [text, ids] of ordered) {
    out.push(rule, ...ids, rule, '', text, '')
  }
  if (withoutText.length > 0) {
    out.push(
      rule,
      'Packages that ship no license file (license as their package.json names it)',
      rule,
      ''
    )
    out.push(...sortedUnique(withoutText), '')
  }
  if (platform.length > 0) {
    out.push(rule, 'Platform binary packages (one build per operating system and processor, each')
    out.push(
      'published with the package that pulls it in)',
      rule,
      '',
      ...sortedUnique(platform),
      ''
    )
  }
  if (missing.length > 0) {
    out.push(rule, 'In the lockfile but not installed where this file was generated', rule, '')
    out.push(...sortedUnique(missing), '')
  }
  return `${out.join('\n').trimEnd()}\n`
}

export function generateNotices(root, { production = false } = {}) {
  const lock = parseLockfile(readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'))
  return renderNotices(collectNotices(root, lockfilePackages(lock, { production })))
}

function main() {
  const args = process.argv.slice(2)
  const production = args.includes('--production')
  const rootArg = args.find((arg) => !arg.startsWith('--'))
  const root = path.resolve(rootArg ?? '.')
  if (!existsSync(path.join(root, 'node_modules'))) {
    console.error(`no node_modules in ${root}: install its packages first`)
    return 1
  }
  const outFile = path.join(root, 'THIRD_PARTY_NOTICES.txt')
  writeFileSync(outFile, generateNotices(root, { production }))
  console.log(`wrote ${path.relative(process.cwd(), outFile) || outFile}`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main())
}
