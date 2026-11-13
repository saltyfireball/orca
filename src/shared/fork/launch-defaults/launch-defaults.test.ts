import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../agent-launch/catalog/tui-agent'
import {
  forkLaunchDefaultAgents,
  forkLaunchEffortChoices,
  forkLaunchModelChoices
} from './launch-defaults-choices'
import { describeForkLaunchChoice, resolveForkLaunchChoice } from './launch-defaults-resolve'
import {
  FORK_LAUNCH_KINDS,
  normalizeForkLaunchDefaults,
  setForkLaunchDefault
} from './launch-defaults-settings'

// Read the model and effort from the app's catalog so the test follows catalog changes.
function modelWithEffort(agent: TuiAgent): { model: string; effort: string } {
  for (const { value } of forkLaunchModelChoices(agent)) {
    const effort = forkLaunchEffortChoices(agent, value)[0]?.value
    if (effort) {
      return { model: value, effort }
    }
  }
  throw new Error(`no model with effort for ${agent}`)
}

const claude = modelWithEffort('claude')
const codex = modelWithEffort('codex')

describe('fork launch default choices', () => {
  it('offers agents that take a model at launch, and not OpenCode', () => {
    const agents = forkLaunchDefaultAgents()
    expect(agents).toContain('claude')
    expect(agents).toContain('codex')
    expect(agents).not.toContain('opencode')
    expect(agents).not.toContain('aider')
  })

  it('offers no effort until a model is picked', () => {
    expect(forkLaunchEffortChoices('claude', undefined)).toEqual([])
    expect(forkLaunchEffortChoices('claude', claude.model).length).toBeGreaterThan(0)
  })
})

describe('normalizeForkLaunchDefaults', () => {
  it('keeps offered agents with a model and drops the rest', () => {
    expect(
      normalizeForkLaunchDefaults({
        worker: {
          claude: { model: ` ${claude.model} `, effort: claude.effort },
          codex: { effort: codex.effort },
          aider: { model: 'x' },
          opencode: { model: 'x' }
        },
        review: { claude: { model: claude.model } }
      })
    ).toEqual({ worker: { claude: { model: claude.model, effort: claude.effort } } })
    expect(normalizeForkLaunchDefaults('nope')).toEqual({})
    expect(normalizeForkLaunchDefaults(undefined)).toEqual({})
  })

  it('sets and clears one cell', () => {
    const set = setForkLaunchDefault({}, 'cli', 'codex', codex)
    expect(set).toEqual({ cli: { codex } })
    expect(setForkLaunchDefault(set, 'cli', 'codex', { model: '' })).toEqual({})
  })
})

describe('resolveForkLaunchChoice', () => {
  const settings = Object.fromEntries(
    FORK_LAUNCH_KINDS.map((kind) => [kind, { claude, codex: { model: codex.model } }])
  )

  it.each(FORK_LAUNCH_KINDS)('uses the %s default when nothing is chosen', (kind) => {
    expect(resolveForkLaunchChoice({ settings, kind, agent: 'claude' })).toEqual({
      kind,
      agent: 'claude',
      source: 'fork-default',
      ...claude
    })
    expect(resolveForkLaunchChoice({ settings, kind, agent: 'codex' })).toEqual({
      kind,
      agent: 'codex',
      source: 'fork-default',
      model: codex.model
    })
  })

  it('keeps an explicit model and does not add the default effort to it', () => {
    expect(
      resolveForkLaunchChoice({ settings, kind: 'worker', agent: 'claude', explicitModel: 'x' })
    ).toEqual({ kind: 'worker', agent: 'claude', source: 'explicit', model: 'x' })
  })

  it('treats a model named in the agent arguments as explicit', () => {
    const choice = resolveForkLaunchChoice({
      settings,
      kind: 'automation',
      agent: 'claude',
      agentArgs: '--model other'
    })
    expect(choice.source).toBe('explicit')
    expect(choice.model).toBeUndefined()
  })

  it('lets an effort in the agent arguments win over the default effort', () => {
    expect(
      resolveForkLaunchChoice({
        settings,
        kind: 'cli',
        agent: 'claude',
        agentArgs: '--effort low'
      })
    ).toEqual({ kind: 'cli', agent: 'claude', source: 'fork-default', model: claude.model })
  })

  it('falls back to stock when the kind or agent has no default', () => {
    expect(resolveForkLaunchChoice({ settings: {}, kind: 'cli', agent: 'claude' })).toEqual({
      kind: 'cli',
      agent: 'claude',
      source: 'stock'
    })
    expect(resolveForkLaunchChoice({ settings, kind: 'cli', agent: 'gemini' }).source).toBe('stock')
  })

  it('falls back to stock with a note when the catalog refuses the default', () => {
    const choice = resolveForkLaunchChoice({
      settings: { worker: { claude: { model: claude.model, effort: 'not-an-effort' } } },
      kind: 'worker',
      agent: 'claude'
    })
    expect(choice.source).toBe('stock')
    expect(choice.note).toMatch(/^Default not used: /)
  })
})

describe('describeForkLaunchChoice', () => {
  it('says when the value came from a default', () => {
    expect(
      describeForkLaunchChoice({ kind: 'worker', model: 'm', effort: 'e', source: 'fork-default' })
    ).toBe('model m, effort e (default for orchestration workers)')
    expect(describeForkLaunchChoice({ model: 'm', source: 'explicit' })).toBe(
      'model m (chosen for this launch)'
    )
    expect(describeForkLaunchChoice({ source: 'stock' })).toBe('model from the agent setup')
  })
})
