// A small number field for fork settings: edits freely, commits a clamped whole number on blur
// or Enter, and keeps the old value when the text is not a number.
import { useState } from 'react'
import { Input } from '@/components/ui/input'

export function ForkNumberInput({
  value,
  label,
  min,
  max,
  disabled,
  className = 'w-24',
  onCommit
}: {
  value: number
  label: string
  min: number
  max: number
  disabled?: boolean
  className?: string
  onCommit: (next: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    const parsed = Number.parseInt(draft ?? '', 10)
    setDraft(null)
    if (Number.isFinite(parsed)) {
      onCommit(Math.min(max, Math.max(min, parsed)))
    }
  }
  return (
    <Input
      type="number"
      min={min}
      max={max}
      aria-label={label}
      className={className}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
    />
  )
}
