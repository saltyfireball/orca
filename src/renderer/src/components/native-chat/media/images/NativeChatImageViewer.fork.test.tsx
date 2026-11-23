// @vitest-environment happy-dom

// Fork tests: the viewer counts the image among its group, and arrow keys do not leak to the composer.
// Kept apart from upstream's viewer tests, which upstream cut from its suite.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { NativeChatImageViewer } from './NativeChatImageAttachments'

afterEach(cleanup)

const BLOCKS = ['before.png', 'after.png', 'diff.png'].map((name) => ({
  type: 'image-ref' as const,
  url: `https://example.invalid/${name}`,
  alt: name
}))

function Viewer({ blocks = BLOCKS }: { blocks?: typeof BLOCKS }): React.JSX.Element {
  const [index, setIndex] = useState<number | null>(0)
  return (
    <NativeChatImageViewer
      blocks={blocks}
      index={index}
      onIndexChange={setIndex}
      runtimeContext={null}
    />
  )
}

it('counts the image among its group and keeps arrow keys from the composer', () => {
  let leaked = 0
  render(
    <div onKeyDown={() => (leaked += 1)}>
      <Viewer />
    </div>
  )
  expect(screen.getByTestId('pan-zoom-image-counter').textContent).toBe('1 / 3')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
  expect(screen.getByTestId('pan-zoom-image-counter').textContent).toBe('2 / 3')
  expect(leaked).toBe(0)
})

it('hides the counter for a lone image', () => {
  render(<Viewer blocks={BLOCKS.slice(0, 1)} />)
  expect(screen.queryByTestId('pan-zoom-image-counter')).toBeNull()
})
