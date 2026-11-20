import { describe, expect, it, vi } from 'vitest'
import {
  QUICK_TASK_SUBMIT_METHOD,
  QUICK_TASK_TEXT_MAX
} from '../../../../../src/shared/fork/quick-task-contract'
import type { RpcResponse } from '../../../transport/rpc/rpc-wire-types'
import {
  QUICK_TASK_SUBMIT_TIMEOUT_MS,
  QuickTaskHostTooOldError,
  appendQuickTaskDictation,
  checkQuickTaskText,
  quickTaskSentMessage,
  submitQuickTask
} from './quick-task-submit'

function fakeClient(response: RpcResponse) {
  return { sendRequest: vi.fn(async () => response) }
}

const ok = (result: unknown): RpcResponse => ({ id: '1', ok: true, result })
const refused = (code: string, message: string): RpcResponse => ({
  id: '1',
  ok: false,
  error: { code, message }
})

describe('checkQuickTaskText', () => {
  it('trims the task', () => {
    expect(checkQuickTaskText('  fix the login  \n')).toEqual({ ok: true, text: 'fix the login' })
  })

  it('refuses an empty or blank task', () => {
    expect(checkQuickTaskText('')).toMatchObject({ ok: false })
    expect(checkQuickTaskText(' \n\t ')).toMatchObject({ ok: false })
  })

  it('takes a task at the cap and refuses one past it', () => {
    expect(checkQuickTaskText('a'.repeat(QUICK_TASK_TEXT_MAX)).ok).toBe(true)
    const over = checkQuickTaskText('a'.repeat(QUICK_TASK_TEXT_MAX + 1))
    expect(over.ok).toBe(false)
    expect(over.ok ? '' : over.reason).toContain(String(QUICK_TASK_TEXT_MAX))
  })
})

describe('appendQuickTaskDictation', () => {
  it('fills an empty box', () => {
    expect(appendQuickTaskDictation('', ' add a dark mode ')).toBe('add a dark mode')
  })

  it('adds after typed text with one space', () => {
    expect(appendQuickTaskDictation('For Cassie:  ', 'add a dark mode')).toBe(
      'For Cassie: add a dark mode'
    )
  })

  it('ignores an empty transcript', () => {
    expect(appendQuickTaskDictation('kept', '   ')).toBe('kept')
  })

  it('never grows past the cap', () => {
    const full = 'a'.repeat(QUICK_TASK_TEXT_MAX - 2)
    expect(appendQuickTaskDictation(full, 'more words')).toHaveLength(QUICK_TASK_TEXT_MAX)
  })
})

describe('submitQuickTask', () => {
  it('sends the trimmed text as a mobile task and reads the bot', async () => {
    const client = fakeClient(ok({ botName: 'Cassandra', chatId: 'chat-1', note: 'kif is free' }))
    await expect(submitQuickTask(client, '  add a page  ')).resolves.toEqual({
      botName: 'Cassandra',
      chatId: 'chat-1',
      note: 'kif is free'
    })
    expect(client.sendRequest).toHaveBeenCalledWith(
      QUICK_TASK_SUBMIT_METHOD,
      { text: 'add a page', source: 'mobile' },
      { timeoutMs: QUICK_TASK_SUBMIT_TIMEOUT_MS }
    )
  })

  it('takes a missing chat id as null', async () => {
    const client = fakeClient(ok({ botName: 'Router', note: '' }))
    await expect(submitQuickTask(client, 'x')).resolves.toEqual({
      botName: 'Router',
      chatId: null,
      note: ''
    })
  })

  it('never sends an empty task', async () => {
    const client = fakeClient(ok({}))
    await expect(submitQuickTask(client, '   ')).rejects.toThrow()
    expect(client.sendRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['method_not_found', 'Unknown method'],
    ['forbidden', 'nope'],
    ['bad_request', 'Method quickTask.submit is not available to mobile clients']
  ])('says to update Blackfish when the host refuses with %s', async (code, message) => {
    const client = fakeClient(refused(code, message))
    const error = await submitQuickTask(client, 'task').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(QuickTaskHostTooOldError)
    expect((error as Error).message).toContain('Update Blackfish on this computer')
  })

  it('passes any other refusal through', async () => {
    const client = fakeClient(refused('internal', 'No router bot is set up.'))
    await expect(submitQuickTask(client, 'task')).rejects.toThrow('No router bot is set up.')
  })

  it.each([[null], ['text'], [{ note: 'x' }], [{ botName: ' ', note: '' }], [{ botName: 'A' }]])(
    'refuses a reply it cannot read: %j',
    async (result) => {
      await expect(submitQuickTask(fakeClient(ok(result)), 'task')).rejects.toThrow(
        'does not understand'
      )
    }
  )

  it('lets a transport failure through unchanged', async () => {
    const failure = new Error('socket closed')
    const client = {
      sendRequest: vi.fn(async (): Promise<RpcResponse> => {
        throw failure
      })
    }
    await expect(submitQuickTask(client, 'task')).rejects.toBe(failure)
  })
})

describe('quickTaskSentMessage', () => {
  it('names the bot', () => {
    expect(quickTaskSentMessage({ botName: 'Blackfish', chatId: null, note: '' })).toBe(
      'Sent to Blackfish'
    )
  })
})
