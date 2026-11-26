import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { BotItemStepsView } from '../../../../../shared/bots/bot-item-steps'
import { fixtureCos } from '../../../component-fixtures/fixture-bot-panel'
import { makeTestBotItem } from '../../../../../shared/bots/bot-item.test-fixture'
import type { BotItemEvent } from '../../../../../shared/bots/bot-items'
import { BotItemActivityList } from './BotItemActivityList'
import { BotItemSteps } from './BotItemSteps'
import { BotItemMarkdown } from './BotItemMarkdown'

const view: BotItemStepsView = {
  eventId: 'e12',
  steps: [
    {
      index: 0,
      title: 'Store the token',
      host: 'laptop',
      note: 'Paste it, then press Enter.',
      command: "tr -d '\\n' < ~/projects/app/private/token | secret set APP_TOKEN",
      state: 'done'
    },
    {
      index: 1,
      title: 'Grant the build box read access',
      host: 'laptop',
      command: 'vault-setup grant build-box laptop',
      state: 'open'
    },
    {
      index: 2,
      title: 'Grant the second box read access',
      host: 'laptop',
      command: 'vault-setup grant gpu-box laptop',
      state: 'open'
    },
    {
      index: 3,
      title: 'Log in to the CLI on the build box',
      host: 'build-box',
      note: 'Run the CLI there, type /login, and open the link on your laptop.',
      state: 'open'
    }
  ]
}

const open = (): { canOpen: true; open: () => void } => ({ canOpen: true, open: () => {} })

const mark = (): Promise<boolean> => Promise.resolve(true)

export const desktop = defineFixture({
  width: 380,
  render: () => (
    <div className="bg-sidebar p-3.5">
      <BotItemSteps view={view} onMark={mark} terminalFor={open} />
    </div>
  )
})

export const phoneWidth = defineFixture({
  width: 390,
  render: () => (
    <div className="bg-sidebar p-3.5">
      <BotItemSteps view={view} onMark={mark} />
    </div>
  )
})

export const fencedBlockInComment = defineFixture({
  width: 380,
  render: () => (
    <div className="bg-sidebar p-3.5">
      <BotItemMarkdown
        text={
          "Run this on the laptop:\n\n```sh\ntr -d '\\n' < ~/projects/app/private/token | secret set APP_TOKEN\n```\n\nThen `vault-setup grant build-box laptop`."
        }
      />
    </div>
  )
})

// BAD-762: the steps inside the Needs you card they were set with: the words, the steps (a command, text to
// paste into Slack, a manual click), then the question.
const askView: BotItemStepsView = {
  eventId: 'e3',
  steps: [
    {
      index: 0,
      title:
        'Open chat.example.sh in a browser and send the test message from step 2, then wait for the reply',
      command: 'open https://chat.example.sh',
      host: 'laptop',
      state: 'open'
    },
    {
      index: 1,
      title: 'Send this exact message in the chat',
      text: 'hello test',
      state: 'open'
    },
    { index: 2, title: 'Reload the page and watch for ten seconds', state: 'open' }
  ]
}
const by = { kind: 'bot' as const, botId: fixtureCos.id, chatId: 'chat-home' }
const askEvents: BotItemEvent[] = [
  {
    id: 'e2',
    kind: 'commented',
    actor: by,
    data: {
      text: 'Send the exact line shown in step 2, then check the reply. Do the three steps in order.',
      ask: {
        context:
          'Send the exact line shown in step 2, then check the reply. Do the three steps in order.',
        questions: [
          {
            prompt: 'Did the reply stay on the page and read as normal text?',
            options: [{ label: 'Yes' }, { label: 'It vanished' }, { label: 'No answer came' }]
          }
        ]
      }
    },
    at: 1_700_000_000_000
  },
  { id: 'e3', kind: 'steps', actor: by, data: {}, at: 1_700_000_001_000 }
]
const askItem = makeTestBotItem(100, {
  status: 'needs_you',
  owner: { botId: fixtureCos.id, name: 'Release helper' },
  question: { eventId: 'e2', text: 'Did the reply stay on the page and read as normal text?' },
  steps: askView
})

function AskWithSteps(): React.JSX.Element {
  return (
    <div className="bg-sidebar px-3.5 py-3">
      <BotItemActivityList
        bot={fixtureCos}
        item={askItem}
        events={askEvents}
        quickReplies={{ send: () => {}, edit: () => {}, restore: () => false, type: () => {} }}
        steps={<BotItemSteps view={askView} onMark={mark} terminalFor={open} />}
      />
    </div>
  )
}

export const inAskCard = defineFixture({ width: 440, render: () => <AskWithSteps /> })
export const inAskCardNarrow = defineFixture({ width: 300, render: () => <AskWithSteps /> })
export const inAskCardPhone = defineFixture({ width: 390, render: () => <AskWithSteps /> })
