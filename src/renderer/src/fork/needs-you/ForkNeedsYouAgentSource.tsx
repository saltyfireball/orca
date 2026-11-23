// Needs you (FORK.md "Needs you list", BAD-759): reads the agents waiting on an approval or a
// question while any wait, and publishes them to the list. Renders nothing. The dashboard's cards
// are built only while upstream's own Needs you count is above zero, so an idle app builds none.
import { useEffect } from 'react'
import { useAgentBucketCounts } from '@/components/dashboard/bucket-counts/useAgentBucketCounts'
import { useLiveDashboardSnapshot } from '@/components/dashboard/snapshot/useLiveDashboardSnapshot'
import { publishNeedsYouAgents, useNeedsYouEnabled } from './needs-you-store'

function Cards(): null {
  const { cards } = useLiveDashboardSnapshot()
  useEffect(() => {
    publishNeedsYouAgents(cards.filter((card) => card.bucket === 'attention'))
  }, [cards])
  useEffect(() => () => publishNeedsYouAgents([]), [])
  return null
}

export function ForkNeedsYouAgentSource(): React.JSX.Element | null {
  const enabled = useNeedsYouEnabled()
  const waiting = useAgentBucketCounts().attention
  return enabled && waiting > 0 ? <Cards /> : null
}
