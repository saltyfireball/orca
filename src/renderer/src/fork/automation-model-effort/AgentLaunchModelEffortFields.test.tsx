// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLaunchModelEffortFields } from './AgentLaunchModelEffortFields'
import type { AgentPickerEntry } from '../../../../shared/agent-launch/picker/agent-launch-picker'
import type { AgentSessionModelOption } from '../../../../shared/agent-session/options/model-catalog/agent-session-model-option'

// Radix menus portal; plain buttons let the test choose an item.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({
    onValueChange,
    children
  }: {
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <div>
      {React.Children.map(children, (child) =>
        React.isValidElement<{ value: string }>(child)
          ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
              onPick: () => onValueChange(child.props.value)
            })
          : child
      )}
    </div>
  ),
  DropdownMenuRadioItem: ({
    children,
    onPick
  }: {
    children: React.ReactNode
    onPick?: () => void
  }) => (
    <button type="button" onClick={onPick}>
      {children}
    </button>
  )
}))

const efforts = ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
  value,
  label: value === 'xhigh' ? 'Extra high' : value[0]!.toUpperCase() + value.slice(1)
}))
const claudeModels: AgentSessionModelOption[] = [
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5']
].map(([id, label], index) => ({
  id: id!,
  label: label!,
  isDefault: index === 0,
  efforts,
  defaultEffort: 'medium'
}))
const entry: AgentPickerEntry = {
  agent: 'claude',
  label: 'Claude',
  rows: [{ agent: 'claude', kind: 'terminal' }],
  surfaces: ['chat', 'terminal'],
  defaultSurface: 'chat',
  terminal: {},
  structured: {},
  catalog: { origin: 'probe', fetchedAt: 1, models: claudeModels },
  catalogRead: 'settled'
}

afterEach(cleanup)

describe('AgentLaunchModelEffortFields', () => {
  it('lists the agent models and effort levels, and reports a pick as a choice edit', () => {
    const onEdit = vi.fn()
    render(
      <AgentLaunchModelEffortFields
        entry={entry}
        draft={{ agent: 'claude', surface: 'chat', choices: {} }}
        onEdit={onEdit}
      />
    )
    expect(screen.getByLabelText('Model')).toBeTruthy()
    fireEvent.click(screen.getByText('Claude Haiku 5.5'))
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'choice',
      patch: { model: 'claude-haiku-5-5' }
    })
    fireEvent.click(screen.getByText('Extra high'))
    expect(onEdit).toHaveBeenLastCalledWith({
      kind: 'choice',
      patch: { options: { effort: 'xhigh' } }
    })
    fireEvent.click(screen.getAllByText('Agent default')[1]!)
    expect(onEdit).toHaveBeenLastCalledWith({ kind: 'choice', patch: { model: null } })
  })

  it('says a pick wins over a model flag in the Arguments', () => {
    render(
      <AgentLaunchModelEffortFields
        entry={{ ...entry, arguments: '--model sonnet --effort low' }}
        draft={{
          agent: 'claude',
          surface: 'chat',
          choices: { model: 'claude-opus-5-5', options: { effort: 'xhigh' } }
        }}
        onEdit={vi.fn()}
      />
    )
    expect(screen.getByText(/not the one in Arguments/)).toBeTruthy()
  })
})
