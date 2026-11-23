import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { BotItemStepsView } from '../../../../../shared/bots/bot-item-steps'
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
      command: 'secret-setup grant build-box laptop',
      state: 'open'
    },
    {
      index: 2,
      title: 'Grant the second box read access',
      host: 'laptop',
      command: 'secret-setup grant gpu-box laptop',
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
          "Run this on the laptop:\n\n```sh\ntr -d '\\n' < ~/projects/app/private/token | secret set APP_TOKEN\n```\n\nThen `secret-setup grant build-box laptop`."
        }
      />
    </div>
  )
})
