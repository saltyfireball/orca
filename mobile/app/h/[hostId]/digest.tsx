import { useLocalSearchParams } from 'expo-router'
import { MobileWebShellScreen } from '../../../src/mobile-web-shell/MobileWebShellScreen'
import { shellScreenRoute } from '../../../src/mobile-web-shell/routing/shell-screen-route'
import { PageRouteUnavailableScreen } from '../../../src/mobile-web-shell/presentation/PageRouteUnavailableScreen'
import { firstParam } from '../../../src/navigation/route-param-reader'

/** Blackfish (SLRM-2388): the shell route for the host's digest, in `accounts.tsx`'s shape. */
export default function MobileForkDigestRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)

  const route = hostId
    ? shellScreenRoute({ pathname: `/h/${encodeURIComponent(hostId)}/digest` })
    : null
  if (route === null) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return <MobileWebShellScreen key={hostId} hostId={hostId} route={route} />
}
