import { NativeChatTextAttachmentScope } from '../media/text/NativeChatTextAttachments'
import { forwardRef } from 'react'
import { NativeChatComposerPane } from './NativeChatComposerPane'
import type {
  NativeChatComposerHandle,
  NativeChatComposerProps
} from './native-chat-composer-types'
import {
  ForkCacheColdCue,
  useForkComposerHandleRef
} from '../../../fork/cache-cold/ForkCacheColdCue'

export const NativeChatComposer = forwardRef<NativeChatComposerHandle, NativeChatComposerProps>(
  function NativeChatComposer(props, ref): React.JSX.Element {
    // Fork (SLRM-2103): the cache-cold cue sits above the pane and sends through its handle.
    const [paneRef, handle] = useForkComposerHandleRef(ref)
    return (
      <NativeChatTextAttachmentScope
        key={props.paneKey}
        enabled={Boolean(props.structuredTransport)}
      >
        <ForkCacheColdCue composer={props} handle={handle} />
        <NativeChatComposerPane {...props} ref={paneRef} />
      </NativeChatTextAttachmentScope>
    )
  }
)
