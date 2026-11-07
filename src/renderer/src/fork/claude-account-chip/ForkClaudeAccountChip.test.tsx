// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForkClaudeAccount, ForkClaudeAccountResolution } from './claude-account-identity'

vi.mock('./claude-account-usage', () => ({
  useForkClaudeAccountUsage: () => ({ limits: null, isFetching: false, refresh: () => undefined })
}))
vi.mock('@/components/status-bar/InlineProviderUsage', () => ({
  InlineUsageBars: () => null
}))

const { ForkClaudeAccountChip } = await import('./ForkClaudeAccountChip')

function account(label: string, ownerKey = 'local'): ForkClaudeAccount {
  return { ownerKey, id: label, email: null, label, colour: 'red', hostLabel: null }
}

const one: ForkClaudeAccountResolution = { kind: 'account', account: account('B @ kif') }

afterEach(cleanup)

describe('ForkClaudeAccountChip', () => {
  it('draws nothing for none', () => {
    const view = render(<ForkClaudeAccountChip resolution={{ kind: 'none' }} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('labels an account, mixed sessions and an unknown remote folder', () => {
    const view = render(
      <>
        <ForkClaudeAccountChip resolution={one} />
        <ForkClaudeAccountChip
          resolution={{ kind: 'mixed', accounts: [account('A'), account('B', 'environment:k')] }}
        />
        <ForkClaudeAccountChip resolution={{ kind: 'unknown', ownerKey: 'k', hostLabel: 'kif' }} />
      </>
    )
    const chips = view.getAllByTestId('fork-account-chip')
    expect(chips.map((chip) => [chip.dataset.kind, chip.textContent])).toEqual([
      ['account', 'B @ kif'],
      ['mixed', 'Mixed'],
      ['unknown', '? @ kif']
    ])
  })

  it('labels a move queued behind a turn as from -> to', () => {
    const from = { ...account('C @ kif'), hostLabel: 'kif' }
    const to = { ...account('B @ kif'), id: 'B', colour: 'blue', hostLabel: 'kif' }
    const view = render(
      <ForkClaudeAccountChip resolution={{ kind: 'account', account: from, movingTo: to }} />
    )
    expect(view.getByTestId('fork-account-chip').textContent).toBe('C -> B @ kif')
  })

  it('lets clicks through unless a menu is attached', () => {
    const parentClick = vi.fn()
    const onOpenMenu = vi.fn()
    const view = render(
      <div onClick={parentClick}>
        <ForkClaudeAccountChip resolution={one} />
        <ForkClaudeAccountChip resolution={one} onOpenMenu={onOpenMenu} />
      </div>
    )
    const [plain, withMenu] = view.getAllByTestId('fork-account-chip')
    fireEvent.click(plain)
    expect(parentClick).toHaveBeenCalledTimes(1)
    fireEvent.click(withMenu)
    expect(parentClick).toHaveBeenCalledTimes(1)
    expect(onOpenMenu).toHaveBeenCalledWith(one)
  })

  it('hands the chip to the menu slot to wrap', () => {
    const view = render(
      <ForkClaudeAccountChip
        resolution={one}
        menu={(chip) => <span data-testid="move-menu">{chip}</span>}
      />
    )
    const menu = view.getByTestId('move-menu')
    expect(menu.querySelector('[data-testid="fork-account-chip"]')).not.toBeNull()
  })
})
