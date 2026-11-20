import { describe, expect, it, vi } from 'vitest'
import type { ProjectHostSetupOption } from '@/lib/workspace/creation/project-host-setup-options'
import { buildRunTargetRows } from '@/components/new-workspace/run-target/run-target-options'
import { translate } from '@/i18n/i18n'
import { forkServerSetupCandidates } from './server-setup-rows'
import { forkServerSetupHostOptions } from './use-fork-server-setup-host-options'
import type { ForkServerSetupState } from './use-fork-server-setup'

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

const HOST_OPTIONS = [
  READY,
  needsSetup('runtime:env-a'),
  needsSetup('runtime:env-b', false),
  needsSetup('ssh:box')
]

function setupState(overrides: Partial<ForkServerSetupState> = {}): ForkServerSetupState {
  return {
    offered: true,
    parent: '~/development',
    progress: new Map(),
    errors: new Map(),
    start: vi.fn(),
    ...overrides
  }
}

describe('fork server setup rows (SLRM-2312)', () => {
  it('offers only paired servers that lack the project and could set it up', () => {
    expect(forkServerSetupCandidates(HOST_OPTIONS).map((option) => option.hostId)).toEqual([
      'runtime:env-a'
    ])
  })

  it('makes one "Set up on" host option per candidate that starts the setup', () => {
    const setup = setupState()
    const options = forkServerSetupHostOptions(HOST_OPTIONS, setup, translate)
    expect(options.map((option) => option.id)).toEqual(['fork-setup:runtime:env-a'])
    expect(options[0].keepOpen).toBe(true)
    options[0].onSelect?.()
    expect(setup.start).toHaveBeenCalledWith(HOST_OPTIONS[1])
  })

  it('adds none when the offer is off', () => {
    expect(
      forkServerSetupHostOptions(HOST_OPTIONS, setupState({ offered: false }), translate)
    ).toEqual([])
  })

  it('shows a running setup and the last error', () => {
    const running = forkServerSetupHostOptions(
      HOST_OPTIONS,
      setupState({
        progress: new Map([['runtime:env-a', { stage: 'cloning', folder: '/srv/repo' }]])
      }),
      translate
    )
    expect(running[0].detail).toContain('/srv/repo')
    const failed = forkServerSetupHostOptions(
      HOST_OPTIONS,
      setupState({ errors: new Map([['runtime:env-a', 'no remote']]) }),
      translate
    )
    expect(failed[0].detail).toBe('no remote')
  })

  it('lists the rows with the ready hosts and follows the search like its host row', () => {
    const extra = forkServerSetupHostOptions(HOST_OPTIONS, setupState(), translate)
    const all = [
      {
        id: 's1',
        hostId: 'local' as const,
        label: 'This computer',
        detail: '',
        available: true
      },
      ...extra
    ]
    const listed = buildRunTargetRows({
      hostOptions: all,
      recipes: [],
      query: '',
      hasAddHost: false
    }).rows
    expect(listed.map((row) => row.key)).toContain('host:fork-setup:runtime:env-a')
    const searched = buildRunTargetRows({
      hostOptions: all,
      recipes: [],
      query: 'env-b',
      hasAddHost: false
    })
    expect(searched.rows.some((row) => row.key.includes('fork-setup'))).toBe(false)
  })
})
