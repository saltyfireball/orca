// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatRunDialog } from './NativeChatRunDialog'

afterEach(cleanup)

function renderDialog(original = 'aws s3 ls --profile prod') {
  const onRun = vi.fn()
  const onClose = vi.fn()
  render(
    <NativeChatRunDialog
      title="Run in dotfiles?"
      original={original}
      onRun={onRun}
      onClose={onClose}
    />
  )
  const field = screen.getByRole('textbox', { name: 'Command' })
  const runButton = screen.getByRole('button', { name: 'Run' })
  return { onRun, onClose, field, runButton }
}

describe('NativeChatRunDialog', () => {
  it('runs the original command unchanged', () => {
    const { onRun, field, runButton } = renderDialog()
    expect(field).toHaveValue('aws s3 ls --profile prod')
    fireEvent.click(runButton)
    expect(onRun).toHaveBeenCalledWith('aws s3 ls --profile prod')
  })

  it('runs the edited text on Enter, trimmed', () => {
    const { onRun, field } = renderDialog()
    fireEvent.change(field, { target: { value: ' aws s3 ls --profile dev ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledWith('aws s3 ls --profile dev')
  })

  it('refuses an unsafe edit and says why', () => {
    const { onRun, field, runButton } = renderDialog()
    fireEvent.change(field, { target: { value: 'ls\nrm -rf x' } })
    expect(runButton).toBeDisabled()
    expect(screen.getByText('Keep the command on one line.')).toBeInTheDocument()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onRun).not.toHaveBeenCalled()
  })

  it('resets to the agent command', () => {
    const { field } = renderDialog()
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
    fireEvent.change(field, { target: { value: 'ls' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(field).toHaveValue('aws s3 ls --profile prod')
  })

  it('closes on Cancel without running', () => {
    const { onRun, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
  })
})
