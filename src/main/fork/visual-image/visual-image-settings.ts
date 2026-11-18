// Visual fallback (FORK.md, SLRM-2349): points the shared grammar and the visual reader at this
// host's settings store, in the desktop app and in a headless server alike. Read on every check,
// so a switch takes effect at once.
import {
  setForkVisualFallbackSettingsReader,
  type ForkVisualFallbackSettingsSource
} from '../../../shared/fork/visual-image-fallback'

function pick(value: unknown): ForkVisualFallbackSettingsSource {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  return {
    forkVisualFallback: 'forkVisualFallback' in value ? value.forkVisualFallback : undefined,
    forkVisualImageMaxMiB:
      'forkVisualImageMaxMiB' in value ? value.forkVisualImageMaxMiB : undefined
  }
}

export function installForkVisualFallbackSettings(store: { getSettings: () => unknown }): void {
  setForkVisualFallbackSettingsReader(() => pick(store.getSettings()))
}
