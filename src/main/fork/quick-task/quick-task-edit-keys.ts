// Quick task (SLRM-2428, FORK.md): the box's own edit keys. On macOS the box is a non-activating
// panel, so Blackfish is not the active app and the Edit menu's Cmd+C/V/X/A/Z never reach it;
// the box handles those keys itself. Elsewhere Ctrl is the modifier, as the Edit menu uses.

export type QuickTaskEditCommand = 'copy' | 'paste' | 'cut' | 'selectAll' | 'undo' | 'redo'

type KeyInput = Pick<Electron.Input, 'type' | 'key' | 'meta' | 'control' | 'alt' | 'shift'>

/** The edit command a key press asks for, or null when it is not one. */
export function quickTaskEditCommand(
  input: KeyInput,
  platform: NodeJS.Platform = process.platform
): QuickTaskEditCommand | null {
  if (input.type !== 'keyDown' || input.alt) {
    return null
  }
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!mod) {
    return null
  }
  switch (input.key.toLowerCase()) {
    case 'c':
      return input.shift ? null : 'copy'
    case 'v':
      return input.shift ? null : 'paste'
    case 'x':
      return input.shift ? null : 'cut'
    case 'a':
      return input.shift ? null : 'selectAll'
    case 'z':
      return input.shift ? 'redo' : 'undo'
    case 'y':
      return platform === 'darwin' || input.shift ? null : 'redo'
    default:
      return null
  }
}

/** Runs the box's edit keys on its own page. */
export function installQuickTaskEditKeys(contents: Electron.WebContents): void {
  contents.on('before-input-event', (event, input) => {
    const command = quickTaskEditCommand(input)
    if (command) {
      event.preventDefault()
      contents[command]()
    }
  })
}
