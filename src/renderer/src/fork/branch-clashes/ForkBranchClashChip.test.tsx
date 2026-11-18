// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ForkBranchClashMark } from './ForkBranchClashChip'

afterEach(cleanup)

describe('ForkBranchClashMark', () => {
  it('draws nothing without shared files or staleness', () => {
    const view = render(<ForkBranchClashMark mark={{ files: [], behind: 3, stale: false }} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('counts shared files first, else how far behind', () => {
    const view = render(
      <>
        <ForkBranchClashMark
          mark={{
            files: [
              { file: 'x.ts', others: ['b'] },
              { file: 'y.ts', others: ['c'] }
            ],
            behind: 40,
            stale: true
          }}
        />
        <ForkBranchClashMark mark={{ files: [], behind: 40, stale: true }} />
      </>
    )
    expect(view.getAllByTestId('fork-clash-chip').map((chip) => chip.textContent)).toEqual([
      '2 shared',
      '40 behind'
    ])
  })
})
