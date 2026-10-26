import type { Access, Payload } from 'payload'

import config from '@payload-config'
import crypto from 'node:crypto'
import { createPayloadRequest, getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { PayloadInviteConfig } from '../src/types.js'

import { InviteUserButtonServer } from '../src/components/InviteUserButtonServer.js'
import { acceptInviteEndpoint } from '../src/endpoints/acceptInvite.js'
import { createInviteEndpoint } from '../src/endpoints/createInvite.js'
import { validateInviteEndpoint } from '../src/endpoints/validateInvite.js'
import { devUser } from './helpers/credentials.js'
import { isAdmin } from './helpers/isAdmin.js'
import { clearSentEmails, sentEmails } from './helpers/testEmailAdapter.js'

vi.mock('../src/components/InviteUserButton.js', () => ({ InviteUserButton: () => null }))

let payload: Payload
let adminToken: string
let editorToken: string

// Matches the options registered in dev/payload.config.ts
const defaultPluginOptions: PayloadInviteConfig = {
  access: { create: isAdmin },
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

const runValidateInvite = async (
  token?: string,
  options: PayloadInviteConfig = defaultPluginOptions,
) => {
  const url = new URL('http://localhost:3000/api/plugin-invites/validate')
  if (token) {
    url.searchParams.set('token', token)
  }
  const request = new Request(url, { method: 'GET' })
  const payloadRequest = await createPayloadRequest({ config, request })
  return validateInviteEndpoint(options)(payloadRequest)
}

const runAcceptInvite = async (
  body?: unknown,
  options: PayloadInviteConfig = defaultPluginOptions,
) => {
  const request = jsonRequest('http://localhost:3000/api/plugin-invites/accept', body)
  const payloadRequest = await createPayloadRequest({ config, request })
  return acceptInviteEndpoint(options)(payloadRequest)
}

const renderInviteButton = async (
  token?: string,
  options: PayloadInviteConfig = defaultPluginOptions,
) => {
  const request = new Request('http://localhost:3000/admin/collections/users', {
    headers: token ? { Authorization: `JWT ${token}` } : {},
  })
  const req = await createPayloadRequest({ config, request })
  return InviteUserButtonServer({ options, payload, user: req.user ?? undefined })
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

  const editorEmail = uniqueEmail()
  await payload.create({
    collection: 'users',
    data: { email: editorEmail, password: 'editor-test', role: 'editor' },
  })
  const editorLogin = await payload.login({
    collection: 'users',
    data: { email: editorEmail, password: 'editor-test' },
  })
  editorToken = editorLogin.token ?? ''
})

afterAll(async () => {
  await payload.destroy()
})

beforeEach(() => {
  clearSentEmails()
})

describe('invitation permission', () => {
  const deniedPolicies: { label: string; options: PayloadInviteConfig }[] = [
    { label: 'missing access', options: {} },
    { label: 'missing create', options: { access: {} } },
    { label: 'false', options: { access: { create: () => false } } },
    {
      label: 'query constraint',
      options: { access: { create: () => ({ role: { equals: 'admin' } }) } },
    },
    {
      label: 'synchronous failure',
      options: {
        access: {
          create: () => {
            throw new Error('policy failed')
          },
        },
      },
    },
    {
      label: 'asynchronous failure',
      options: { access: { create: () => Promise.reject(new Error('policy failed')) } },
    },
  ]

  test.each(deniedPolicies)(
    '$label denies creation and the UI permission check without side effects',
    async ({ options }) => {
      const email = uniqueEmail()
      const response = await runCreateInvite(
        { collection: 'users', data: { role: 'admin' }, email },
        adminToken,
        options,
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
      expect(sentEmails).toHaveLength(0)
      expect(
        (await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } }))
          .docs,
      ).toHaveLength(0)

      expect(await renderInviteButton(adminToken, options)).toBeNull()
    },
  )

  test('requires authentication even if the application policy allows everyone', async () => {
    const options: PayloadInviteConfig = { access: { create: () => true } }
    const email = uniqueEmail()
    expect((await runCreateInvite({ collection: 'users', email }, undefined, options)).status).toBe(
      401,
    )
    expect(await renderInviteButton(undefined, options)).toBeNull()
    expect(sentEmails).toHaveLength(0)
    expect(
      (await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } }))
        .docs,
    ).toHaveLength(0)
  })

  test('the application admin policy denies authenticated editors', async () => {
    const email = uniqueEmail()
    const response = await runCreateInvite({ collection: 'users', email }, editorToken)
    expect(response.status).toBe(403)
    expect(sentEmails).toHaveLength(0)
    expect(
      (await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } }))
        .docs,
    ).toHaveLength(0)
    expect(await renderInviteButton(editorToken)).toBeNull()
    expect(await renderInviteButton(adminToken)).not.toBeNull()
  })

  test('the server wrapper awaits a user-based policy without proposed invitation data', async () => {
    let calls = 0
    expect(
      await renderInviteButton(adminToken, {
        access: {
          create: ({ data, req }) => {
            calls++
            expect(data).toBeUndefined()
            expect(req.payload).toBe(payload)
            expect(req.user?.email).toBe(devUser.email)
            return Promise.resolve(true)
          },
        },
      }),
    ).not.toBeNull()
    expect(calls).toBe(1)
  })

  test.each([false, true])(
    'supports async=%s and provides the actual request and invitation data',
    async (asyncPolicy) => {
      const email = uniqueEmail()
      const body = { collection: 'users', data: { role: 'editor' }, email }
      const request = await createPayloadRequest({
        config,
        request: jsonRequest('http://localhost:3000/api/plugin-invites/create', body, adminToken),
      })
      let calls = 0
      const create: Access = ({ data, req }) => {
        calls++
        expect(req).toBe(request)
        expect(req.user?.collection).toBe('users')
        expect(req.user?.email).toBe(devUser.email)
        expect(data).toEqual(body)
        return asyncPolicy ? Promise.resolve(true) : true
      }
      const response = await createInviteEndpoint({ access: { create } })(request)
      expect(response.status).toBe(200)
      expect(calls).toBe(1)
      expect(sentEmails).toHaveLength(1)
      const invite = (
        await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
      ).docs[0]
      expect(invite.data).toEqual({ role: 'editor' })
    },
  )

  test('direct collection access cannot read, forge, alter, or delete invites even as an admin', async () => {
    const email = uniqueEmail()
    expect(
      (await runCreateInvite({ collection: 'users', data: { role: 'editor' }, email }, adminToken))
        .status,
    ).toBe(200)
    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    const req = await createPayloadRequest({
      config,
      request: jsonRequest('http://localhost:3000/api/plugin-invites', {}, adminToken),
    })
    const options = { collection: 'plugin-invites' as const, overrideAccess: false, req }
    const forgedEmail = uniqueEmail()
    await expect(
      payload.create({
        ...options,
        data: {
          collection: 'users',
          data: { role: 'admin' },
          email: forgedEmail,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          tokenHash: hashToken('forged'),
        },
      }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      payload.update({ ...options, id: invite.id, data: { data: { role: 'admin' } } }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(payload.delete({ ...options, id: invite.id })).rejects.toMatchObject({
      status: 403,
    })
    await expect(payload.findByID({ ...options, id: invite.id })).rejects.toMatchObject({
      status: 403,
    })
    const stored = await payload.findByID({ id: invite.id, collection: 'plugin-invites' })
    expect(stored.data).toEqual({ role: 'editor' })
    expect(
      (
        await payload.find({
          collection: 'plugin-invites',
          where: { email: { equals: forgedEmail } },
        })
      ).docs,
    ).toHaveLength(0)
    expect(sentEmails).toHaveLength(1)
  })

  test('public acceptance uses stored recipient data and ignores attempted overrides', async () => {
    const email = uniqueEmail()
    expect(
      (await runCreateInvite({ collection: 'users', data: { role: 'editor' }, email }, adminToken))
        .status,
    ).toBe(200)
    const token = extractTokenFromEmail()
    expect((await runValidateInvite(token)).status).toBe(200)
    const response = await runAcceptInvite(
      {
        collection: 'posts',
        data: { email: 'attacker@example.com', role: 'admin' },
        email: 'attacker@example.com',
        password: 'super-secret-1',
        role: 'admin',
        token,
      },
      { access: { create: () => false } },
    )
    expect(response.status).toBe(200)
    const user = (await payload.find({ collection: 'users', where: { email: { equals: email } } }))
      .docs[0]
    expect(user.email).toBe(email)
    expect(user.role).toBe('editor')
    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.status).toBe('accepted')
  })
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
    expect(loginResult.user?.email).toBe(email)
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
      { access: { create: isAdmin }, userCollections: ['users'] },
    )
    expect(response.status).toBe(400)
    expect(sentEmails).toHaveLength(0)
  })

  test('honors the inviteExpiryMs option', async () => {
    const email = uniqueEmail()
    const before = Date.now()

    await runCreateInvite({ collection: 'users', email }, adminToken, {
      access: { create: isAdmin },
      inviteExpiryMs: 60_000,
      userCollections: ['users'],
    })

    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    const expiresAt = new Date(invite.expiresAt).getTime()

    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(expiresAt).toBeLessThan(before + 61_000)
  })

  test('honors custom email subject/html/text options and placeholders', async () => {
    const email = uniqueEmail()

    await runCreateInvite({ collection: 'users', data: { name: 'Ada' }, email }, adminToken, {
      access: { create: isAdmin },
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

describe('relationship invite fields', () => {
  const relationshipOptions: PayloadInviteConfig = {
    access: { create: isAdmin },
    email: { subject: 'Practitioners: {practitioner}, {numericPractitioner}' },
    fields: [
      { name: 'practitioner', type: 'relationship', relationTo: 'practitioners' },
      { name: 'numericPractitioner', type: 'relationship', relationTo: 'numeric-practitioners' },
    ],
  }

  test('preserves string and numeric IDs through JSON storage and user creation', async () => {
    const practitioner = await payload.create({
      collection: 'practitioners',
      data: { name: 'Ada' },
    })
    const numericPractitioner = await payload.create({
      collection: 'numeric-practitioners',
      data: { id: 42, name: 'Grace' },
    })
    expect(typeof practitioner.id).toBe('string')
    expect(typeof numericPractitioner.id).toBe('number')

    const email = uniqueEmail()
    const data = { numericPractitioner: numericPractitioner.id, practitioner: practitioner.id }
    const response = await runCreateInvite(
      { collection: 'users', data, email },
      adminToken,
      relationshipOptions,
    )
    expect(response.status).toBe(200)
    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.data).toEqual(data)
    expect(sentEmails.at(-1)?.subject).toBe(`Practitioners: ${practitioner.id}, 42`)

    const accepted = await runAcceptInvite(
      { password: 'super-secret-1', token: extractTokenFromEmail() },
      relationshipOptions,
    )
    expect(accepted.status).toBe(200)
    const user = (
      await payload.find({ collection: 'users', depth: 0, where: { email: { equals: email } } })
    ).docs[0]
    expect(user.practitioner).toBe(practitioner.id)
    expect(user.numericPractitioner).toBe(42)
  })

  test.each([undefined, null, ''])('omits optional empty relationships (%s)', async (value) => {
    const email = uniqueEmail()
    const response = await runCreateInvite(
      { collection: 'users', data: { practitioner: value }, email },
      adminToken,
      relationshipOptions,
    )
    expect(response.status).toBe(200)
    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.data).toEqual({})
    const accepted = await runAcceptInvite(
      { password: 'super-secret-1', token: extractTokenFromEmail() },
      relationshipOptions,
    )
    expect(accepted.status).toBe(200)
    const user = (
      await payload.find({ collection: 'users', depth: 0, where: { email: { equals: email } } })
    ).docs[0]
    expect(user.practitioner == null).toBe(true)
  })

  test.each([
    [],
    ['id'],
    {},
    { relationTo: 'practitioners', value: 'id' },
    true,
    '   ',
    'invalid-id',
    '000000000000000000000000',
  ])('rejects invalid relationship selections (%j)', async (value) => {
    const email = uniqueEmail()
    const response = await runCreateInvite(
      { collection: 'users', data: { practitioner: value }, email },
      adminToken,
      relationshipOptions,
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('practitioner')
    expect(sentEmails).toHaveLength(0)
    expect(
      (await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } }))
        .docs,
    ).toHaveLength(0)
  })

  test('rejects a document hidden from the authenticated inviter by read access', async () => {
    const hidden = await payload.create({
      collection: 'practitioners',
      data: { name: 'Hidden', visible: false },
    })
    const response = await runCreateInvite(
      { collection: 'users', data: { practitioner: hidden.id }, email: uniqueEmail() },
      adminToken,
      relationshipOptions,
    )
    expect(response.status).toBe(400)
    expect(sentEmails).toHaveLength(0)
  })

  test('rejects an empty required relationship', async () => {
    const response = await runCreateInvite(
      { collection: 'users', data: { practitioner: '' }, email: uniqueEmail() },
      adminToken,
      {
        access: { create: isAdmin },
        fields: [
          {
            name: 'practitioner',
            type: 'relationship',
            relationTo: 'practitioners',
            required: true,
          },
        ],
      },
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'practitioner is required' })
  })

  test('returns a useful validation error and leaves the invite pending if a related document is deleted', async () => {
    const practitioner = await payload.create({
      collection: 'practitioners',
      data: { name: 'Temporary' },
    })
    const email = uniqueEmail()
    expect(
      (
        await runCreateInvite(
          { collection: 'users', data: { practitioner: practitioner.id }, email },
          adminToken,
          relationshipOptions,
        )
      ).status,
    ).toBe(200)
    const token = extractTokenFromEmail()
    await payload.delete({ id: practitioner.id, collection: 'practitioners' })
    const response = await runAcceptInvite(
      { password: 'super-secret-1', token },
      relationshipOptions,
    )
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain('practitioner')
    const invite = (
      await payload.find({ collection: 'plugin-invites', where: { email: { equals: email } } })
    ).docs[0]
    expect(invite.status).toBe('pending')
  })
})
