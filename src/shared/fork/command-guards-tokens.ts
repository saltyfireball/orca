// Command guards (FORK.md, BAD-686, BAD-785): the tokenizer under command-guards-shell.ts. It splits
// shell text into segments of words and lifts heredocs and here-strings out of the word stream, so a
// heredoc body is never tokenized as if it were shell: the reader decides what the body is.

export type HereDoc = {
  kind: 'heredoc' | 'herestring'
  body: string
  /** A quoted delimiter: the body has no expansions. Here-strings count as unquoted. */
  quoted: boolean
  /** No closing delimiter: the shell takes the rest of the text as the body. */
  unterminated: boolean
  /** Where the body sits in the input (empty for here-strings). */
  range: [number, number]
}

export type Segment = {
  words: string[]
  docs: HereDoc[]
  /** What ended the segment: one of ; & | ( ) ` newline, doubled for && and ||, or '' at the end. */
  end: string
  /** Inside a `<(...)` or `>(...)` process substitution. */
  proc: boolean
}

export type Tokens = {
  segments: Segment[]
  /** Where an unbalanced quote opened, or -1. */
  unclosedAt: number
  /** Index ranges of heredoc bodies in the input. */
  bodies: [number, number][]
  /** A `<<` with no delimiter word. */
  badHeredoc: boolean
}

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`'])
const DELIMITER_END = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>'])

type Pending = { doc: HereDoc; delimiter: string; strip: boolean }

/** Reads the heredoc delimiter word at `from`: its text, whether it was quoted, and where it ends. */
function readDelimiter(
  input: string,
  from: number
): { text: string; quoted: boolean; next: number } {
  let i = from
  let text = ''
  let quoted = false
  while (i < input.length && !DELIMITER_END.has(input[i])) {
    const c = input[i]
    if (c === "'" || c === '"') {
      quoted = true
      const close = input.indexOf(c, i + 1)
      const stop = close === -1 ? input.length : close
      text += input.slice(i + 1, stop)
      i = stop + 1
    } else if (c === '\\' && i + 1 < input.length) {
      quoted = true
      text += input[i + 1]
      i += 2
    } else {
      text += c
      i += 1
    }
  }
  return { text, quoted, next: i }
}

/** Fills the pending bodies from the lines after `lineEnd` (the newline index); returns the last index used. */
function readBodies(
  input: string,
  lineEnd: number,
  pending: Pending[],
  bodies: [number, number][]
): number {
  let at = lineEnd + 1
  for (const { doc, delimiter, strip } of pending) {
    const start = at
    const lines: string[] = []
    let found = false
    while (at <= input.length && !found) {
      if (at === input.length) {
        break
      }
      const nl = input.indexOf('\n', at)
      const stop = nl === -1 ? input.length : nl
      const line = input.slice(at, stop)
      const compare = (strip ? line.replace(/^\t+/, '') : line).replace(/\r$/, '')
      at = nl === -1 ? input.length : nl + 1
      if (compare === delimiter) {
        found = true
      } else {
        lines.push(line)
      }
    }
    doc.body = lines.join('\n')
    doc.unterminated = !found
    doc.range = [start, at]
    bodies.push([start, at])
  }
  return at - 1
}

export function tokenize(input: string): Tokens {
  const segments: Segment[] = []
  const bodies: [number, number][] = []
  let words: string[] = []
  let docs: HereDoc[] = []
  let pending: Pending[] = []
  let word = ''
  let inWord = false
  let single = false
  let double = false
  let quoteAt = -1
  let hereString = false
  let badHeredoc = false
  let arith = 0
  let param = 0
  let proc = 0
  const endWord = (): void => {
    if (inWord) {
      if (hereString) {
        docs.push({
          kind: 'herestring',
          body: word,
          quoted: false,
          unterminated: false,
          range: [0, 0]
        })
        hereString = false
      } else {
        words.push(word)
      }
    }
    word = ''
    inWord = false
  }
  const endSegment = (end: string): void => {
    endWord()
    if (words.length > 0 || docs.length > 0) {
      segments.push({ words, docs, end, proc: proc > 0 })
    } else if (end === '|' || end === '|&') {
      const last = segments.at(-1)
      if (last && last.end !== '|') {
        last.end = '|'
      }
    }
    words = []
    docs = []
  }
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i]
    if (single) {
      single = c !== "'"
      word += single ? c : ''
    } else if (double) {
      if (c === '"') {
        double = false
      } else if (c === '\\' && i + 1 < input.length) {
        i += 1
        word += input[i]
      } else {
        word += c
      }
    } else if (c === '\\' && i + 1 < input.length) {
      i += 1
      if (input[i] !== '\n') {
        word += input[i]
        inWord = true
      }
    } else if (c === "'") {
      single = true
      inWord = true
      quoteAt = i
    } else if (c === '"') {
      double = true
      inWord = true
      quoteAt = i
    } else if (c === '#' && !inWord) {
      while (i + 1 < input.length && input[i + 1] !== '\n') {
        i += 1
      }
    } else if (c === '$' && input[i + 1] === '{') {
      param += 1
      word += '${'
      inWord = true
      i += 1
    } else if (c === '}' && param > 0) {
      param -= 1
      word += c
      inWord = true
    } else if (c === '<' && arith === 0 && param === 0 && input.startsWith('<<<', i)) {
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      }
      endWord()
      hereString = true
      i += 2
    } else if (c === '<' && arith === 0 && param === 0 && input.startsWith('<<', i)) {
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      }
      endWord()
      const strip = input[i + 2] === '-'
      let at = i + (strip ? 3 : 2)
      while (input[at] === ' ' || input[at] === '\t') {
        at += 1
      }
      const delimiter = readDelimiter(input, at)
      if (delimiter.text === '') {
        badHeredoc = true
        i += 1
      } else {
        const doc: HereDoc = {
          kind: 'heredoc',
          body: '',
          quoted: delimiter.quoted,
          unterminated: false,
          range: [0, 0]
        }
        docs.push(doc)
        pending.push({ doc, delimiter: delimiter.text, strip })
        i = delimiter.next - 1
      }
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (SEPARATORS.has(c)) {
      const doubled = (c === '&' || c === '|') && input[i + 1] === c
      const piped = c === '|' && !doubled
      endSegment(doubled ? c + c : piped && input[i + 1] === '&' ? '|' : c)
      if (doubled || (piped && input[i + 1] === '&')) {
        i += 1
      }
      if (c === '(') {
        if (arith > 0 || input[i - 1] === '(') {
          arith += arith > 0 ? 1 : 2
        }
        if (proc > 0 || input[i - 1] === '<' || input[i - 1] === '>') {
          proc += 1
        }
      } else if (c === ')') {
        arith = Math.max(0, arith - 1)
        proc = Math.max(0, proc - 1)
      } else if (c === '\n' && pending.length > 0) {
        i = readBodies(input, i, pending, bodies)
        pending = []
      }
    } else {
      word += c
      inWord = true
    }
  }
  endSegment('')
  return {
    segments,
    unclosedAt: single || double ? quoteAt : -1,
    bodies,
    badHeredoc
  }
}
