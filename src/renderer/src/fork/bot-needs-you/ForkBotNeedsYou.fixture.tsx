// The sidebar row's count beside what the bot's panel lists (FORK.md "Needs you list", BAD-795).
import { defineFixture } from '../../component-fixtures/component-fixture'
import {
  BotRowAndPanel,
  sceneStore,
  setupScene,
  type BotNeedsYouScene
} from './bot-needs-you-test-kit'

function scene(parts: BotNeedsYouScene, selected: boolean) {
  return defineFixture({
    width: 660,
    store: sceneStore(parts, selected),
    setup: () => setupScene(parts),
    render: () => <BotRowAndPanel />
  })
}

export const itemOnly = scene({ item: true }, false)
export const itemOnlySelected = scene({ item: true }, true)
export const waitingChatOnly = scene({ waitingChat: true }, false)
export const waitingChatOnlySelected = scene({ waitingChat: true }, true)
export const both = scene({ item: true, waitingChat: true }, false)
export const bothSelected = scene({ item: true, waitingChat: true }, true)
export const backgroundRunOnly = scene({ backgroundRun: true }, false)
export const backgroundRunOnlySelected = scene({ backgroundRun: true }, true)
export const workerAndChatSelected = scene({ worker: true, waitingChat: true }, true)
