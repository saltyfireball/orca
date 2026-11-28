// BAD-896: the fork's release build sets ORCA_FORK_STABLY_CLOUD_DEFAULT=on, so released builds
// keep upstream's cloud services (phone relay, push) on until the setting says otherwise. A build
// that leaves it unset is off. Losing the line from the workflow would silently ship builds with
// the services off.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..', '..', '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const NAME = 'ORCA_FORK_STABLY_CLOUD_DEFAULT'

describe('fork release build cloud default', () => {
  const workflow = read('.github/workflows/fork-sync.yml')

  it('sets the default on for every job, in the workflow-level env', () => {
    const top = workflow.slice(workflow.indexOf('\nenv:\n'), workflow.indexOf('\njobs:\n'))
    expect(top).toMatch(new RegExp(`^  ${NAME}: ['"]?on['"]?\\s*$`, 'm'))
  })

  it('no job turns it off again', () => {
    expect(workflow.match(new RegExp(NAME, 'g'))).toHaveLength(1)
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
    expect(jobs).not.toContain(NAME)
  })

  it('the Linux server ships the template built under that env, not one built by the called workflow', () => {
    expect(workflow).toMatch(/template_artifact: orcad-template-fork/)
  })

  it('the build reads the same name and only the value on turns it on', () => {
    const config = read('electron.vite.config.ts')
    expect(config).toContain(`process.env.${NAME} === 'on'`)
  })
})
