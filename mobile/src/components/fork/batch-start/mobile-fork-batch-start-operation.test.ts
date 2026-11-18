import { describe, expect, it } from 'vitest'
import { mobileForkBatchRequest } from './mobile-fork-batch-start-operation'

const target = { project: { id: 'github:o/r', name: 'Orca' }, repoId: 'r1', repoHostId: 'local' }

describe('mobileForkBatchRequest', () => {
  it('asks for auto placement by project', () => {
    expect(mobileForkBatchRequest(target, true, 'p', ['claude'])).toEqual({
      project: target.project,
      prompt: 'p',
      agents: ['claude'],
      placement: 'auto'
    })
  })

  it('asks auto to set a server up only when the setting is on (SLRM-2406)', () => {
    expect(mobileForkBatchRequest(target, true, 'p', ['claude'], true)).toMatchObject({
      placement: 'auto',
      setupMissing: true
    })
    expect(mobileForkBatchRequest(target, false, 'p', ['claude'], true)).not.toHaveProperty(
      'setupMissing'
    )
  })

  it('runs on the repo host otherwise, naming an SSH host', () => {
    expect(mobileForkBatchRequest(target, false, 'p', ['codex'])).toEqual({
      repo: 'id:r1',
      prompt: 'p',
      agents: ['codex'],
      placement: 'here'
    })
    expect(
      mobileForkBatchRequest({ ...target, repoHostId: 'ssh:box' }, false, 'p', ['codex'])
    ).toMatchObject({ repoHostId: 'ssh:box' })
  })
})
