import type { PayloadHandler } from 'payload'

import crypto from 'node:crypto'
import { ValidationError } from 'payload'

import type { PayloadInviteConfig } from '../types.js'

export const acceptInviteEndpoint =
  (pluginOptions: PayloadInviteConfig): PayloadHandler =>
  async (req) => {
    let body: { password?: string; token?: string }

    try {
      body = (await req.json?.()) ?? {}
    } catch {
      body = {}
    }

    const { password, token: rawToken } = body

    if (!rawToken || typeof rawToken !== 'string') {
      return Response.json({ error: 'token is required' }, { status: 400 })
    }

    if (!password || typeof password !== 'string') {
      return Response.json({ error: 'password is required' }, { status: 400 })
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
        req.payload.logger.info(`[payload-invite] accept: no invite found for token hash`)
      }
      return Response.json({ error: 'Invalid or expired invitation' }, { status: 404 })
    }

    if (invite.status === 'accepted') {
      return Response.json({ error: 'Invitation has already been used' }, { status: 410 })
    }

    const now = new Date()
    const expiresAt = new Date(invite.expiresAt as string)

    if (now > expiresAt) {
      if (pluginOptions.debug) {
        req.payload.logger.info(`[payload-invite] accept: invite ${invite.id} has expired`)
      }

      if (invite.status !== 'expired') {
        await req.payload.update({
          id: invite.id,
          collection: 'plugin-invites',
          data: { status: 'expired' },
        })
      }

      return Response.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    const userCollections = pluginOptions.userCollections ?? ['users']
    const collectionSlug = invite.collection as string

    const targetCollection = userCollections.find((slug) => slug === collectionSlug)
    if (!targetCollection) {
      return Response.json({ error: 'Invalid collection' }, { status: 400 })
    }

    // Merge any extra fields stored on the invite into the user document
    const extraData = (invite.data as null | Record<string, unknown>) ?? {}
    for (const field of pluginOptions.fields ?? []) {
      if (
        field.type === 'relationship' &&
        (extraData[field.name] === '' || extraData[field.name] === null)
      ) {
        delete extraData[field.name]
      }
    }

    if (pluginOptions.debug) {
      req.payload.logger.info(
        `[payload-invite] accept: creating user ${invite.email} in collection "${collectionSlug}"`,
      )
    }

    // Create the user account
    try {
      // Payload's default relationship validation checks ID shape, but not existence.
      // The validated token authorizes this check; inviter read access was checked at creation.
      for (const field of pluginOptions.fields ?? []) {
        if (field.type !== 'relationship') {
          continue
        }
        const value = extraData[field.name]
        if (value === undefined) {
          continue
        }
        if (typeof value !== 'string' && typeof value !== 'number') {
          return Response.json(
            { error: `Invalid relationship value for ${field.name}` },
            { status: 422 },
          )
        }
        const document = await req.payload.findByID({
          id: value,
          collection: field.relationTo,
          depth: 0,
          disableErrors: true,
          overrideAccess: true,
          req,
        })
        if (!document) {
          return Response.json(
            {
              error: `${field.label ?? field.name}: the selected document no longer exists. Please request a new invitation.`,
            },
            { status: 422 },
          )
        }
      }

      await req.payload.create({
        collection: targetCollection,
        data: {
          ...extraData,
          email: invite.email as string,
          password,
        },
      })
    } catch (err: unknown) {
      const message =
        err instanceof ValidationError
          ? err.data.errors.map((error) => `${error.path}: ${error.message}`).join('; ')
          : err instanceof Error
            ? err.message
            : 'Failed to create user'
      if (pluginOptions.debug) {
        req.payload.logger.info(
          `[payload-invite] accept: failed to create user ${invite.email}: ${message}`,
        )
      }
      return Response.json({ error: message }, { status: 422 })
    }

    // Mark invite as accepted
    await req.payload.update({
      id: invite.id,
      collection: 'plugin-invites',
      data: {
        status: 'accepted',
        usedAt: now.toISOString(),
      },
    })

    if (pluginOptions.debug) {
      req.payload.logger.info(`[payload-invite] accept: invite ${invite.id} accepted`)
    }

    return Response.json({ success: true })
  }
