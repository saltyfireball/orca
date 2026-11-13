// SLRM-2138: what a chat-survive spawn needs on disk (the broker entry and a private socket
// folder), checked off the spawn path. The spawn hook is synchronous, so it reads the last
// answer; each read starts a fresh check for the next spawn. No answer yet spawns as today.
import { access } from 'node:fs/promises'
import { chatSurviveSocketDir } from './chat-survive-launch'

type Ready = { entryPath: string; socketDir: string | null }

let ready: Ready | null = null
let checking: Promise<void> | null = null

/** Checks the broker entry and the socket folder again; one check at a time. */
export function refreshChatSurviveLaunchReady(
  entryPath: string,
  socketDir: () => Promise<string | null> = chatSurviveSocketDir
): Promise<void> {
  checking ??= (async () => {
    try {
      const [entry, dir] = await Promise.all([
        access(entryPath).then(
          () => true,
          () => false
        ),
        socketDir()
      ])
      ready = { entryPath, socketDir: entry ? dir : null }
    } catch {
      ready = { entryPath, socketDir: null }
    } finally {
      checking = null
    }
  })()
  return checking
}

/**
 * The private socket folder when the broker entry and the folder were there at the last check,
 * else null. Starts the next check, so a folder the system cleaned up is made again.
 */
export function chatSurviveReadySocketDir(entryPath: string): string | null {
  const dir = ready?.entryPath === entryPath ? ready.socketDir : null
  void refreshChatSurviveLaunchReady(entryPath)
  return dir
}

export function resetChatSurviveLaunchReadyForTests(): void {
  ready = null
}
