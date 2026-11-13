// SLRM-2097: the custom app theme in use, as the paint `useDocumentAppearance` already applies to
// plugin themes (same contrast checks, same startup cache), plus its radius and UI font.
import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { buildAppFontFamily } from '@/app-shell/appearance/app-font-family'
import type { AppThemePaint } from '@/app-shell/appearance/document-theme'
import { useAppStore } from '@/store'
import {
  activeCustomAppTheme,
  customAppThemePaint
} from '../../../../shared/fork/custom-app-theme/custom-app-theme-settings'

function useActiveCustomAppTheme(dark: boolean) {
  // Why only these fields: unrelated settings writes must not re-derive and repaint the theme.
  const inputs = useAppStore(
    useShallow((s) => ({
      forkCustomAppThemes: s.settings?.forkCustomAppThemes,
      forkCustomAppThemeDark: s.settings?.forkCustomAppThemeDark,
      forkCustomAppThemeLight: s.settings?.forkCustomAppThemeLight
    }))
  )
  return useMemo(() => activeCustomAppTheme(inputs, dark), [inputs, dark])
}

/** The paint of the custom theme selected for this mode; null keeps the stock choice. */
export function useForkCustomAppTheme(dark: boolean): AppThemePaint | null {
  const theme = useActiveCustomAppTheme(dark)
  return useMemo(() => (theme ? customAppThemePaint(theme) : null), [theme])
}

/** Applies the theme's radius and UI font. Call after the stock font effect, so it wins. */
export function useForkCustomAppThemeExtras(
  dark: boolean,
  appFontFamily: string | undefined
): void {
  const theme = useActiveCustomAppTheme(dark)
  const radius = theme?.radius
  const font = theme?.font
  useEffect(() => {
    const root = document.documentElement.style
    if (radius) {
      root.setProperty('--radius', radius)
    } else {
      root.removeProperty('--radius')
    }
  }, [radius])
  useEffect(() => {
    if (font) {
      document.documentElement.style.setProperty('--app-font-family', buildAppFontFamily(font))
      return () => {
        document.documentElement.style.setProperty(
          '--app-font-family',
          buildAppFontFamily(useAppStore.getState().settings?.appFontFamily)
        )
      }
    }
    return undefined
  }, [font, appFontFamily])
}
