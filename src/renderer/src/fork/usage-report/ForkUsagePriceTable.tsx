// SLRM-2104 (FORK.md "Usage and cost report"): the price table the usage report estimates with.
// Starts as the app's own Claude prices; an edited row is saved as the user's own and wins.
import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { ForkUsagePrice } from '../../../../shared/fork/usage-ledger'
import { ForkNumberInput } from '../cache-cold/ForkNumberInput'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'] as const
type Field = (typeof FIELDS)[number]

const ZERO: ForkUsagePrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 }

function fieldLabel(field: Field): string {
  switch (field) {
    case 'input':
      return translate('fork.usagePrices.input', 'Input')
    case 'output':
      return translate('fork.usagePrices.output', 'Output')
    case 'cacheRead':
      return translate('fork.usagePrices.cacheRead', 'Cache read')
    case 'cacheWrite':
      return translate('fork.usagePrices.cacheWrite', 'Cache write 5m')
    case 'cacheWrite1h':
      return translate('fork.usagePrices.cacheWrite1h', 'Cache write 1h')
  }
}

function useDefaultPrices(): Record<string, ForkUsagePrice> {
  const [prices, setPrices] = useState<Record<string, ForkUsagePrice>>({})
  useEffect(() => {
    let live = true
    void window.api?.forkUsageLedger
      ?.defaultPrices()
      .then((next) => live && setPrices(next))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  return prices
}

export function ForkUsagePriceTable({ settings, updateSettings }: Props): React.JSX.Element {
  const defaults = useDefaultPrices()
  const own = settings.forkUsagePrices ?? {}
  const [adding, setAdding] = useState('')
  const models = [...new Set([...Object.keys(own), ...Object.keys(defaults)])].sort()
  const save = (next: Record<string, ForkUsagePrice>) => updateSettings({ forkUsagePrices: next })
  const edit = (model: string, field: Field, value: number) => {
    const base = own[model] ?? defaults[model] ?? ZERO
    save({ ...own, [model]: { ...base, [field]: value } })
  }
  const reset = (model: string) => {
    const { [model]: _drop, ...rest } = own
    save(rest)
  }
  const add = () => {
    const model = adding.trim()
    if (model && !own[model]) {
      save({ ...own, [model]: defaults[model] ?? ZERO })
    }
    setAdding('')
  }
  return (
    <div className="space-y-2">
      <div className="scrollbar-sleek max-h-80 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">
                {translate('fork.usagePrices.model', 'Model')}
              </th>
              {FIELDS.map((field) => (
                <th key={field} className="px-1 py-1 text-right font-normal">
                  {fieldLabel(field)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const price = own[model] ?? defaults[model] ?? ZERO
              return (
                <tr key={model} className={own[model] ? 'font-medium' : undefined}>
                  <td className="px-2 py-0.5">{model}</td>
                  {FIELDS.map((field) => (
                    <td key={field} className="px-1 py-0.5">
                      <ForkNumberInput
                        decimal
                        value={price[field] ?? price.cacheWrite}
                        label={`${model} ${fieldLabel(field)}`}
                        min={0}
                        max={10_000}
                        className="h-7 w-20 text-right"
                        onCommit={(next) => edit(model, field, next)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-0.5 text-right">
                    {own[model] ? (
                      <Button size="xs" variant="ghost" onClick={() => reset(model)}>
                        {defaults[model]
                          ? translate('fork.usagePrices.reset', 'Reset')
                          : translate('fork.usagePrices.remove', 'Remove')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="h-8 w-64"
          value={adding}
          aria-label={translate('fork.usagePrices.addLabel', 'Model id to price')}
          placeholder={translate('fork.usagePrices.addPlaceholder', 'Model id, e.g. a new release')}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              add()
            }
          }}
        />
        <Button size="sm" variant="outline" disabled={!adding.trim()} onClick={add}>
          {translate('fork.usagePrices.add', 'Add model')}
        </Button>
      </div>
    </div>
  )
}
