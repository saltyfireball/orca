import { describe, expect, it } from 'vitest'
import { buildForkClashes } from '../../shared/fork/branch-clashes'
import { formatForkClashes } from './branch-clashes-handlers'

describe('formatForkClashes', () => {
  it('prints shared files, behind branches and host notes', () => {
    const branch = (name: string, files: string[], behind: number) => ({
      worktreeId: name,
      path: `/w/${name}`,
      branch: name,
      head: 'c'.repeat(40),
      ahead: 1,
      behind,
      files,
      filesTruncated: false
    })
    const result = buildForkClashes(
      [
        {
          hostId: 'local',
          hostName: 'this machine',
          status: 'ok',
          repos: [
            {
              repoId: 'r',
              name: 'orca',
              projectKey: 'github.com/o/orca',
              baseRef: 'origin/main',
              branches: [branch('a', ['x.ts'], 0), branch('b', ['x.ts'], 25)]
            }
          ]
        },
        { hostId: 'runtime:kif', hostName: 'kif', status: 'unreachable', repos: [] }
      ],
      20,
      1
    )
    expect(formatForkClashes(result).split('\n')).toEqual([
      'orca (github.com/o/orca)',
      '  x.ts  <-  a, b',
      '  behind: b is 25 commit(s) behind  [stale]',
      'Note: kif: did not answer'
    ])
  })

  it('says when there is nothing', () => {
    expect(formatForkClashes(buildForkClashes([], 20, 1))).toBe(
      'No shared files and no stale branches.'
    )
  })
})
