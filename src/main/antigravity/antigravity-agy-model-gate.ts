// Fork (BAD-836): agy before 1.5.1 offers non-Gemini models only to allowlisted editors, and Orca
// names itself, so such a model is refused before the session opens instead of failing inside it.

import {
  compareAppVersions,
  isValidAppVersion
} from '../../shared/app-lifecycle/identity/app-version'

export function isAntigravityGeminiModel(model: string): boolean {
  return /^gemini\b/i.test(model.trim())
}

/** The first agy that offers every model to any client. */
export const AGY_ALL_MODELS_MINIMUM_VERSION = '1.5.1'

/** Why agy at `version` (null when unknown) cannot run `model`; null when it can. */
export function agyRefusesModel(model: string, version: string | null): string | null {
  if (isAntigravityGeminiModel(model)) {
    return null
  }
  if (
    version &&
    isValidAppVersion(version) &&
    compareAppVersions(version, AGY_ALL_MODELS_MINIMUM_VERSION) >= 0
  ) {
    return null
  }
  const running = version ? `agy ${version}` : 'This agy, whose version Orca could not read,'
  return `${running} offers ${model} only to allowlisted editors. Update agy to ${AGY_ALL_MODELS_MINIMUM_VERSION} or newer to use it, or pick a Gemini model.`
}
