// Quick task (SLRM-2428, FORK.md): the Feed header's Quick task button. It asks which computer
// when several are connected (as Tasks does), then opens the sheet on that one. Settings >
// Appearance hides it.
import { ListPlus } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { useConnectedHostPicker } from '../../../host-catalog/selection/use-connected-host-picker'
import type { HostProfile } from '../../../host-catalog/host-profile'
import { useHostClient } from '../../../transport/connection/host-client-hooks'
import { PickerModal } from '../../sheets/PickerModal'
import { MobileHomeTabHeaderButton } from '../../../home/tabs/MobileHomeTabHeader'
import { MobileQuickTaskSheet } from './MobileQuickTaskSheet'
import { useQuickTaskSettings } from './quick-task-settings'

export function MobileQuickTaskButton(props: {
  connectedHosts: HostProfile[]
}): React.JSX.Element | null {
  const t = useMobileTranslation()
  const settings = useQuickTaskSettings()
  const hostPicker = useConnectedHostPicker(props.connectedHosts)
  const [hostId, setHostId] = useState<string | null>(null)
  const { client } = useHostClient(hostId ?? undefined)
  const host = props.connectedHosts.find((entry) => entry.id === hostId) ?? null
  const close = useCallback(() => setHostId(null), [])

  if (!settings.showEntry) {
    return null
  }
  return (
    <>
      <MobileHomeTabHeaderButton
        icon={ListPlus}
        disabled={props.connectedHosts.length === 0}
        active={hostId !== null}
        accessibilityLabel={t('fork.quickTask.open', 'Quick task')}
        onPress={() => hostPicker.pickHost(setHostId)}
      />
      <PickerModal
        title={t('fork.quickTask.hostPickerTitle', 'Send Quick Task To')}
        {...hostPicker.pickerProps}
      />
      <MobileQuickTaskSheet
        visible={hostId !== null}
        hostName={host?.name ?? null}
        client={client}
        onClose={close}
      />
    </>
  )
}
