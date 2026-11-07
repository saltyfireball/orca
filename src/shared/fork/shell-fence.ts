// Fence languages whose body is a shell command a chat Run button may offer to run.
const RUNNABLE_SHELL_FENCE_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console'])

const CONSOLE_PROMPT = '$ '

function normalizeFenceLanguage(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase()
}

export function isRunnableShellFence(lang: string | null | undefined): boolean {
  return RUNNABLE_SHELL_FENCE_LANGUAGES.has(normalizeFenceLanguage(lang))
}

/** The command to run for a fence, or null when the fence is not runnable or has nothing to run. */
export function commandFromShellFence(
  code: string,
  lang: string | null | undefined
): string | null {
  if (!isRunnableShellFence(lang)) {
    return null
  }
  // console fences mix prompts with output: only `$ ` lines are commands.
  const command =
    normalizeFenceLanguage(lang) === 'console'
      ? code
          .split(/\r?\n/)
          .filter((line) => line.startsWith(CONSOLE_PROMPT))
          .map((line) => line.slice(CONSOLE_PROMPT.length))
          .join('\n')
      : code.replace(/(\r?\n)+$/, '')
  return command.trim() ? command : null
}
