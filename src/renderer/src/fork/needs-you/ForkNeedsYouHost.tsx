// Needs you (FORK.md "Needs you list", BAD-759): the always-mounted pieces, behind one line in
// `ForkRootHosts`: the list, the control for a hidden status bar, the trail bar and the agent source.
import React, { useEffect } from 'react'
import { useComputedNeedsYouData } from './needs-you-data'
import { publishNeedsYouData } from './needs-you-store'
import { ForkNeedsYouAgentSource } from './ForkNeedsYouAgentSource'
import { ForkNeedsYouFloatingControl } from './ForkNeedsYouControl'
import { ForkNeedsYouList } from './ForkNeedsYouList'
import { ForkNeedsYouTrailBar } from './ForkNeedsYouTrailBar'

/** The one place the sources are merged; everything else reads the published result. */
function ForkNeedsYouPublisher(): null {
  const data = useComputedNeedsYouData()
  useEffect(() => publishNeedsYouData(data), [data])
  return null
}

export function ForkNeedsYouHost(): React.JSX.Element {
  return (
    <>
      <ForkNeedsYouPublisher />
      <ForkNeedsYouAgentSource />
      <ForkNeedsYouList />
      <ForkNeedsYouTrailBar />
      <ForkNeedsYouFloatingControl />
    </>
  )
}
