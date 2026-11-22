import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from './check-injected-context-ratchet.mjs'

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'injected-ctx-'))
  fs.mkdirSync(path.join(root, 'skill-guides'))
  fs.mkdirSync(path.join(root, 'config'))
  fs.writeFileSync(path.join(root, 'skill-guides', 'a.md'), 'x'.repeat(100))
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  return root
}

describe('injected-context ratchet', () => {
  it('passes at baseline and fails when a guide grows 1 KB', () => {
    const root = makeRepo()
    expect(main(root, '--update')).toBe(0)
    expect(main(root)).toBe(0)
    fs.appendFileSync(path.join(root, 'skill-guides', 'a.md'), 'y'.repeat(1024))
    expect(main(root)).toBe(1)
    expect(main(root, '--update')).toBe(0)
    expect(main(root)).toBe(0)
  })
})
