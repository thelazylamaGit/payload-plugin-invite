import type { PayloadHandler } from 'payload'

import crypto from 'node:crypto'

import type { InviteData, PayloadInviteConfig } from '../types.js'

import { canCreateInvite } from '../access/canCreateInvite.js'
import {
  defaultEmailHtml,
  defaultEmailSubject,
  defaultEmailText,
  renderTemplate,
} from '../email/defaultTemplate.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const createInviteEndpoint =
  (pluginOptions: PayloadInviteConfig): PayloadHandler =>
  async (req) => {
    // Authentication is required independently of the application's access policy.
    if (!req.user) {
      if (pluginOptions.debug) {
        req.payload.logger.info('[payload-invite] create: rejected unauthenticated request')
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: unknown

    try {
      body = (await req.json?.()) ?? {}
    } catch {
      body = {}
    }

    if (!isRecord(body)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { collection, data = {}, email } = body

    if (!(await canCreateInvite(pluginOptions, req, { collection, data, email }))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!email || typeof email !== 'string') {
      return Response.json({ error: 'email is required' }, { status: 400 })
    }

    if (!collection || typeof collection !== 'string') {
      return Response.json({ error: 'collection is required' }, { status: 400 })
    }

    const userCollections = pluginOptions.userCollections ?? ['users']

    if (!userCollections.some((slug) => slug === collection)) {
      return Response.json({ error: 'Invalid collection' }, { status: 400 })
    }

    if (!isRecord(data)) {
      return Response.json({ error: 'data must be an object' }, { status: 400 })
    }

    const values: Record<string, unknown> = { ...data }
    for (const field of pluginOptions.fields ?? []) {
      if (field.type !== 'relationship') {
        continue
      }

      const value = values[field.name]
      if (value === undefined || value === null || value === '') {
        if (field.required) {
          return Response.json(
            { error: `${field.label ?? field.name} is required` },
            { status: 400 },
          )
        }
        delete values[field.name]
        continue
      }

      if (
        !(
          (typeof value === 'string' && value.trim().length > 0) ||
          (typeof value === 'number' && Number.isFinite(value))
        )
      ) {
        return Response.json(
          { error: `Invalid relationship value for ${field.name}` },
          { status: 400 },
        )
      }

      // Local API calls bypass access by default. This lookup acts as the inviter.
      try {
        const document = await req.payload.findByID({
          id: value,
          collection: field.relationTo,
          depth: 0,
          disableErrors: true,
          overrideAccess: false,
          req,
        })
        if (!document) {
          return Response.json(
            { error: `Invalid or inaccessible selection for ${field.label ?? field.name}` },
            { status: 400 },
          )
        }
      } catch {
        return Response.json(
          { error: `Unable to validate selection for ${field.label ?? field.name}` },
          { status: 400 },
        )
      }
    }

    const extraData: InviteData = {}
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        return Response.json({ error: `Invalid value for ${name}` }, { status: 400 })
      }
      extraData[name] = value
    }

    const inviteExpiryMs = pluginOptions.inviteExpiryMs ?? 48 * 60 * 60 * 1000
    const expiresAt = new Date(Date.now() + inviteExpiryMs)

    // Generate a secure random token and hash it for storage
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    if (pluginOptions.debug) {
      req.payload.logger.info(
        `[payload-invite] create: inviting ${email} to collection "${collection}", expires at ${expiresAt.toISOString()}`,
      )
    }

    // Persist the invite (extra field values stored in `data` for use on account creation)
    await req.payload.create({
      collection: 'plugin-invites',
      data: {
        collection,
        data: extraData,
        email,
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
        tokenHash,
      },
      // Only this endpoint may persist an invite after the action-level check above.
      overrideAccess: true,
      req,
    })

    // Build the full invite URL — serverURL is always absolute (e.g. https://example.com)
    const serverURL = req.payload.config.serverURL ?? ''
    const adminRoute = req.payload.config.routes.admin ?? '/admin'
    const inviteURL = `${serverURL}${adminRoute}/invite-accept?token=${rawToken}`

    // Merge default templates with any user overrides.
    // Extra field values are included so they can be used as placeholders, e.g. {name}.
    const templateValues = { email, url: inviteURL, ...extraData }

    const subject = renderTemplate(
      pluginOptions.email?.subject ?? defaultEmailSubject,
      templateValues,
    )

    const html = renderTemplate(pluginOptions.email?.html ?? defaultEmailHtml, templateValues)

    const text = renderTemplate(pluginOptions.email?.text ?? defaultEmailText, templateValues)

    if (pluginOptions.debug) {
      req.payload.logger.info(`[payload-invite] create: sending invite email to ${email}`)
    }

    await req.payload.sendEmail({ html, subject, text, to: email })

    return Response.json({ success: true })
  }
