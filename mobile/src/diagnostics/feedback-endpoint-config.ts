import { forkFeedbackUrlOrNull } from '../../../src/shared/fork/feedback-endpoint'

/** Fork (BAD-895): where connection diagnostics are posted; unset at build time is null, which hides Send diagnostics and posts nothing. */
export const MOBILE_FEEDBACK_ENDPOINT: string | null = forkFeedbackUrlOrNull(
  process.env.EXPO_PUBLIC_FEEDBACK_ENDPOINT_URL
)
