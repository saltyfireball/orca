// SLRM-2096: file name parts for what the lost work actions save.

export function fileStamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
}

export function safeName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+/, '')
      .slice(0, 80) || 'item'
  )
}
