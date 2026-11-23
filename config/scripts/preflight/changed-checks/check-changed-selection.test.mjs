import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { planChangedChecks } from './check-changed-selection.mjs'

const repo = path.resolve(import.meta.dirname, '../../../..')

function selects(file) {
  const plan = planChangedChecks([file], {
    scriptsDir: path.join(repo, 'config/scripts'),
    listDirectory: () => [],
    readVersions: () => []
  })
  return plan.checks.some((check) => check.name === 'injected-context-ratchet')
}

describe('injected-context ratchet selection', () => {
  it('runs when only a path it measures changes', () => {
    for (const file of [
      'skills/orca-cli/SKILL.md',
      'skill-stubs/orca-cli.md',
      'skill-stubs/_shared/cli-resolution.md',
      'skill-guides/orca-cli.md',
      'skill-guides/orca-cli/references/artifacts.md',
      'src/main/runtime/orchestration/workers/launch/worker-dispatch-preamble.ts',
      'config/injected-context-baseline.txt'
    ]) {
      expect(fs.existsSync(path.join(repo, file)), file).toBe(true)
      expect(selects(file), file).toBe(true)
    }
  })

  it('does not run for an unrelated path', () => {
    expect(selects('README.md')).toBe(false)
    expect(selects('docs/STYLEGUIDE.md')).toBe(false)
  })
})
