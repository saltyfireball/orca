// Review guides (SLRM-2396, FORK.md): written guides, one owner-only JSON file per pull request in
// fork-review-guides/ under userData, so a guide outlives a restart and every client of this host
// (the window, the phone, the CLI) reads the same one. The oldest files go past MAX_GUIDES.
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  forkReviewGuideKey,
  type ForkReviewGuide,
  type ForkReviewGuideRef
} from '../../../shared/fork/review-guide'
import { ForkReviewGuideSchema } from '../../../shared/fork/review-guide-wire'

export const FORK_REVIEW_GUIDE_DIR = 'fork-review-guides'
const MAX_GUIDES = 300

export class ForkReviewGuideStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly dir: string) {}

  private file(ref: ForkReviewGuideRef): string {
    const name = createHash('sha256').update(forkReviewGuideKey(ref)).digest('hex').slice(0, 32)
    return join(this.dir, `${name}.json`)
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  async read(ref: ForkReviewGuideRef): Promise<ForkReviewGuide | null> {
    let text: string
    try {
      text = await readFile(this.file(ref), 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = ForkReviewGuideSchema.safeParse(JSON.parse(text))
      // A file whose key does not match (a hash clash, an edited file) is not this guide.
      return parsed.success && forkReviewGuideKey(parsed.data) === forkReviewGuideKey(ref)
        ? parsed.data
        : null
    } catch {
      return null
    }
  }

  save(guide: ForkReviewGuide): Promise<void> {
    return this.run(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      const target = this.file(guide)
      const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(temp, JSON.stringify(guide), { mode: 0o600 })
      try {
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      await this.prune()
    })
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.dir)).filter((name) => name.endsWith('.json'))
    if (names.length <= MAX_GUIDES) {
      return
    }
    const dated = await Promise.all(
      names.map(async (name) => {
        const path = join(this.dir, name)
        return { path, at: (await stat(path).catch(() => null))?.mtimeMs ?? 0 }
      })
    )
    dated.sort((a, b) => a.at - b.at)
    await Promise.all(
      dated.slice(0, names.length - MAX_GUIDES).map(({ path }) => rm(path, { force: true }))
    )
  }
}
