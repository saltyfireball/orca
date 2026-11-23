import { describe, expect, it } from 'vitest'
import type { ForkServerUpdateStatus } from '../../shared/fork/server-update-wire'
import { formatServersList } from './servers-format'

const base: ForkServerUpdateStatus = {
  version: '1.4.262001',
  platform: 'linux',
  arch: 'x64',
  install: { kind: 'linux-server', path: '/srv/orca-server', service: 'orca-serve.service' },
  accept: true,
  previousVersion: null,
  job: null
}

describe('formatServersList', () => {
  it('shows the release version, the build apart, and ssh-managed servers as such', () => {
    const text = formatServersList({
      version: '1.4.262001',
      servers: [
        {
          id: 'alpha',
          name: 'alpha',
          status: { ...base, buildVersion: '0.1.0+081afb112818' },
          versus: 0
        },
        {
          id: 'studio',
          name: 'studio',
          status: {
            ...base,
            buildVersion: '0.1.0+d3d71665fdf0',
            install: null,
            problem: 'no `orca serve` service runs this profile here'
          },
          versus: 0,
          sshManaged: true
        }
      ]
    })
    const lines = text.split('\n')
    expect(lines[1].split(/\s{2,}/)).toEqual([
      'NAME',
      'VERSION',
      'BUILD',
      'STATE',
      'KIND',
      'ROLLBACK'
    ])
    expect(lines[2].split(/\s{2,}/)).toEqual([
      'alpha',
      '1.4.262001',
      '0.1.0+081afb112818',
      'current',
      'linux-server (orca-serve.service)',
      '-'
    ])
    expect(lines[3].split(/\s{2,}/)).toEqual([
      'studio',
      '1.4.262001',
      '0.1.0+d3d71665fdf0',
      'ssh-managed (use orca environment update)',
      '-',
      '-'
    ])
    expect(text).not.toMatch(/orca serve` service/)
  })
})
