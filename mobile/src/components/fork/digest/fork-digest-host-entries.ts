// Digest (SLRM-2388, FORK.md): the phone's host menu entry and stack screen for the digest, spread
// into the stock lists by one hook each, so the fork's strings stay in this fork folder.
import { Newspaper } from 'lucide-react-native'
import { translate } from '../../../i18n/mobile-i18n'

export const FORK_HOST_STACK_SCREENS = [
  {
    name: '[hostId]/digest',
    get title() {
      return translate('fork.digest.screenTitle', 'Digest')
    }
  }
] as const

/** The host menu row that opens the digest; `disabled` while the host is not connected. */
export function forkDigestHostAction(
  hostPath: string,
  disabled: boolean,
  navigate: (path: string) => void
) {
  return {
    id: 'fork-digest',
    label: translate('fork.digest.menu', 'Digest'),
    icon: Newspaper,
    disabled,
    closeBeforePress: true,
    onPress: () => navigate(`${hostPath}/digest`)
  }
}
