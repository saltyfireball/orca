// Quick task (SLRM-2428, FORK.md): the box window's own React root (quick-task.html). It shares
// the main preload, so dictation works as in the main window, and reads only the settings it needs.
import '../../assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyStartupAppTheme } from '../../app-shell/appearance/use-app-theme-paint'
import { I18nProvider } from '../../i18n/I18nProvider'
import type { GlobalSettings } from '../../../../shared/settings/global-settings-types'
import { QuickTaskBox } from './QuickTaskBox'

let settings: GlobalSettings | null = null
try {
  settings = window.api.settings.getSync()
} catch {
  // The box works without them: no dictation, the system theme.
}
applyStartupAppTheme(settings)

const root = document.getElementById('root')
const api = window.api.forkQuickTask
if (root && api) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <QuickTaskBox api={api} voice={settings?.voice} />
      </I18nProvider>
    </StrictMode>
  )
}
