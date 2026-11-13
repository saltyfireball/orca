import { describe, expect, it } from 'vitest'
import { formatForkLaunchDefaults } from './launch-defaults-handlers'
import { forkAgentLaunchLines, forkWorkerModelFrom } from './launch-defaults-output'
import { buildForkLaunchDefaultsReport } from '../../shared/fork/launch-defaults/launch-defaults-report'
import {
  forkLaunchEffortChoices,
  forkLaunchModelChoices
} from '../../shared/fork/launch-defaults/launch-defaults-choices'

const model = forkLaunchModelChoices('claude').find(
  (choice) => forkLaunchEffortChoices('claude', choice.value).length
)!.value
const effort = forkLaunchEffortChoices('claude', model)[0]!.value

describe('orca launch-defaults', () => {
  it('reports every kind per agent, with fork defaults over the app default', () => {
    const report = buildForkLaunchDefaultsReport({
      forkLaunchDefaults: { worker: { claude: { model, effort } } },
      agentLaunchChoices: { claude: { model: 'app-model', options: { effort: 'app-effort' } } }
    })
    const claude = report.rows.filter((row) => row.agent === 'claude')
    expect(claude.map((row) => row.kind)).toEqual(['interactive', 'cli', 'worker', 'automation'])
    expect(claude.find((row) => row.kind === 'worker')).toEqual({
      kind: 'worker',
      agent: 'claude',
      source: 'fork-default',
      model,
      effort
    })
    expect(claude.find((row) => row.kind === 'cli')).toEqual({
      kind: 'cli',
      agent: 'claude',
      source: 'stock',
      model: 'app-model',
      effort: 'app-effort'
    })
    const text = formatForkLaunchDefaults(report)
    expect(text).toMatch(/^AGENT\s+KIND\s+MODEL\s+EFFORT\s+FROM/)
    expect(text).toMatch(new RegExp(`claude\\s+worker\\s+${model}\\s+${effort}\\s+launch default`))
    expect(text).toMatch(/claude\s+cli\s+app-model\s+app-effort\s+app default/)
    expect(text).not.toMatch(/codex/)
  })

  it('says so when nothing is set and lists notes', () => {
    expect(formatForkLaunchDefaults(buildForkLaunchDefaultsReport({}))).toBe(
      'No launch defaults set: every launch runs the model from the agent config.'
    )
    const refused = buildForkLaunchDefaultsReport({
      forkLaunchDefaults: { cli: { claude: { model, effort: 'not-an-effort' } } }
    })
    expect(formatForkLaunchDefaults(refused)).toMatch(/Note: claude cli: Default not used: /)
  })
})

describe('launch output lines', () => {
  it('prints the model line only when the host attached a choice', () => {
    expect(forkAgentLaunchLines({})).toEqual([])
    expect(
      forkAgentLaunchLines({
        forkLaunch: { kind: 'cli', model: 'm', effort: 'e', source: 'fork-default' }
      })
    ).toEqual(['model: model m, effort e (default for CLI launches)'])
  })

  it('names the worker default on worker-start', () => {
    expect(forkWorkerModelFrom({ requested: {}, forkDefault: 'worker' })).toBe(
      'worker launch default'
    )
    expect(forkWorkerModelFrom({ requested: {} })).toBeUndefined()
    expect(forkWorkerModelFrom(undefined)).toBeUndefined()
  })
})
