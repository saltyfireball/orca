// Card routing (BAD-737, FORK.md): which bot owns a card nothing labels or maps, from the repos its
// text names against each bot's claimed repos. A repo name beats a file path; one bot is the owner,
// none or several leave the choice to the default chain.
import { CARD_CLAIM_PATHS_MAX, type CardBotClaims } from './card-routing'

/** What inference reads from a card. */
export type CardText = {
  title: string
  description: string | null
  project: string | null
  labels: readonly string[]
}

export type CardOwnerGuess = { name: string; repo: string }

const MIN_REPO_NAME = 3
const PATH = /(?:^|[\s`'"([])((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),:;\]])/g

function cardWords(card: CardText): string {
  return [card.title, card.description ?? '', card.project ?? '', ...card.labels].join('\n')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namesRepo(text: string, repo: string): boolean {
  if (repo.length < MIN_REPO_NAME) {
    return false
  }
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(repo)}(?![\\p{L}\\p{N}_-])`, 'iu').test(text)
}

/** Relative file paths the card names (src/a/b.ts), for the hosts to look for in each claimed repo. */
export function cardClaimPaths(card: CardText): string[] {
  const found = new Set<string>()
  for (const match of cardWords(card).matchAll(PATH)) {
    const path = match[1]!.replace(/^\.\//, '')
    if (!path.split('/').some((part) => part === '..' || part === '.')) {
      found.add(path)
    }
    if (found.size >= CARD_CLAIM_PATHS_MAX) {
      break
    }
  }
  return [...found]
}

/** The bots whose repos the card names; by file path only when no repo name matches any bot. */
export function inferCardOwners(
  card: CardText,
  claims: readonly CardBotClaims[]
): CardOwnerGuess[] {
  const text = cardWords(card)
  const seen = new Set<string>()
  const unique = (guesses: CardOwnerGuess[]): CardOwnerGuess[] =>
    guesses.filter((guess) => {
      const key = guess.name.toLowerCase()
      return seen.has(key) ? false : (seen.add(key), true)
    })
  const named = unique(
    claims.flatMap((bot) => {
      const repo = bot.repos.find((name) => namesRepo(text, name))
      return repo ? [{ name: bot.name, repo }] : []
    })
  )
  if (named.length > 0) {
    return named
  }
  return unique(
    claims.flatMap((bot) => (bot.pathRepos[0] ? [{ name: bot.name, repo: bot.pathRepos[0] }] : []))
  )
}
