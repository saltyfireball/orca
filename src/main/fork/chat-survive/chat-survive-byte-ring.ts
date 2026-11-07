// SLRM-1394: a bounded byte log with absolute offsets. A reattaching client asks for everything
// from the offset it last saw; the ring answers with what it still holds and where that starts.

export type ChatSurviveRingSlice = {
  /** Absolute offset of the first byte returned. Above the requested offset when bytes were lost. */
  first: number
  /** Absolute offset just past the last byte the ring holds. */
  end: number
  data: Buffer
  /** True when the requested offset is older than the oldest byte the ring still holds. */
  truncated: boolean
}

export class ChatSurviveByteRing {
  private readonly chunks: Buffer[] = []
  private held = 0
  private start = 0

  constructor(private readonly capacity: number) {
    if (!(capacity > 0)) {
      throw new RangeError(`chat-survive ring capacity ${capacity} must be positive`)
    }
  }

  /** Offset just past the newest byte ever appended. */
  get end(): number {
    return this.start + this.held
  }

  /** Offset of the oldest byte still held. */
  get first(): number {
    return this.start
  }

  append(data: Buffer): void {
    if (data.length === 0) {
      return
    }
    // A chunk larger than the whole ring keeps only its tail.
    const kept = data.length > this.capacity ? data.subarray(data.length - this.capacity) : data
    this.start += data.length - kept.length
    this.chunks.push(Buffer.from(kept))
    this.held += kept.length
    while (this.held > this.capacity) {
      const head = this.chunks[0]
      const excess = this.held - this.capacity
      if (head.length <= excess) {
        this.chunks.shift()
        this.held -= head.length
        this.start += head.length
      } else {
        this.chunks[0] = head.subarray(excess)
        this.held -= excess
        this.start += excess
      }
    }
  }

  /** Everything from `from` on; offsets past the end return nothing, offsets before it clamp. */
  sliceFrom(from: number): ChatSurviveRingSlice {
    const end = this.end
    const truncated = from < this.start
    const first = Math.min(Math.max(from, this.start), end)
    let skip = first - this.start
    const parts: Buffer[] = []
    for (const chunk of this.chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      parts.push(skip > 0 ? chunk.subarray(skip) : chunk)
      skip = 0
    }
    return { first, end, data: Buffer.concat(parts), truncated }
  }
}
