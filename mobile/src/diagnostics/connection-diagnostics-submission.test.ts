// Feedback endpoint (BAD-895): connection diagnostics post nowhere unless an address is built in.
import { describe, expect, it, vi } from 'vitest'
import { submitConnectionDiagnostics } from './connection-diagnostics-submission'
import { MOBILE_FEEDBACK_ENDPOINT } from './feedback-endpoint-config'

const SUBMISSION = { report: 'host: h', appVersion: '1.0.0', platform: 'ios' }

describe('connection diagnostics submission', () => {
  it('has no address unless the build sets one, and posts nothing without it', async () => {
    expect(MOBILE_FEEDBACK_ENDPOINT).toBeNull()
    const fetchImpl = vi.fn()
    const result = await submitConnectionDiagnostics(SUBMISSION, fetchImpl)
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts to the address it is given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const result = await submitConnectionDiagnostics(
      SUBMISSION,
      fetchImpl,
      'https://sink.example.test/f'
    )
    expect(result).toEqual({ ok: true })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://sink.example.test/f')
  })
})
