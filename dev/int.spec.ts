import type { Payload } from 'payload'

import config from '@payload-config'
import crypto from 'node:crypto'
import { createPayloadRequest, getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { PayloadInviteConfig } from '../src/types.js'

import { acceptInviteEndpoint } from '../src/endpoints/acceptInvite.js'
import { createInviteEndpoint } from '../src/endpoints/createInvite.js'
import { validateInviteEndpoint } from '../src/endpoints/validateInvite.js'
import { devUser } from './helpers/credentials.js'
import { clearSentEmails, sentEmails } from './helpers/testEmailAdapter.js'

let payload: Payload
let adminToken: string

// Matches the options registered in dev/payload.config.ts
const defaultPluginOptions: PayloadInviteConfig = {
  fields: [{ name: 'name', label: 'Full Name', required: true }],
  userCollections: ['users'],
}

let emailCounter = 0
// Ensures a fresh, unused email address for every test so unique-field constraints never collide.
const uniqueEmail = () => `invitee-${Date.now()}-${emailCounter++}@example.com`

const jsonRequest = (url: string, body?: unknown, token?: string) =>
  new Request(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `JWT ${token}` } : {}),
    },
    method: 'POST',
  })

const runCreateInvite = async (
  body?: unknown,
  token?: string,
  options: PayloadInviteConfig = defaultPluginOptions,
) => {
  const request = jsonRequest('http://localhost:3000/api/plugin-invites/create', body, token)
  const payloadRequest = await createPayloadRequest({ config, request })
  return createInviteEndpoint(options)(payloadRequest)
}

const runValidateInvite = async (token?: string) => {
  const url = new URL('http://localhost:3000/api/plugin-invites/validate')
  if (token) {
    url.searchParams.set('token', token)
  }
  const request = new Request(url, { method: 'GET' })
  const payloadRequest = await createPayloadRequest({ config, request })
  return validateInviteEndpoint(payloadRequest)
}

const runAcceptInvite = async (
  body?: unknown,
  options: PayloadInviteConfig = defaultPluginOptions,
) => {
  const request = jsonRequest('http://localhost:3000/api/plugin-invites/accept', body)
  const payloadRequest = await createPayloadRequest({ config, request })
  return acceptInviteEndpoint(options)(payloadRequest)
}

// The raw token is only ever transmitted via the invite email, never returned by the API.
const extractTokenFromEmail = (): string => {
  const email = sentEmails.at(-1)
  const match = /token=([a-f0-9]+)/.exec(String(email?.text))
  if (!match) {
    throw new Error('Could not find invite token in sent email')
  }
  return match[1]
}

const hashToken = (rawToken: string) => crypto.createHash('sha256').update(rawToken).digest('hex')

beforeAll(async () => {
  payload = await getPayload({ config })

  const loginResult = await payload.login({
    collection: 'users',
    data: { email: devUser.email, password: devUser.password },
  })
  adminToken = loginResult.token ?? ''
})

afterAll(async () => {
  await payload.destroy()
})

beforeEach(() => {
  clearSentEmails()
})

describe('CRIT: invite lifecycle', () => {
  test('CRIT: admin creates an invite and the invitee receives the email', async () => {
    const email = uniqueEmail()

    const response = await runCreateInvite({ collection: 'users', email }, adminToken)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    // The invite document is persisted so it can later be looked up/expired/accepted.
    const { docs } = await payload.find({
      collection: 'plugin-invites',
      where: { email: { equals: email } },
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].status).toBe('pending')

    // The email was actually "received" (sent) with a working accept link.
    expect(sentEmails).toHaveLength(1)
    const [sentEmail] = sentEmails
    expect(sentEmail.to).toBe(email)
    expect(sentEmail.subject).toBe('You have been invited')
    expect(sentEmail.html).toContain(email)
    expect(sentEmail.text).toContain('/admin/invite-accept?token=')
  })

  test('CRIT: invitee can validate their invite token', async () => {
    const email = uniqueEmail()
    await runCreateInvite({ collection: 'users', email }, adminToken)
    const rawToken = extractTokenFromEmail()

    const response = await runValidateInvite(rawToken)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ collection: 'users', email })
  })

  test('CRIT: invitee accepts the invite and their account is created', async () => {
    const email = uniqueEmail()
    await runCreateInvite({ collection: 'users', data: { name: 'Jane Doe' }, email }, adminToken)
    const rawToken = extractTokenFromEmail()

    const response = await runAcceptInvite({ password: 'super-secret-1', token: rawToken })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })

    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].name).toBe('Jane Doe')

    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.status).toBe('accepted')
    expect(invite.usedAt).toBeTruthy()

    // The invitee can now log in with the password they set.
    const loginResult = await payload.login({
      collection: 'users',
      data: { email, password: 'super-secret-1' },
    })
    expect(loginResult.user.email).toBe(email)
  })
})

describe('createInvite endpoint', () => {
  test('CRIT: rejects unauthenticated requests', async () => {
    const response = await runCreateInvite({ collection: 'users', email: uniqueEmail() })
    expect(response.status).toBe(401)
    expect(sentEmails).toHaveLength(0)
  })

  test('rejects a request missing the email field', async () => {
    const response = await runCreateInvite({ collection: 'users' }, adminToken)
    expect(response.status).toBe(400)
  })

  test('rejects a request missing the collection field', async () => {
    const response = await runCreateInvite({ email: uniqueEmail() }, adminToken)
    expect(response.status).toBe(400)
  })

  test('rejects collections not enabled via the userCollections option', async () => {
    const response = await runCreateInvite(
      { collection: 'posts', email: uniqueEmail() },
      adminToken,
      { userCollections: ['users'] },
    )
    expect(response.status).toBe(400)
    expect(sentEmails).toHaveLength(0)
  })

  test('honors the inviteExpiryMs option', async () => {
    const email = uniqueEmail()
    const before = Date.now()

    await runCreateInvite({ collection: 'users', email }, adminToken, {
      inviteExpiryMs: 60_000,
      userCollections: ['users'],
    })

    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    const expiresAt = new Date(invite.expiresAt as string).getTime()

    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(expiresAt).toBeLessThan(before + 61_000)
  })

  test('honors custom email subject/html/text options and placeholders', async () => {
    const email = uniqueEmail()

    await runCreateInvite({ collection: 'users', data: { name: 'Ada' }, email }, adminToken, {
      email: {
        html: '<p>Hi {name} ({email}), go to {url}</p>',
        subject: 'Welcome {name}!',
        text: 'Hi {name}, go to {url}',
      },
      userCollections: ['users'],
    })

    const [sentEmail] = sentEmails
    const inviteUrl = sentEmail.text?.split('go to ')[1]
    expect(sentEmail.subject).toBe('Welcome Ada!')
    expect(sentEmail.html).toBe(`<p>Hi Ada (${email}), go to ${inviteUrl}</p>`)
    expect(sentEmail.text).toContain('Hi Ada, go to http')
  })
})

describe('validateInvite endpoint', () => {
  test('rejects requests missing a token', async () => {
    const response = await runValidateInvite()
    expect(response.status).toBe(400)
  })

  test('returns 404 for an unknown token', async () => {
    const response = await runValidateInvite('deadbeef'.repeat(8))
    expect(response.status).toBe(404)
  })

  test('returns 410 and marks the invite expired once past expiresAt', async () => {
    const email = uniqueEmail()
    const rawToken = 'expired-token-example'

    await payload.create({
      collection: 'plugin-invites',
      data: {
        collection: 'users',
        email,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'pending',
        tokenHash: hashToken(rawToken),
      },
    })

    const response = await runValidateInvite(rawToken)
    expect(response.status).toBe(410)

    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.status).toBe('expired')
  })

  test('returns 410 for an already-accepted invite', async () => {
    const email = uniqueEmail()
    await runCreateInvite({ collection: 'users', email }, adminToken)
    const rawToken = extractTokenFromEmail()

    await runAcceptInvite({ password: 'super-secret-1', token: rawToken })

    const response = await runValidateInvite(rawToken)
    expect(response.status).toBe(410)
  })
})

describe('acceptInvite endpoint', () => {
  test('rejects a request missing the token', async () => {
    const response = await runAcceptInvite({ password: 'super-secret-1' })
    expect(response.status).toBe(400)
  })

  test('rejects a request missing the password', async () => {
    const email = uniqueEmail()
    await runCreateInvite({ collection: 'users', email }, adminToken)
    const rawToken = extractTokenFromEmail()

    const response = await runAcceptInvite({ token: rawToken })
    expect(response.status).toBe(400)
  })

  test('returns 404 for an unknown token', async () => {
    const response = await runAcceptInvite({ password: 'super-secret-1', token: 'unknown-token' })
    expect(response.status).toBe(404)
  })

  test('returns 410 for an expired invite', async () => {
    const email = uniqueEmail()
    const rawToken = 'expired-accept-token'

    await payload.create({
      collection: 'plugin-invites',
      data: {
        collection: 'users',
        email,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        status: 'pending',
        tokenHash: hashToken(rawToken),
      },
    })

    const response = await runAcceptInvite({ password: 'super-secret-1', token: rawToken })
    expect(response.status).toBe(410)
  })

  test('returns 410 for an already-used invite', async () => {
    const email = uniqueEmail()
    await runCreateInvite({ collection: 'users', email }, adminToken)
    const rawToken = extractTokenFromEmail()

    await runAcceptInvite({ password: 'super-secret-1', token: rawToken })
    const response = await runAcceptInvite({ password: 'another-secret-2', token: rawToken })
    expect(response.status).toBe(410)
  })

  test('applies extra field data collected at invite time to the new user', async () => {
    const email = uniqueEmail()
    await runCreateInvite(
      { collection: 'users', data: { name: 'Grace Hopper' }, email },
      adminToken,
    )
    const rawToken = extractTokenFromEmail()

    await runAcceptInvite({ password: 'super-secret-1', token: rawToken })

    const user = (await payload.find({ collection: 'users', where: { email: { equals: email } } }))
      .docs[0]
    expect(user.name).toBe('Grace Hopper')
  })

  test('returns 422 when the account already exists', async () => {
    const email = uniqueEmail()
    await payload.create({ collection: 'users', data: { email, password: 'existing-pass-1' } })

    const rawToken = 'duplicate-email-token'
    await payload.create({
      collection: 'plugin-invites',
      data: {
        collection: 'users',
        email,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: 'pending',
        tokenHash: hashToken(rawToken),
      },
    })

    const response = await runAcceptInvite({ password: 'super-secret-1', token: rawToken })
    expect(response.status).toBe(422)
  })
})
