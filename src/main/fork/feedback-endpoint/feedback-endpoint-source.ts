// Feedback endpoint (BAD-895): the main process reads the saved setting on every send, so a change
// takes effect with no restart and the stock feedback module needs no store of its own.
import { forkFeedbackEndpoint } from '../../../shared/fork/feedback-endpoint'

let readSettings: () => unknown = () => undefined

export function installForkFeedbackEndpointSource(getSettings: () => unknown): void {
  readSettings = getSettings
}

/** The address feedback and crash reports go to now, or null when feedback is off. */
export function currentForkFeedbackEndpoint(): string | null {
  return forkFeedbackEndpoint(readSettings())
}
