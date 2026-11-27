// Feedback endpoint (BAD-895): through the real send path (submitFeedback -> postFeedback ->
// net.fetch), nothing is posted until an address is saved, and never anywhere but that address.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() },
  net: { fetch: fetchMock }
}))

import { submitFeedback } from '../../ipc/feedback/feedback'
import { installForkFeedbackEndpointSource } from './feedback-endpoint-source'
import { FORK_FEEDBACK_OFF_ERROR } from '../../../shared/fork/feedback-endpoint'

const REPORT = {
  feedback: 'it broke',
  submitAnonymously: true,
  githubLogin: null,
  githubEmail: null
}
const CRASH_WITH_BUNDLE = {
  ...REPORT,
  submissionType: 'crash' as const,
  diagnosticBundle: { bundleSubmissionId: 'b1', content: '{}\n', bytes: 3, spanCount: 1 },
  feedbackWithoutDiagnosticBundle: 'it broke, no bundle'
}

function saved(settings: unknown): void {
  installForkFeedbackEndpointSource(() => settings)
}

describe('feedback endpoint setting', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  })

  it.each([
    ['no setting', {}],
    ['an empty address', { forkFeedbackEndpointUrl: '' }],
    ['a blank address', { forkFeedbackEndpointUrl: '   ' }],
    ['a non-http address', { forkFeedbackEndpointUrl: 'file:///etc/passwd' }],
    ['an address with a password', { forkFeedbackEndpointUrl: 'https://u:p@example.test/f' }]
  ])('posts nothing with %s: feedback, crash report and bundle', async (_name, settings) => {
    saved(settings)
    const results = [
      await submitFeedback(REPORT),
      await submitFeedback({ ...REPORT, submissionType: 'crash' }),
      await submitFeedback(CRASH_WITH_BUNDLE)
    ]
    for (const result of results) {
      expect(result).toEqual({ ok: false, status: null, error: FORK_FEEDBACK_OFF_ERROR })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the saved address and nowhere else, retries included', async () => {
    const address = 'http://127.0.0.1:9/feedback-sink'
    saved({ forkFeedbackEndpointUrl: ` ${address} ` })
    expect(await submitFeedback(REPORT)).toEqual({ ok: true })
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
    expect((await submitFeedback(CRASH_WITH_BUNDLE)).ok).toBe(false)
    const urls = fetchMock.mock.calls.map((call) => call[0])
    expect(urls.length).toBeGreaterThan(2)
    expect(new Set(urls)).toEqual(new Set([address]))
  })

  it('reads the setting on every send', async () => {
    saved({})
    await submitFeedback(REPORT)
    expect(fetchMock).not.toHaveBeenCalled()
    saved({ forkFeedbackEndpointUrl: 'https://sink.example.test/v1/feedback' })
    await submitFeedback(REPORT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://sink.example.test/v1/feedback')
  })
})
