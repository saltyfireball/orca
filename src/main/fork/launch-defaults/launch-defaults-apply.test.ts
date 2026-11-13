import { describe, expect, it, vi } from 'vitest'
import type { Automation } from '../../../shared/automations/automation-definition'
import { automationTerminalLaunchInputs } from '../../../shared/automations/launch/automation-launch-setup'
import {
  forkLaunchEffortChoices,
  forkLaunchModelChoices
} from '../../../shared/fork/launch-defaults/launch-defaults-choices'
import {
  applyForkCliLaunchDefault,
  readForkLaunchDefaults,
  withForkAutomationLaunchDefault,
  withForkLaunchChoice
} from './launch-defaults-apply'
import { forkWorkerRowLaunch, resolveForkWorkerLaunch } from './launch-defaults-worker'

const model = forkLaunchModelChoices('claude').find(
  (choice) => forkLaunchEffortChoices('claude', choice.value).length
)!.value
const effort = forkLaunchEffortChoices('claude', model)[0]!.value
const preset = { model, effort }

// A fake runtime whose settings store holds only the fork defaults; nothing real is read.
function host(forkLaunchDefaults: unknown) {
  return { requireStore: () => ({ getSettings: () => ({ forkLaunchDefaults }) }) }
}
const all = host({
  cli: { claude: preset },
  worker: { claude: preset },
  automation: { claude: preset }
})

type FakeIntent = Parameters<typeof applyForkCliLaunchDefault>[1]
const cliIntent = (extra: Partial<FakeIntent> = {}): FakeIntent => ({
  agent: 'claude',
  target: { kind: 'existing' },
  launchSource: 'cli',
  ...extra
})

describe('readForkLaunchDefaults', () => {
  it('reads none when the host has no store', () => {
    const runtime = {
      requireStore: () => {
        throw new Error('no store')
      }
    }
    expect(readForkLaunchDefaults(runtime)).toBeUndefined()
  })
})

describe('CLI launches', () => {
  it('fill the CLI default when no model is chosen', () => {
    const { intent, forkLaunch } = applyForkCliLaunchDefault(all, cliIntent())
    expect(intent.sessionOptions).toEqual(preset)
    expect(forkLaunch).toMatchObject({ kind: 'cli', source: 'fork-default', ...preset })
  })

  it('keep an explicit --model', () => {
    const { intent, forkLaunch } = applyForkCliLaunchDefault(
      all,
      cliIntent({ sessionOptions: { model: 'chosen' } })
    )
    expect(intent.sessionOptions).toEqual({ model: 'chosen' })
    expect(forkLaunch?.source).toBe('explicit')
  })

  it('leave UI, mobile and reused-terminal launches alone', () => {
    for (const intent of [
      cliIntent({ launchSource: 'sidebar' }),
      cliIntent({ launchSource: undefined }),
      cliIntent({ reuseTerminal: { handle: 'h' } })
    ]) {
      const result = applyForkCliLaunchDefault(all, intent)
      expect(result.intent).toBe(intent)
      expect(result.forkLaunch).toBeUndefined()
    }
  })

  it('run stock when no CLI default is set', () => {
    const { intent, forkLaunch } = applyForkCliLaunchDefault(host({}), cliIntent())
    expect(intent.sessionOptions).toBeUndefined()
    expect(forkLaunch?.source).toBe('stock')
  })

  it('attach the choice to the launch result only when there is one', () => {
    expect(withForkLaunchChoice({ a: 1 }, undefined)).toEqual({ a: 1 })
    expect(
      withForkLaunchChoice({ a: 1 }, { kind: 'cli', agent: 'claude', source: 'stock' })
    ).toEqual({ a: 1, forkLaunch: { kind: 'cli', agent: 'claude', source: 'stock' } })
  })
})

describe('orchestration workers', () => {
  const args = { agent: 'claude' as const, createsWorktree: true }

  it('fill the worker default and mark the receipt', () => {
    const resolve = vi.fn((input: { model?: string; effort?: string }) => ({
      preferences: input,
      receipt: { requested: input }
    }))
    const launch = resolveForkWorkerLaunch(all, args, resolve)
    expect(resolve).toHaveBeenCalledWith({ ...args, ...preset })
    expect(launch.receipt).toEqual({ requested: { ...args, ...preset }, forkDefault: 'worker' })
  })

  it('pass an explicit choice or a missing default straight through', () => {
    const resolve = vi.fn(() => ({ receipt: {} }))
    resolveForkWorkerLaunch(all, { ...args, model: 'chosen' }, resolve)
    resolveForkWorkerLaunch(host({ cli: { claude: preset } }), args, resolve)
    expect(resolve).toHaveBeenNthCalledWith(1, { ...args, model: 'chosen' })
    expect(resolve).toHaveBeenNthCalledWith(2, args)
  })

  it('read the row launch back from the saved start options', () => {
    const db = (launch: unknown) => ({
      getWorkerDispatch: () => ({ start_options: JSON.stringify({ launch }) })
    })
    expect(
      forkWorkerRowLaunch(db({ requested: preset, effective: preset, forkDefault: 'worker' }), 'd')
    ).toEqual({ forkLaunch: { ...preset, source: 'fork-default' } })
    expect(forkWorkerRowLaunch(db({ requested: { model: 'm' } }), 'd')).toEqual({
      forkLaunch: { model: 'm', source: 'explicit' }
    })
    expect(forkWorkerRowLaunch(db(undefined), 'd')).toEqual({})
    expect(forkWorkerRowLaunch(null, 'd')).toEqual({})
    expect(forkWorkerRowLaunch({ getWorkerDispatch: () => ({ start_options: '{' }) }, 'd')).toEqual(
      {}
    )
  })
})

describe('automation runs', () => {
  const automation = (extra: Partial<Automation> = {}) =>
    ({ agentId: 'claude', workspaceMode: 'existing', ...extra }) as Automation

  it('fill the automation default into the launch setup the launchers read', () => {
    const filled = withForkAutomationLaunchDefault(all, automation())
    expect(automationTerminalLaunchInputs(filled).sessionOptions).toMatchObject(preset)
  })

  it('keep an automation that names its own model', () => {
    const own = automation({ launchSetup: { launchPreferences: { model: 'chosen' } } })
    expect(withForkAutomationLaunchDefault(all, own)).toBe(own)
    const args = automation({ launchSetup: { extraAgentArgs: '--model chosen' } })
    expect(withForkAutomationLaunchDefault(all, args)).toBe(args)
  })

  it('run stock when no automation default is set', () => {
    const plain = automation()
    expect(withForkAutomationLaunchDefault(host({ worker: { claude: preset } }), plain)).toBe(plain)
  })
})
