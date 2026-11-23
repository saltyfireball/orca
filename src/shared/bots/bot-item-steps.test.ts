import { describe, expect, it } from 'vitest'
import { parseBotItemSteps, botItemDoneReplyLabel, botItemStepsPlace } from './bot-item-steps'
import { botItemStepTyping, matchBotItemStepHost } from './bot-item-step-terminal'
import { botItemStepsMarkdown, parseBotItemStepsInput } from './bot-item-steps-text'
import { botItemCommentHoldsCommands, looksLikeShellCommand } from './bot-item-command-advice'

describe('owner step commands', () => {
  it('refuses a command that could run itself or end a paste, and drops a trailing newline', () => {
    const bad = (command: string) => parseBotItemSteps([{ title: 'x', command }])
    expect(bad('echo hi\u001b[201~; rm -rf ~').ok).toBe(false)
    expect(bad('echo \u0007 hi').ok).toBe(false)
    expect(bad('echo ‮ hi').ok).toBe(false)
    expect(parseBotItemSteps([{ title: 'x', command: 'echo hi\n\n' }])).toEqual({
      ok: true,
      steps: [{ title: 'x', command: 'echo hi' }]
    })
  })

  it('types only what a terminal cannot run on its own', () => {
    expect(botItemStepTyping("tr -d '\\n' < f | secret set X")).toEqual({
      ok: true,
      text: "tr -d '\\n' < f | secret set X"
    })
    expect(botItemStepTyping('a \\\n  b')).toMatchObject({ ok: true })
    expect(botItemStepTyping('echo a\necho b')).toEqual({ ok: false, reason: 'multiline' })
    expect(botItemStepTyping('echo \u001b[200~')).toEqual({ ok: false, reason: 'unsafe' })
  })

  it('reads the text form with quotes, pipes and backslashes kept exactly', () => {
    const text = [
      'step: Store it',
      'host: laptop',
      'note: Then press Enter.',
      'command:',
      "  tr -d '\\n' < /tmp/x | secret set NAME",
      '  echo "$HOME"',
      '',
      'step: Log in'
    ].join('\n')
    expect(parseBotItemStepsInput(text)).toEqual({
      ok: true,
      steps: [
        {
          title: 'Store it',
          host: 'laptop',
          note: 'Then press Enter.',
          command: 'tr -d \'\\n\' < /tmp/x | secret set NAME\necho "$HOME"'
        },
        { title: 'Log in' }
      ]
    })
    expect(parseBotItemStepsInput('[{"title":"A","command":"ls"}]')).toMatchObject({ ok: true })
    expect(parseBotItemStepsInput('[{"title":""}]').ok).toBe(false)
  })

  it('writes a fallback list with each command fenced', () => {
    expect(botItemStepsMarkdown([{ title: 'A', command: 'echo ```', host: 'alpha' }])).toContain(
      '````sh'
    )
  })

  it('finds the one plain done option, and none when it is unclear', () => {
    const one = (...labels: string[]) => [{ replies: labels.map((label) => ({ label })) }]
    expect(botItemDoneReplyLabel(one('Done', 'Not yet'))).toBe('Done')
    expect(botItemDoneReplyLabel(one('Yes', 'No'))).toBeNull()
    expect(botItemDoneReplyLabel(one('Done', 'All done'))).toBeNull()
    expect(botItemDoneReplyLabel([...one('Done'), ...one('Done')])).toBeNull()
  })

  it('names a step host among known computers, and this one by its own names', () => {
    const hosts = [{ id: 'runtime:r1' as const, label: 'Studio' }]
    expect(matchBotItemStepHost(' studio ', hosts, [])).toBe('runtime:r1')
    expect(matchBotItemStepHost('desk', hosts, ['Desk'])).toBe('local')
    expect(matchBotItemStepHost('elsewhere', hosts, ['Desk'])).toBeNull()
  })

  it('tips when commands sit in prose, not when they are fenced or only prose', () => {
    const prose =
      "On the laptop: (1) tr -d '\\n' < /a/token | secret set NAME (2) vault-setup grant box laptop"
    expect(botItemCommentHoldsCommands(prose)).toBe(true)
    expect(botItemCommentHoldsCommands('```sh\n(1) git pull\n(2) git push\n```')).toBe(false)
    expect(botItemCommentHoldsCommands('(1) the plan is fine (2) the schedule is fine')).toBe(false)
    expect(looksLikeShellCommand("tr -d '\\n' < /Users/x/token | secret set N")).toBe(true)
    expect(looksLikeShellCommand('/Users/x/notes.md')).toBe(false)
  })
})

describe('owner step text', () => {
  it('keeps text exactly, refuses a step with both command and text, and refuses controls', () => {
    expect(parseBotItemSteps([{ title: 'Tell the bot', text: 'hello test \u{1F600}\n' }])).toEqual({
      ok: true,
      steps: [{ title: 'Tell the bot', text: 'hello test \u{1F600}' }]
    })
    expect(parseBotItemSteps([{ title: 'x', command: 'ls', text: 'hi' }]).ok).toBe(false)
    expect(parseBotItemSteps([{ title: 'x', text: 'hi\u001b[0m' }]).ok).toBe(false)
  })

  it('reads text: lines, fences text as text in the Markdown fallback', () => {
    const parsed = parseBotItemStepsInput(
      ['step: Ask in Slack', 'text: hello test', 'step: Run it', 'command:', '  ls -la'].join('\n')
    )
    expect(parsed).toEqual({
      ok: true,
      steps: [
        { title: 'Ask in Slack', text: 'hello test' },
        { title: 'Run it', command: 'ls -la' }
      ]
    })
    if (parsed.ok) {
      expect(botItemStepsMarkdown(parsed.steps)).toContain('```text\n   hello test')
    }
  })

  it('places steps in the loaded ask, above the activity otherwise', () => {
    const steps = { eventId: 'e1', steps: [] }
    const events = [{ id: 'e2' }]
    expect(botItemStepsPlace({ steps, question: { eventId: 'e2' } }, events)).toBe('ask')
    expect(botItemStepsPlace({ steps, question: { eventId: 'e9' } }, events)).toBe('above')
    expect(botItemStepsPlace({ steps, question: null }, events)).toBe('above')
    expect(botItemStepsPlace({ question: null }, events)).toBe('none')
  })
})
