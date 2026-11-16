// SLRM-2265 hardening: a remote or branch name from the source host's reply reaches `git worktree
// add` on the target, so a hostile or damaged source must not be able to smuggle an option or a
// odd ref through it. This is `git check-ref-format --branch` semantics, plus the stricter rules
// that no name may start with '-' or hold whitespace or control characters.

const MAX_REF_LENGTH = 255
// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f~^:?*[\\]/u

/** Whether `name` is safe to pass on as a branch or remote name. */
export function isSafeWorktreeMoveRef(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_REF_LENGTH) {
    return false
  }
  if (name.startsWith('-') || name === '@' || FORBIDDEN_CHARS.test(name)) {
    return false
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    return false
  }
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
    return false
  }
  return name
    .split('/')
    .every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
}

/** Control characters out of text that came from another host, before it is shown or logged. */
export function stripWorktreeMoveControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping them is the purpose
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/gu, '')
}
