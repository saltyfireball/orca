// Copies of a tool's saved values an older Orca mirrored into the owner's Claude config, for signing
// tools in; a relayed tool or a command tool never signs in, so its mirror entry only holds a secret.
import { existsSync } from 'node:fs'
import { claudeUnmirrorArgs, readClaudeMirror } from './bot-tools-claude'
import { readBotToolServers } from './bot-tools-file'
import { runBotToolsCli, type BotToolsCli } from './bot-tools-host'

// Fork (BAD-821): a command tool's env values count too; an older Orca mirrored those as well.
const carriesValues = (entry: unknown): boolean =>
  typeof entry === 'object' &&
  entry !== null &&
  (['headers', 'env'] as const).some((key) => {
    const values: unknown = key in entry ? Reflect.get(entry, key) : null
    return typeof values === 'object' && values !== null && Object.keys(values).length > 0
  })

/** Removes the bot's mirrored servers that hold header values; throws when Claude can't remove one. */
export async function scrubClaudeToolMirror(cli: BotToolsCli): Promise<void> {
  if (cli.agent !== 'claude' || !existsSync(cli.signInFolder)) {
    return
  }
  const relayed = new Set(
    (await readBotToolServers(cli.folder))
      .filter((server) => 'url' in server && server.credential)
      .map((server) => server.name)
  )
  const mirror = await readClaudeMirror(cli.accountHome, cli.signInFolder)
  for (const [name, entry] of Object.entries(mirror)) {
    if (!relayed.has(name) && !carriesValues(entry)) {
      continue
    }
    const removed = await runBotToolsCli(cli, claudeUnmirrorArgs(name), cli.signInFolder)
    if (removed.code !== 0) {
      throw new Error(`Claude Code couldn't remove its copy of ${name}.`)
    }
  }
}

/** Cleanups per bot and Claude account: each account keeps its own copy, so another account's
 *  cleanup says nothing about this one. A failed cleanup runs again on the next call. */
export class ClaudeMirrorScrubs {
  private readonly running = new Map<string, Promise<void>>()
  private readonly clean = new Set<string>()

  constructor(
    private readonly scrub: (cli: BotToolsCli) => Promise<void> = scrubClaudeToolMirror
  ) {}

  async ensure(cli: BotToolsCli): Promise<void> {
    const key = `${cli.botId}\0${cli.accountHome ?? ''}`
    if (this.clean.has(key)) {
      return
    }
    let work = this.running.get(key)
    if (!work) {
      work = this.scrub(cli)
        .then(() => {
          this.clean.add(key)
        })
        .finally(() => this.running.delete(key))
      this.running.set(key, work)
    }
    await work
  }
}
