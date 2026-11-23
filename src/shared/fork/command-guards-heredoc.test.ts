// BAD-785: heredoc bodies are data unless the reader may run them; literal variables are followed.
import { describe, expect, it } from 'vitest'
import { evaluateCommandGuard, type CommandGuardContext } from './command-guards-rules'

const ctx: CommandGuardContext = {
  workspaceRoot: '/work/repo-a',
  home: '/home/dev',
  deleteRoots: ['/tmp', '/private/tmp'],
  protectedBranches: [],
  gitState: () => ({ current: 'feature/x', defaultBranch: 'main' }),
  off: new Set()
}

function verdict(command: string): string {
  const result = evaluateCommandGuard(command, ctx)
  return result.allowed ? 'allow' : result.rule
}

const doc = (...lines: string[]): string => lines.join('\n')

const ALLOWED: Record<string, string> = {
  'python stdin with quotes': doc("python3 - <<'EOF'", `print("it's")`, "x = '`rm -rf /`'", 'EOF'),
  'cat to file with ticks': doc("cat > notes.md <<'EOF'", 'Don\'t "quote" `tick` rm -rf /', 'EOF'),
  'git commit -F -': doc(
    "git commit -F - <<'EOF'",
    "fix: handle user's input",
    '',
    'rm -rf docs',
    'EOF'
  ),
  'node stdin unquoted': doc('node - <<EOF', "console.log('hi')", 'EOF'),
  'jq heredoc': doc("jq . <<'EOF'", `{"a":"it's"}`, 'EOF'),
  'dash form strips tabs': "cat <<-'EOF'\n\tit's\n\tEOF\n",
  'two heredocs on one line': doc('cat <<A <<B > out', "it's", 'A', 'rm "', 'B'),
  'heredoc inside a substitution': doc("msg=$(cat <<'EOF'", "it's", 'EOF', ')', 'echo "$msg"'),
  'here-string to grep': `grep foo <<< "it's rm"`,
  CRLF: "cat <<'EOF'\r\nit's\r\nEOF\r\n",
  'tee heredoc': doc("tee out.txt <<'EOF'", "it's", 'EOF'),
  'sql heredoc': doc('psql <<SQL', "select 'x';", 'SQL'),
  'build cleanup': 'rm -rf build/ dist/ ./node_modules',
  'for loop': 'for f in *.ts; do echo "$f"; done',
  'if block': doc('if [ -f x ]; then', `  echo "a's"`, 'fi'),
  subshell: '(cd sub && ls)',
  'find print': "find . -name '*.log' -print",
  'git read': 'git status && git diff --stat | head',
  'multi-line script': doc('set -e', 'for d in a b; do', '  mkdir -p "$d"', 'done'),
  'literal variable': 'S=/tmp/x; rm -rf $S/sub',
  'literal variable braces': doc('S=/tmp/x', 'rm -rf "${S}/sub"'),
  'last assignment wins': 'S=/etc; S=/tmp/b; rm -rf $S',
  'relative variable': 'D=build; rm -rf $D/out',
  'unquoted body with date': doc('cat <<EOF', 'value: $(date)', 'EOF'),
  'script file is written, not run': doc("cat > f.sh <<'EOF'", '#!/bin/sh', 'rm -rf /', 'EOF'),
  'quote in a pipe': `echo "it's" | wc -c`,
  grep: 'grep -rn "foo" src | sort | uniq -c',
  'git log': 'git log --oneline -5',
  tests: 'npm test -- --run 2>&1 | tail -20',
  'heredoc piped to python': doc("cat <<'EOF' | python3 -", "print('x')", 'EOF'),
  sed: "sed -i 's/a/b/' file.txt",
  curl: "curl -s https://example.com/api | jq '.items[] | .name'",
  'push feature': 'git push origin feature/x',
  'delimiter word inside the body': doc("cat <<'EOF'", 'EOF is not the end', 'EOF2', 'EOF'),
  'risky word only in a body next to an unreadable part': doc(
    "cat <<'EOF'",
    'rm -rf "x',
    'EOF',
    'echo "closed"'
  ),
  'arithmetic shift': 'echo $((1<<2)); ls',
  'function with heredoc data': doc('f() {', "  cat <<'EOF'", "it's", 'EOF', '}', 'f')
}

const ALLOWED_VARIABLE_COMMANDS: Record<string, string> = {
  'variable cli with prose': doc(
    '"$O" orchestration send --body-file - <<\'EOF\'',
    "it's done",
    'EOF'
  ),
  'variable cli with default': doc(
    '"${ORCA_CLI_COMMAND:-orca}" orchestration send --body-file - <<\'EOF\'',
    "it's `done`",
    'EOF'
  ),
  'variable name that only starts like a shell': doc("$SHELLCHECK_BIN <<'EOF'", "it's", 'EOF'),
  'unknown variable after a pipe': doc("cat <<'EOF' | $FILTER", "it's", 'EOF')
}

const SHELL_VARIABLES = ['$SHELL', '"$SHELL"', '${SHELL}', '$BASH', '"${SHELL:-sh}"', '$0']

const DENIED: Record<string, [string, string]> = {
  root: ['rm -rf /', 'delete-outside-workspace'],
  force: ['git push --force origin main', 'force-push'],
  'short force': ['git push -f', 'force-push'],
  'unknown variable': ['rm -rf $UNKNOWN/x', 'delete-outside-workspace'],
  'bash heredoc': [doc("bash <<'EOF'", 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'sh heredoc': [doc('sh <<EOF', 'git push --force', 'EOF'), 'force-push'],
  'cat pipe bash': [doc("cat <<'EOF' | bash", 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'cat pipe sudo bash -s': [
    doc("cat <<'EOF' | sudo bash -s", 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'cat pipe tee pipe sh': [
    doc("cat <<'EOF' | tee x | sh", 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'bash -c of a cat heredoc': [
    doc(`bash -c "$(cat <<'EOF'`, 'rm -rf /', 'EOF', ')"'),
    'delete-outside-workspace'
  ],
  'eval of a cat heredoc': [
    doc(`eval "$(cat <<'EOF'`, 'rm -rf /', 'EOF', ')"'),
    'delete-outside-workspace'
  ],
  'ssh bash -s': [doc("ssh host 'bash -s' <<'EOF'", 'git push --force', 'EOF'), 'force-push'],
  'ssh login shell': [doc('ssh host <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'env bash': [doc('env A=1 bash <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'nohup bash': [doc('nohup bash <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'timeout bash': [doc('timeout 5 bash <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'xargs sh': [doc('xargs -I{} sh -c {} <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'docker exec bash': [
    doc('docker exec -i c bash <<EOF', 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'here-string to bash': ['bash <<< "rm -rf /"', 'delete-outside-workspace'],
  'here-string to zsh': ["zsh <<< 'git push --force'", 'force-push'],
  'dash heredoc': [doc('dash <<EOF', 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  'bash -s heredoc': [doc("bash -s <<'EOF'", 'rm -rf /', 'EOF'), 'delete-outside-workspace'],
  unterminated: [doc("cat <<'EOF'", 'rm -rf /'), 'delete-outside-workspace'],
  'unquoted substitution': [doc('cat <<EOF', '$(rm -rf /)', 'EOF'), 'delete-outside-workspace'],
  'unquoted backticks': [doc('cat <<EOF', '`rm -rf /`', 'EOF'), 'delete-outside-workspace'],
  'process substitution': [
    doc(`bash <(cat <<'EOF'`, 'rm -rf /', 'EOF', ')'),
    'delete-outside-workspace'
  ],
  'function runs a shell': [
    doc('f() { bash; }', "f <<'EOF'", 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'loop reads the body': [
    doc('while read l; do eval "$l"; done <<\'EOF\'', 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'pipe into a loop': [
    doc('cat <<\'EOF\' | while read l; do sh -c "$l"; done', 'rm -rf /', 'EOF'),
    'delete-outside-workspace'
  ],
  'command after arithmetic shift': [doc('echo $((1<<2))', 'rm -rf /'), 'delete-outside-workspace'],
  'command after a brace expansion shift': [
    doc('echo ${x:-<<EOF}', 'rm -rf /', 'EOF}'),
    'delete-outside-workspace'
  ],
  'trailing spaces are not the end': [
    doc("cat <<'EOF'", 'x', 'EOF  ', 'EOF', 'rm -rf /'),
    'delete-outside-workspace'
  ],
  'delimiter word in the body': [
    doc("cat <<'EOF'", 'this EOF word', 'EOF', 'rm -rf /'),
    'delete-outside-workspace'
  ],
  'last assignment wins': ['S=/tmp/x; S=/; rm -rf $S', 'delete-outside-workspace'],
  'conditional assignment': [
    'S=/tmp/x; [ -n "$A" ] && S=/etc; rm -rf $S',
    'delete-outside-workspace'
  ],
  'assignment in a branch': [
    doc('S=/tmp/x', 'if c; then S=/; fi', 'rm -rf $S'),
    'delete-outside-workspace'
  ],
  'loop variable': ['S=/tmp/x; for S in /; do rm -rf $S; done', 'delete-outside-workspace'],
  'eval sets it': ["S=/tmp/x; eval 'S=/'; rm -rf $S", 'delete-outside-workspace'],
  'append assignment': ['S=/tmp/x; S+=/../..; rm -rf $S', 'delete-outside-workspace'],
  'computed value': ['S=$(pwd)/..; rm -rf $S', 'delete-outside-workspace'],
  'value with a space': ['S="/tmp/a /etc"; rm -rf $S', 'delete-outside-workspace'],
  'subshell assignment': ['S=/tmp/x; (S=/; true); rm -rf $S', 'delete-outside-workspace'],
  'unreadable with rm': ['echo "oops; rm -rf /x', 'unreadable-command'],
  'unreadable with git': ['git commit -m "it\'s" ; echo \'a', 'unreadable-command'],
  'unreadable in a shell body': [doc("bash <<'EOF'", 'rm -rf "x', 'EOF'), 'unreadable-command'],
  'unreadable after a heredoc': [
    doc("cat <<'EOF'", 'text', 'EOF', 'rm -rf "x'),
    'unreadable-command'
  ],
  'nested too deep': ['eval eval eval eval eval eval eval rm -rf x', 'unreadable-command']
}

describe('shells named by a variable (BAD-785)', () => {
  for (const [name, command] of Object.entries(ALLOWED_VARIABLE_COMMANDS)) {
    it(`allows: ${name}`, () => {
      expect(verdict(command)).toBe('allow')
    })
  }

  for (const shell of SHELL_VARIABLES) {
    it(`denies ${shell} reading a heredoc, alone and after a pipe`, () => {
      expect(verdict(doc(`${shell} <<'EOF'`, 'rm -rf /work/repo-b', 'EOF'))).toBe(
        'delete-outside-workspace'
      )
      expect(verdict(doc(`cat <<'EOF' | ${shell}`, 'rm -rf /work/repo-b', 'EOF'))).toBe(
        'delete-outside-workspace'
      )
    })
  }

  it('denies a variable holding a literal shell name', () => {
    expect(verdict(doc("B=bash; $B <<'EOF'", 'rm -rf /work/repo-b', 'EOF'))).toBe(
      'delete-outside-workspace'
    )
    expect(verdict(doc('B=bash', 'cat <<\'EOF\' | "$B" -s', 'rm -rf /work/repo-b', 'EOF'))).toBe(
      'delete-outside-workspace'
    )
  })
})

describe('heredoc bodies and literal variables (BAD-785)', () => {
  it('has the required table sizes', () => {
    expect(Object.keys(ALLOWED).length).toBeGreaterThanOrEqual(30)
    expect(Object.keys(DENIED).length).toBeGreaterThanOrEqual(30)
  })

  for (const [name, command] of Object.entries(ALLOWED)) {
    it(`allows: ${name}`, () => {
      expect(verdict(command)).toBe('allow')
    })
  }

  for (const [name, [command, rule]] of Object.entries(DENIED)) {
    it(`denies: ${name}`, () => {
      expect(verdict(command)).toBe(rule)
    })
  }

  it('says what could not be read', () => {
    const result = evaluateCommandGuard('echo "oops; rm -rf /x', ctx)
    expect(result).toMatchObject({ allowed: false, rule: 'unreadable-command' })
    expect(JSON.stringify(result)).toContain('a quote is never closed')
    expect(JSON.stringify(result)).toContain('oops; rm -rf /x')
    expect(JSON.stringify(result)).toContain('(rm)')
  })
})
