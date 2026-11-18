// Approval triage (FORK.md, SLRM-2397): the flags each read-only program may take and still be
// low. An allow-list, not a block-list: getopt takes abbreviations (`--compress-prog`) and
// bundles (`-ofile`), so any flag not named here exactly makes the command medium. A value taken
// by a listed flag is never checked as a path, so only flags whose value is never a file, a
// program or an output go in the valued lists. A flag whose value is optional (`--color`) is
// listed in both: bare, it takes nothing, so the next word is still read as a file. rg's glob
// flags are left out: `-g '*'` overrides the ignore rules and reads `.env`.

type FlagRule = {
  /** Short letters that take no value; they may be bundled (`-la`). */
  letters: string
  /** Short letters that take a value, attached (`-n5`) or next (`-n 5`). */
  valued?: string
  /** Whole flags that take no value (long ones, and `find`'s single dash primaries). */
  long?: readonly string[]
  /** Whole flags that take a value, `--x=v` or `--x v`. */
  longValued?: readonly string[]
  /** Every other word is text, never a file. */
  text?: true
  /** `-20` is a count. */
  numeric?: true
}

const COUNT = ['--lines', '--bytes']
const CONTEXT = ['--max-count', '--context', '--after-context', '--before-context', '--regexp']

export const READER_FLAGS: Record<string, FlagRule> = {
  ls: {
    letters: 'lahRtrS1dFGikmnopqsuxACTUcHgB',
    long: ['--all', '--almost-all', '--color', '--human-readable', '--recursive', '--directory'],
    longValued: ['--color', '--sort', '--time-style']
  },
  cat: { letters: 'nbsvetAETu' },
  head: { letters: 'qv', valued: 'nc', longValued: COUNT, numeric: true },
  tail: { letters: 'qvr', valued: 'nc', longValued: COUNT, numeric: true },
  wc: { letters: 'lwcmL', long: ['--lines', '--words', '--bytes', '--chars'] },
  rg: {
    letters: 'iwlcvFSsonHINxqUpP',
    valued: 'ABCmMtTej',
    long: [
      '--files',
      '--count',
      '--count-matches',
      '--no-heading',
      '--heading',
      '--line-number',
      '--no-line-number',
      '--ignore-case',
      '--smart-case',
      '--case-sensitive',
      '--fixed-strings',
      '--word-regexp',
      '--files-with-matches',
      '--files-without-match',
      '--invert-match',
      '--only-matching',
      '--with-filename',
      '--no-filename',
      '--json',
      '--vimgrep',
      '--multiline',
      '--column',
      '--trim',
      '--quiet',
      '--stats',
      '--color'
    ],
    longValued: [
      ...CONTEXT,
      '--color',
      '--type',
      '--type-not',
      '--sort',
      '--sortr',
      '--max-depth',
      '--max-columns',
      '--threads'
    ]
  },
  grep: {
    letters: 'inwlcvFEGHhoqsLxIb',
    valued: 'ABCme',
    long: [
      '--count',
      '--line-number',
      '--ignore-case',
      '--files-with-matches',
      '--invert-match',
      '--fixed-strings',
      '--extended-regexp',
      '--word-regexp',
      '--only-matching',
      '--quiet',
      '--with-filename',
      '--no-filename',
      '--color'
    ],
    longValued: [...CONTEXT, '--color']
  },
  find: {
    letters: 'HPEx',
    long: ['-print', '-print0', '-not', '-o', '-a', '-or', '-and', '-empty', '-prune', '-depth'],
    longValued: [
      '-name',
      '-iname',
      '-type',
      '-maxdepth',
      '-mindepth',
      '-path',
      '-ipath',
      '-size',
      '-mtime',
      '-mmin',
      '-perm',
      '-regex',
      '-iregex'
    ]
  },
  fd: {
    letters: 'HIiasF1gpuL0',
    valued: 'detEcj',
    long: ['--hidden', '--no-ignore', '--absolute-path', '--follow', '--glob', '--full-path'],
    longValued: ['--type', '--extension', '--max-depth', '--min-depth', '--exclude', '--color']
  },
  stat: {
    letters: 'Llnqrstx',
    valued: 'c',
    long: ['--terse', '--dereference'],
    longValued: ['--format', '--printf']
  },
  du: {
    letters: 'shcakxHLmA',
    valued: 'd',
    long: ['--summarize', '--human-readable', '--apparent-size', '--total'],
    longValued: ['--max-depth']
  },
  df: { letters: 'hHkiPlTam' },
  tree: { letters: 'adfipsughDFCnJQNrtv', valued: 'LIP', long: ['--noreport', '--dirsfirst'] },
  diff: {
    letters: 'uqyiwbBNtTapsc',
    valued: 'UC',
    long: ['--brief', '--unified', '--color', '--side-by-side', '--text', '--ignore-all-space'],
    longValued: ['--color', '--unified', '--context']
  },
  cmp: { letters: 'lsb' },
  sort: {
    letters: 'nrufbdghMVRsci',
    valued: 'ktS',
    long: [
      '--numeric-sort',
      '--reverse',
      '--unique',
      '--ignore-case',
      '--version-sort',
      '--stable'
    ],
    longValued: ['--key', '--field-separator']
  },
  uniq: { letters: 'cdiuD', valued: 'fs' },
  cut: { letters: 'sn', valued: 'bcdf', longValued: ['--delimiter', '--fields', '--characters'] },
  nl: { letters: 'p', valued: 'bdfhilnsvw' },
  file: { letters: 'bihkNn' },
  realpath: { letters: 'eqsmLPz' },
  tr: { letters: 'cdsC', text: true },
  echo: { letters: 'neE', text: true },
  printf: { letters: '', text: true },
  which: { letters: 'as', text: true },
  date: { letters: 'uR', text: true },
  pwd: { letters: 'LP', text: true },
  true: { letters: '', text: true },
  basename: { letters: 'az', valued: 's', text: true },
  dirname: { letters: 'z', text: true },
  git: {
    letters: 'abcpqsvwnuitlhrzCEFHIMRW',
    valued: 'nUSGABe',
    numeric: true,
    long: [
      '--oneline',
      '--stat',
      '--shortstat',
      '--numstat',
      '--name-only',
      '--name-status',
      '--graph',
      '--all',
      '--cached',
      '--staged',
      '--no-color',
      '--color',
      '--porcelain',
      '--short',
      '--branch',
      '--reverse',
      '--follow',
      '--first-parent',
      '--no-merges',
      '--merges',
      '--patch',
      '--no-patch',
      '--abbrev-commit',
      '--ignore-space-change',
      '--ignore-all-space',
      '--word-diff',
      '--decorate',
      '--summary',
      '--tags',
      '--always',
      '--long',
      '--exact-match',
      '--is-inside-work-tree',
      '--show-toplevel',
      '--abbrev-ref',
      '--verify',
      '--symbolic-full-name',
      '--count',
      '--left-right',
      '--list',
      '--merged',
      '--no-merged',
      '--remotes',
      '--verbose',
      '--quiet',
      '--show-current',
      '--untracked-files',
      '--others',
      '--modified',
      '--deleted',
      '--line-number',
      '--ignore-case',
      '--full-name'
    ],
    longValued: [
      '--format',
      '--pretty',
      '--since',
      '--until',
      '--after',
      '--before',
      '--author',
      '--committer',
      '--grep',
      '--max-count',
      '--color',
      '--abbrev',
      '--date',
      '--diff-filter',
      '--unified',
      '--stat',
      '--decorate',
      '--untracked-files'
    ]
  }
}

/** Flags whose value is the search pattern, so the first plain word is already a file. */
const PATTERN_FLAGS = new Set(['-e', '--regexp'])

export type ReadArgs = { files: string[]; patternGiven: boolean; text: boolean }

/** The plain words of a read-only program, or why a flag makes it not low. */
export function readArgs(name: string, args: string[]): ReadArgs | { bad: string } {
  const key = name === 'egrep' || name === 'fgrep' ? 'grep' : name
  const rule = Object.hasOwn(READER_FLAGS, key) ? READER_FLAGS[key] : undefined
  if (!rule) {
    return { bad: `${name} is not a known read` }
  }
  const files: string[] = []
  let patternGiven = false
  const bad = { bad: `${name} with a flag that is not a known read` }
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i]
    if (word === '--') {
      files.push(...args.slice(i + 1))
      break
    }
    if (!word.startsWith('-') || word === '-') {
      files.push(word)
      continue
    }
    if ((rule.numeric && /^-\d+$/.test(word)) || rule.long?.includes(word)) {
      continue
    }
    const eq = word.indexOf('=')
    const flag = eq === -1 ? word : word.slice(0, eq)
    if (rule.longValued?.includes(flag)) {
      i += eq === -1 ? 1 : 0
      patternGiven ||= PATTERN_FLAGS.has(flag)
      continue
    }
    if (word.startsWith('--')) {
      return bad
    }
    for (let at = 1; at < word.length; at += 1) {
      const letter = word[at]
      if (rule.valued?.includes(letter)) {
        // The rest of the word is the value; without one, the next word is.
        i += at === word.length - 1 ? 1 : 0
        patternGiven ||= letter === 'e'
        break
      }
      if (!rule.letters.includes(letter)) {
        return bad
      }
    }
  }
  return { files, patternGiven, text: rule.text === true }
}
