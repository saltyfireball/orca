// The fork Settings pane's place on the Settings page: one call in settings-page-renderer.tsx.
// Desktop only, as the Advanced pane its settings used to sit in.
import { SettingsSection } from '@/components/settings/section-layout/SettingsSection'
import type { SettingsRenderContext } from '@/components/settings/page/settings-render-context'
import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import { ForkSettingsPane } from './ForkSettingsPane'
import {
  FORK_SETTINGS_PANE_ID,
  getForkSettingsPaneDescription,
  getForkSettingsPaneTitle
} from './fork-settings-pane-catalog'

export function renderForkSettingsSection(
  context: SettingsRenderContext,
  t: Translate = translate
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings ? (
    <SettingsSection
      id={FORK_SETTINGS_PANE_ID}
      title={getForkSettingsPaneTitle(t)}
      description={getForkSettingsPaneDescription(t)}
      searchEntries={navigation.getSectionSearchEntries(FORK_SETTINGS_PANE_ID)}
    >
      {view.isSectionMounted(FORK_SETTINGS_PANE_ID) ? (
        <ForkSettingsPane settings={model.settings} updateSettings={model.updateSettings} />
      ) : null}
    </SettingsSection>
  ) : null
}
