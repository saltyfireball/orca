// Fork BAD-747: a fenced block in an item's comment or description. A shell fence (or one with no
// language) is a command: it shows wrapped and selectable with Copy always visible, and is never linked.
// Any other language keeps chat's block, whose header carries Copy.
import React from 'react'
import { isRunnableShellFence } from '../../../../../shared/fork/shell-fence'
import { NativeChatCodeBlock } from '../../native-chat/markdown/code/NativeChatCodeBlock'
import { BotItemCommandBlock } from './BotItemCommandBlock'

function codeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(codeText).join('')
  }
  return React.isValidElement<{ children?: React.ReactNode }>(node)
    ? codeText(node.props.children)
    : ''
}

export function BotItemCodeBlock({
  children,
  language,
  sourceLine
}: {
  children?: React.ReactNode
  language?: string
  sourceLine?: number
}): React.JSX.Element {
  const code = codeText(children).replace(/\n$/, '')
  if (code && (!language || isRunnableShellFence(language))) {
    return <BotItemCommandBlock command={code} className="my-2" />
  }
  return (
    <NativeChatCodeBlock language={language} sourceLine={sourceLine}>
      {children}
    </NativeChatCodeBlock>
  )
}
