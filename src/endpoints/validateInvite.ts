import type { PayloadHandler } from 'payload'

import crypto from 'node:crypto'

import type { PayloadInviteConfig } from '../types.js'

export const validateInviteEndpoint =
  (pluginOptions: PayloadInviteConfig): PayloadHandler =>
  async (req) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const rawToken = url.searchParams.get('token')

    if (!rawToken) {
      return Response.json({ error: 'token is required' }, { status: 400 })
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const result = await req.payload.find({
      collection: 'plugin-invites',
      limit: 1,
      where: {
        tokenHash: {
          equals: tokenHash,
        },
      },
    })

    const invite = result.docs[0]

    if (!invite) {
      if (pluginOptions.debug) {
        req.payload.logger.info(`[payload-invite] validate: no invite found for token hash`)
      }
      return Response.json({ error: 'Invalid or expired invitation' }, { status: 404 })
    }

    if (pluginOptions.debug) {
      req.payload.logger.info(
        `[payload-invite] validate: found invite ${invite.id} (${invite.email}) status=${invite.status}`,
      )
    }

    if (invite.status === 'accepted') {
      return Response.json({ error: 'Invitation has already been used' }, { status: 410 })
    }

    const now = new Date()
    const expiresAt = new Date(invite.expiresAt as string)

    if (now > expiresAt) {
      if (pluginOptions.debug) {
        req.payload.logger.info(`[payload-invite] validate: invite ${invite.id} has expired`)
      }

      // Mark as expired if it isn't already
      if (invite.status !== 'expired') {
        await req.payload.update({
          id: invite.id,
          collection: 'plugin-invites',
          data: { status: 'expired' },
        })
      }

      return Response.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    return Response.json({
      collection: invite.collection,
      email: invite.email,
    })
  }
