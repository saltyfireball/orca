import { describe, expect, it } from 'vitest'
import { formatQuickTaskResult, readQuickTaskText } from './quick-task-handlers'

describe('orca quick-task', () => {
  it('joins the words as typed', () => {
    expect(readQuickTaskText(['add', 'Ada', 'a', 'voice'])).toBe('add Ada a voice')
  })

  it('refuses no text and too much text', () => {
    expect(() => readQuickTaskText([])).toThrow('Say what the task is')
    expect(() => readQuickTaskText(['x'.repeat(8001)])).toThrow('at most 8000')
  })

  it('prints where the task went', () => {
    expect(
      formatQuickTaskResult({
        botName: 'Dispatcher',
        chatId: 'c1',
        note: 'Dispatcher is routing it.'
      })
    ).toBe('Sent to Dispatcher.\nDispatcher is routing it.\nChat: c1')
    expect(
      formatQuickTaskResult({ botName: 'Dispatcher', chatId: 'c1', note: 'n', machine: 'desk' })
    ).toBe('Sent to Dispatcher.\nn\nChat: c1 on desk')
  })
})
