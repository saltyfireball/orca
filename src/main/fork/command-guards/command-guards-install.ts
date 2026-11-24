// Command guards (FORK.md, BAD-764): the start on a host, from its profile store alone, in the desktop
// app and the headless server alike. The runtime settles seconds after the window has loaded (later
// on a slow start), and chats are restored, adopted and started before that. Keep electron out of
// this file.
import {
  installForkWorkspaceFolders,
  type ForkWorkspaceFolderStore
} from '../workspace-folder/workspace-folder-path'
import { startForkCommandGuards, type ForkCommandGuardsStore } from './command-guards-live'

export type ForkCommandGuardsHostStore = ForkCommandGuardsStore & ForkWorkspaceFolderStore

export function installForkCommandGuards(store: ForkCommandGuardsHostStore): void {
  // A folder workspace's terminal is guarded at its folder, so the lookup starts with the guards.
  installForkWorkspaceFolders({ requireStore: () => store })
  startForkCommandGuards({ requireStore: () => store })
}
