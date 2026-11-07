import { describe, expect, it } from 'vitest'
import {
  commandFromShellFence,
  hasUnsafeShellCharacters,
  isRunnableShellFence
} from './shell-fence'

const char = (codePoint: number): string => String.fromCodePoint(codePoint)

describe('isRunnableShellFence', () => {
  it('accepts shell languages regardless of case and padding', () => {
    expect(isRunnableShellFence('sh')).toBe(true)
    expect(isRunnableShellFence('bash')).toBe(true)
    expect(isRunnableShellFence(' ZSH ')).toBe(true)
    expect(isRunnableShellFence('Shell')).toBe(true)
    expect(isRunnableShellFence('console')).toBe(true)
  })

  it('rejects other or missing languages', () => {
    expect(isRunnableShellFence('ts')).toBe(false)
    expect(isRunnableShellFence('powershell')).toBe(false)
    expect(isRunnableShellFence('')).toBe(false)
    expect(isRunnableShellFence(undefined)).toBe(false)
    expect(isRunnableShellFence(null)).toBe(false)
  })
})

describe('hasUnsafeShellCharacters', () => {
  it('allows plain text with LF, TAB and CRLF', () => {
    expect(hasUnsafeShellCharacters('echo "a\tb"\r\nls\n')).toBe(false)
  })

  it.each([
    ['NUL', 0x00],
    ['BEL', 0x07],
    ['BS', 0x08],
    ['VT', 0x0b],
    ['FF', 0x0c],
    ['ESC', 0x1b],
    ['US', 0x1f],
    ['DEL', 0x7f],
    ['C1 start', 0x80],
    ['CSI', 0x9b],
    ['C1 end', 0x9f],
    ['soft hyphen', 0xad],
    ['arabic letter mark', 0x61c],
    ['zero width space', 0x200b],
    ['zero width joiner', 0x200d],
    ['LRM', 0x200e],
    ['RLM', 0x200f],
    ['LRE', 0x202a],
    ['RLO', 0x202e],
    ['word joiner', 0x2060],
    ['LRI', 0x2066],
    ['PDI', 0x2069],
    ['BOM', 0xfeff]
  ])('rejects %s', (_name, codePoint) => {
    expect(hasUnsafeShellCharacters(`echo a${char(codePoint)}b`)).toBe(true)
  })

  it('rejects a bare CR', () => {
    expect(hasUnsafeShellCharacters('echo safe\rrm -rf ~')).toBe(true)
  })
})

describe('commandFromShellFence', () => {
  it('returns a single line unchanged without its trailing newline', () => {
    expect(commandFromShellFence('ls -la\r\n\r\n', 'sh')).toBe('ls -la')
    expect(commandFromShellFence('echo hi # note\n', 'bash')).toBe('echo hi # note')
  })

  it('joins independent lines with the same separator quick commands run', () => {
    expect(commandFromShellFence('git status\n  git log -1\n', 'bash')).toBe(
      'git status; git log -1'
    )
  })

  it('drops whole-line comments and blank lines', () => {
    expect(commandFromShellFence('# list\nls\n\n# then\npwd\n', 'sh')).toBe('ls; pwd')
  })

  it('joins backslash-newline continuations before flattening', () => {
    expect(commandFromShellFence('docker run \\\n  --rm \\\n  alpine\n', 'bash')).toBe(
      'docker run   --rm   alpine'
    )
    expect(commandFromShellFence('echo "a \\\nb"\nls\n', 'bash')).toBe('echo "a b"; ls')
  })

  it('hides a continuation inside single quotes, where the shell keeps it literally', () => {
    expect(commandFromShellFence("echo 'a \\\nb'\n", 'bash')).toBeNull()
  })

  it('hides a dangling trailing backslash', () => {
    expect(commandFromShellFence('echo hi \\', 'bash')).toBeNull()
    expect(commandFromShellFence('$ echo hi \\\n> there\n', 'console')).toBeNull()
  })

  it('keeps only prompt lines of a console fence, without the prompt', () => {
    expect(commandFromShellFence('$ echo hi\nhi\n$ pwd\n/home/me\n# comment\n', 'console')).toBe(
      'echo hi; pwd'
    )
  })

  it('hides heredocs but keeps here-strings', () => {
    expect(commandFromShellFence("cat <<'EOF'\nhello\nEOF\n", 'bash')).toBeNull()
    expect(commandFromShellFence('cat <<-EOF\n\thello\n\tEOF\n', 'bash')).toBeNull()
    expect(commandFromShellFence('cat<<EOF\nx\nEOF', 'sh')).toBeNull()
    expect(commandFromShellFence('grep x <<< "$y"\n', 'bash')).toBe('grep x <<< "$y"')
  })

  it.each([
    ['inline comment', 'echo a # note\necho b\n'],
    ['trailing pipe', 'ls |\nwc -l\n'],
    ['leading pipe', 'ls\n| wc -l\n'],
    ['trailing and', 'make &&\nmake install\n'],
    ['leading or', 'make\n|| echo failed\n'],
    ['trailing semicolon', 'cd /tmp;\nls\n'],
    ['trailing background', 'sleep 5 &\nwait\n'],
    ['if block', 'if true\nthen echo y\nfi\n'],
    ['for loop', 'for f in a b\ndo echo $f\ndone\n'],
    ['loop header ending in do', 'while true; do\necho x\ndone\n'],
    ['case', 'case $x in\na) echo a ;;\nesac\n'],
    ['function body', 'greet() {\necho hi\n}\n'],
    ['subshell across lines', '(\ncd /tmp\nls)\n'],
    ['open single quote', "echo 'a\nb'\n"],
    ['open double quote', 'echo "a\nb"\n'],
    ['open backtick', 'echo `ls\npwd`\n']
  ])('hides a multi-line fence with %s', (_name, code) => {
    expect(commandFromShellFence(code, 'bash')).toBeNull()
  })

  it('hides fences with unsafe characters', () => {
    expect(commandFromShellFence(`echo hi${char(0x1b)}[2J\n`, 'bash')).toBeNull()
    expect(commandFromShellFence(`echo ${char(0x202e)}cba\n`, 'bash')).toBeNull()
    expect(commandFromShellFence('echo safe\rrm -rf ~\n', 'bash')).toBeNull()
  })

  it('returns null when nothing is left to run', () => {
    expect(commandFromShellFence('output only\n', 'console')).toBeNull()
    expect(commandFromShellFence('  \n\n', 'bash')).toBeNull()
    expect(commandFromShellFence('# just a comment\n', 'bash')).toBeNull()
    expect(commandFromShellFence('echo hi', 'python')).toBeNull()
  })
})
