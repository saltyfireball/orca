// Pause all (BAD-685): a due automation claims its run, records it as skipped with the pause
// reason in run history, and launches nothing; a person's own Run now is never refused.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '../../../shared/automations/automation-definition'
import type { AutomationRun } from '../../../shared/automations/history/automation-run'
import { requestAutomationDispatch } from './automation-dispatch-request'

const pause = vi.hoisted(() => ({ engaged: false }))
vi.mock('../../fork/pause-all/pause-all-state', () => ({
  forkPauseAllRefusal: () => (pause.engaged ? 'Paused by pause-all: test' : null)
}))
vi.mock('../../fork/agent-guards/agent-guards-scopes', () => ({
  forkAutomationCapRefusal: () => null
}))
vi.mock('../../fork/webhooks/webhook-payload', () => ({
  withForkWebhookPayload: (automation: unknown) => automation
}))
vi.mock('../ownership/orcad-fenced-automation', () => ({
  isOrcadFencedAutomation: () => false,
  ORCAD_FENCED_AUTOMATION: 'fenced'
}))
vi.mock('./dispatch-refusal', () => ({
  canDispatchTo: () => true,
  describeScheduledRefusal: () => null,
  describeStoppedWslDistroRefusal: async () => null
}))

afterEach(() => {
  pause.engaged = false
})

const automation = { id: 'a1', workspaceId: 'w1', surface: 'repo' } as unknown as Automation
const target = { ok: true, cwd: '/work', repo: { id: 'r1', path: '/work' } } as never

function rig(trigger: AutomationRun['trigger']) {
  const run = { id: 'run1', status: 'pending', trigger } as unknown as AutomationRun
  const updates: Record<string, unknown>[] = []
  const launcher = vi.fn()
  const ctx = {
    store: {
      listAutomations: () => [automation],
      listAutomationRuns: () => [run],
      flushPendingOrThrowAsync: async () => {}
    },
    runs: {
      updateRun: (update: Record<string, unknown>) => {
        updates.push(update)
        return run
      }
    },
    isActive: () => true,
    launcher: () => ({ launch: launcher }),
    botDispatcher: null,
    resolveTarget: () => target,
    runPrecheck: vi.fn(),
    markDispatchResult: vi.fn(),
    watchRun: vi.fn()
  }
  return { ctx: ctx as never, run, updates, launcher }
}

describe('automation dispatch while pause-all is engaged', () => {
  it.each(['scheduled', 'event'] as const)(
    'skips a %s run and says why in run history',
    async (trigger) => {
      pause.engaged = true
      const { ctx, run, updates, launcher } = rig(trigger)
      await requestAutomationDispatch(ctx, automation, run, target)
      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({
        runId: 'run1',
        status: 'skipped_unavailable',
        error: expect.stringContaining('Paused by pause-all')
      })
      expect(launcher).not.toHaveBeenCalled()
    }
  )

  it("never refuses a person's own Run now", async () => {
    pause.engaged = true
    const { ctx, run, updates } = rig('manual')
    await requestAutomationDispatch(ctx, automation, run, target)
    expect(updates[0]).toMatchObject({ status: 'dispatching' })
  })

  it('claims a scheduled run as before when nothing is paused', async () => {
    const { ctx, run, updates } = rig('scheduled')
    await requestAutomationDispatch(ctx, automation, run, target)
    expect(updates[0]).toMatchObject({ status: 'dispatching' })
  })
})
