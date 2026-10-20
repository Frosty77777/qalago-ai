import type { ApiError } from '../api/client'
import type { StringKey } from '../i18n/strings'

/** Localized, user-facing text for an API error, naming the 2GIS service that failed. */
export function errorMessage(t: (k: StringKey, v?: Record<string, string | number>) => string, error: ApiError) {
  const service = error.service ? t(`service_${error.service}` as StringKey) : '2GIS'
  return t(`error_${error.kind}` as StringKey, { service, s: error.retryAfter ?? 30 })
}
