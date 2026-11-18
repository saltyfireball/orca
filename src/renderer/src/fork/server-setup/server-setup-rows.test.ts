import { describe, expect, it } from 'vitest'
import type { ProjectHostSetupOption } from '@/lib/workspace/creation/project-host-setup-options'
import { buildRunTargetRows } from '@/components/new-workspace/run-target/run-target-options'

function needsSetup(
  hostId: string,
  canSetLocation = true
): Extract<ProjectHostSetupOption, { kind: 'needs-setup' }> {
  return {
    id: `needs-setup:${hostId}`,
    kind: 'needs-setup',
    projectId: 'p1',
    hostId: hostId as never,
    label: hostId,
    detail: '',
    isAvailable: true,
    attention: false,
    canSetLocation
  }
}

const READY: ProjectHostSetupOption = {
  id: 's1',
  kind: 'ready',
  projectId: 'p1',
  hostId: 'local',
  repoId: 'r1',
  label: 'This computer',
  detail: 'Repo',
  path: '/code/repo'
}

describe('buildRunTargetRows with fork server setup (SLRM-2312)', () => {
  const hostOptions = [
    READY,
    needsSetup('runtime:env-a'),
    needsSetup('runtime:env-b', false),
    needsSetup('ssh:box')
  ]

  it('adds one "Set up on" row per available paired server, after the host rows', () => {
    const { rows } = buildRunTargetRows({
      hostOptions,
      recipes: [],
      query: '',
      hasAddHost: true,
      forkServerSetup: true
    })
    expect(rows.map((row) => row.kind)).toEqual([
      'ready',
      'needs-setup',
      'needs-setup',
      'needs-setup',
      'fork-setup',
      'add-host'
    ])
    expect(rows.find((row) => row.kind === 'fork-setup')?.key).toBe('fork-setup:runtime:env-a')
  })

  it('adds none when the offer is off', () => {
    const { rows } = buildRunTargetRows({ hostOptions, recipes: [], query: '', hasAddHost: false })
    expect(rows.some((row) => row.kind === 'fork-setup')).toBe(false)
  })

  it('follows the search like its host row', () => {
    const { rows } = buildRunTargetRows({
      hostOptions,
      recipes: [],
      query: 'env-b',
      hasAddHost: false,
      forkServerSetup: true
    })
    expect(rows.some((row) => row.kind === 'fork-setup')).toBe(false)
  })
})
