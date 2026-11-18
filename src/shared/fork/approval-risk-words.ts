// Approval triage (FORK.md, SLRM-2397): the word lists the shell grade reads. A program on no
// list is medium; adding one to SAFE_READERS makes it eligible for low, so keep that list to
// programs that cannot write, run another program or reach the network.

/** Programs that are high wherever they appear, even as an argument word. */
export const HIGH_PROGRAMS = new Set([
  'sudo',
  'su',
  'doas',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'agent-ssh',
  'nc',
  'ncat',
  'telnet',
  'kill',
  'pkill',
  'killall',
  'launchctl',
  'systemctl',
  'service',
  'shutdown',
  'reboot',
  'halt',
  'crontab',
  'osascript',
  'security',
  'dd',
  'mkfs',
  'diskutil',
  'chown',
  'chmod',
  'eval',
  'exec',
  'source',
  'xargs',
  'pm2',
  'tmux',
  'brew',
  'docker',
  'kubectl',
  'terraform',
  'shred',
  'truncate'
])

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh'])
export const INTERPRETERS = new Set([
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'php',
  'deno',
  'bun'
])

export const GIT_READ = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'describe',
  'shortlog',
  'grep',
  'cat-file',
  'ls-tree',
  'merge-base',
  'rev-list',
  'reflog'
])
export const GIT_BRANCH_READ_FLAGS = new Set([
  '-a',
  '-r',
  '-v',
  '-vv',
  '--all',
  '--remotes',
  '--list',
  '--show-current',
  '--verbose',
  '--no-color',
  '--merged',
  '--no-merged'
])
export const GH_READ = new Set(['view', 'list', 'status', 'diff', 'checks'])

/** Read-only programs whose words after the flags are files, except the ones listed as text. */
export const SAFE_READERS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'find',
  'fd',
  'pwd',
  'echo',
  'printf',
  'which',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'diff',
  'cmp',
  'sort',
  'uniq',
  'cut',
  'tr',
  'jq',
  'basename',
  'dirname',
  'realpath',
  'date',
  'true',
  'nl',
  'git'
])
/** The first word after the flags is a pattern, not a file. */
export const PATTERN_FIRST = new Set(['rg', 'grep', 'egrep', 'fgrep', 'jq'])
/** Every word is text. */
export const TEXT_ONLY = new Set([
  'echo',
  'printf',
  'which',
  'date',
  'true',
  'pwd',
  'basename',
  'dirname'
])

/** Per reader, the flags that make it write a file, run a program or read a command's output. */
export const UNSAFE_FLAGS: Record<string, RegExp> = {
  find: /^-(exec|execdir|ok|okdir|delete|fprint.*|fls)$/,
  fd: /^(-x|-X|--exec|--exec-batch)$/,
  rg: /^--pre(-glob)?$/,
  sort: /^(-o|--output|--compress-program)$/,
  git: /^(-O|--open-files-in-pager|--output|--ext-diff|--textconv|--exec)$/,
  diff: /^--(to|from)-file$/
}

export const NETWORK = /^(curl|wget|http|https|aria2c|ftp)$/
export const UPLOAD_FLAG =
  /^(-d|--data.*|-F|--form.*|-T|--upload-file|-X|--request|--post.*|-u|--user)$/
export const PACKAGE_MANAGERS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'pip',
  'pip3',
  'uv',
  'cargo',
  'go'
])

/** Git subcommands that change the repository, its config or reach a remote. */
export const GIT_WRITE =
  /^(push|commit|merge|rebase|reset|tag|cherry-pick|revert|clean|checkout|switch|restore|am|apply|filter-branch|filter-repo|update-ref|gc|prune|config|remote|worktree|submodule|stash|rm|mv|init|clone|fetch|pull)$/
