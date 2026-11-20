import { describe, expect, it } from 'vitest'
import {
  FORK_QUICK_TASK_BUILT_IN_PLACEMENT,
  FORK_QUICK_TASK_DEFAULT_SHORTCUT,
  isForkQuickTaskAccelerator,
  QuickTaskSubmitParamsSchema,
  readForkQuickTaskConfig
} from './quick-task'
import { QUICK_TASK_TEXT_MAX } from './quick-task-contract'

describe('readForkQuickTaskConfig', () => {
  it('is on with the default shortcut, Dispatcher on claude haiku and the built-in placement', () => {
    expect(readForkQuickTaskConfig({})).toEqual({
      enabled: true,
      shortcut: FORK_QUICK_TASK_DEFAULT_SHORTCUT,
      routerBot: 'Dispatcher',
      routerAgent: 'claude',
      routerModel: 'haiku',
      placementCommand: FORK_QUICK_TASK_BUILT_IN_PLACEMENT
    })
    expect(readForkQuickTaskConfig(null).enabled).toBe(true)
  })

  it('reads every setting', () => {
    expect(
      readForkQuickTaskConfig({
        forkQuickTask: false,
        forkQuickTaskShortcut: ' Control+Alt+K ',
        forkQuickTaskRouterBot: 'Router',
        forkQuickTaskRouterAgent: 'codex',
        forkQuickTaskRouterModel: 'gpt-5-mini',
        forkQuickTaskPlacementCommand: 'server-pick --json'
      })
    ).toEqual({
      enabled: false,
      shortcut: 'Control+Alt+K',
      routerBot: 'Router',
      routerAgent: 'codex',
      routerModel: 'gpt-5-mini',
      placementCommand: 'server-pick --json'
    })
  })

  it('treats an empty shortcut as the default, none and bad accelerators as no shortcut', () => {
    expect(readForkQuickTaskConfig({ forkQuickTaskShortcut: '' }).shortcut).toBe(
      FORK_QUICK_TASK_DEFAULT_SHORTCUT
    )
    expect(readForkQuickTaskConfig({ forkQuickTaskShortcut: 'none' }).shortcut).toBeNull()
    expect(readForkQuickTaskConfig({ forkQuickTaskShortcut: 'Shift+A' }).shortcut).toBeNull()
  })

  it('gives another agent its own default model unless one is set', () => {
    expect(readForkQuickTaskConfig({ forkQuickTaskRouterAgent: 'codex' }).routerModel).toBeNull()
    expect(readForkQuickTaskConfig({ forkQuickTaskRouterModel: '' }).routerModel).toBeNull()
  })

  it('drops the machine suggestion when placement is off', () => {
    expect(
      readForkQuickTaskConfig({
        forkQuickTaskPlacement: false,
        forkQuickTaskPlacementCommand: 'server-pick --json'
      }).placementCommand
    ).toBeNull()
  })
})

describe('isForkQuickTaskAccelerator', () => {
  it.each([
    'CommandOrControl+Alt+Shift+Space',
    'Control+Alt+K',
    'Cmd+Shift+F12',
    'Alt+.',
    'Super+Q'
  ])('takes %s', (value) => expect(isForkQuickTaskAccelerator(value)).toBe(true))

  it.each(['K', 'Shift+K', 'Ctrl+Ctrl+K', 'Ctrl+Alt', 'Ctrl+Banana', 'Hyper+K', ''])(
    'refuses %s',
    (value) => expect(isForkQuickTaskAccelerator(value)).toBe(false)
  )
})

describe('QuickTaskSubmitParamsSchema', () => {
  it('trims the text and refuses empty, too long or unknown sources', () => {
    expect(QuickTaskSubmitParamsSchema.parse({ text: ' do it ', source: 'cli' })).toEqual({
      text: 'do it',
      source: 'cli'
    })
    expect(QuickTaskSubmitParamsSchema.safeParse({ text: '  ', source: 'cli' }).success).toBe(false)
    expect(
      QuickTaskSubmitParamsSchema.safeParse({
        text: 'x'.repeat(QUICK_TASK_TEXT_MAX + 1),
        source: 'cli'
      }).success
    ).toBe(false)
    expect(QuickTaskSubmitParamsSchema.safeParse({ text: 'x', source: 'web' }).success).toBe(false)
  })
})
