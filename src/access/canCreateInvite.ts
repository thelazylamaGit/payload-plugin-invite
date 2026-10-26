import type { PayloadRequest } from 'payload'

import type { PayloadInviteConfig } from '../types.js'

/** Sending an invitation is an action, so query constraints cannot grant access. */
export const canCreateInvite = async (
  options: PayloadInviteConfig,
  req: PayloadRequest,
  data?: Record<string, unknown>,
): Promise<boolean> => {
  if (!req.user || options.disabled || !options.access?.create) {
    return false
  }

  try {
    return (await options.access.create({ data, req })) === true
  } catch {
    req.payload.logger.error('[payload-invite] access.create evaluation failed; invitation denied')
    return false
  }
}
