import { expect, test } from '@playwright/test'

import { devUser } from './helpers/credentials.js'

// this is an example Playwright e2e test
test('should render admin panel logo', async ({ page }) => {
  await page.goto('/admin')

  // login
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')

  // should show dashboard
  await expect(page).toHaveTitle(/Dashboard/)
  await expect(page.locator('.graphic-icon')).toBeVisible()
})

test('native invite relationships show titles, search, clear, and submit typed IDs', async ({
  page,
}) => {
  await page.goto('/admin')
  await page.fill('#field-email', devUser.email)
  await page.fill('#field-password', devUser.password)
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/)

  await page.route('**/api/practitioners**', (route) =>
    route.fulfill({
      json: { docs: [{ id: 'practitioner-ada', name: 'Dr Ada' }], hasNextPage: false },
    }),
  )
  await page.route('**/api/numeric-practitioners**', (route) =>
    route.fulfill({
      json: { docs: [{ id: 42, name: 'Dr Grace' }], hasNextPage: false },
    }),
  )
  await page.goto('/admin/collections/users')
  await page.getByRole('button', { name: 'Invite User', exact: true }).click()
  const drawer = page.locator('.invite-user-drawer')
  await drawer.locator('#field-email').fill('native-relationship@example.com')
  await drawer.locator('#field-name').fill('Native User')

  const practitioner = drawer.locator('#field-practitioner')
  await practitioner.getByRole('combobox').fill('Ada')
  await page.getByRole('option', { name: 'Dr Ada', exact: true }).click()
  await expect(practitioner).toContainText('Dr Ada')
  await practitioner.locator('.clear-indicator').click()
  await expect(practitioner).not.toContainText('Dr Ada')
  await practitioner.getByRole('combobox').fill('Ada')
  await page.getByRole('option', { name: 'Dr Ada', exact: true }).click()

  const numeric = drawer.locator('#field-numericPractitioner')
  await numeric.getByRole('combobox').fill('Grace')
  await page.getByRole('option', { name: 'Dr Grace', exact: true }).click()
  const requestPromise = page.waitForRequest('**/api/plugin-invites/create')
  await page.route('**/api/plugin-invites/create', (route) =>
    route.fulfill({ json: { success: true } }),
  )
  await drawer.getByRole('button', { name: 'Send Invitation' }).click()
  const request = await requestPromise
  expect(request.postDataJSON()).toMatchObject({
    data: { numericPractitioner: 42, practitioner: 'practitioner-ada' },
  })
  await expect(drawer).toContainText('Invitation sent to')

  await drawer.getByRole('button', { name: 'Invite Another' }).click()
  await page.route('**/api/practitioners**', (route) =>
    route.fulfill({ json: { error: 'Lookup failed' }, status: 500 }),
  )
  await drawer.locator('#field-practitioner').getByRole('combobox').click()
  await expect(drawer.locator('.relationship__error-loading')).toBeVisible()
})

test('server rendering omits the invite button for editors and the endpoint independently denies them', async ({
  page,
}) => {
  const login = await page.request.post('/api/users/login', {
    data: { email: devUser.email, password: devUser.password },
  })
  const adminLogin: { token: string } = await login.json()
  const adminHeaders = { Authorization: `JWT ${adminLogin.token}` }
  const editorEmail = `editor-${Date.now()}@example.com`
  const created = await page.request.post('/api/users', {
    data: { email: editorEmail, password: 'editor-test', role: 'editor' },
    headers: adminHeaders,
  })
  expect(created.status()).toBe(201)

  // Direct REST collection access is closed even for an authorized inviter.
  const forged = await page.request.post('/api/plugin-invites', {
    data: {
      collection: 'users',
      data: { role: 'admin' },
      email: `forged-${Date.now()}@example.com`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      tokenHash: 'forged-token-hash',
    },
    headers: adminHeaders,
  })
  expect(forged.status()).toBe(403)
  expect((await page.request.get('/api/plugin-invites', { headers: adminHeaders })).status()).toBe(
    403,
  )

  const editorResponse = await page.request.post('/api/users/login', {
    data: { email: editorEmail, password: 'editor-test' },
  })
  const editorLogin: { token: string } = await editorResponse.json()
  const permissionRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/plugin-invites/permissions')) {
      permissionRequests.push(request.url())
    }
  })
  const response = await page.goto('/admin/collections/users')
  const button = page.getByRole('button', { name: 'Invite User', exact: true })
  await expect(button).toBeHidden()
  expect(await response?.text()).not.toContain('Invite User')
  expect(permissionRequests).toHaveLength(0)
  const creation = await page.request.post('/api/plugin-invites/create', {
    data: {
      collection: 'users',
      data: { role: 'admin' },
      email: `blocked-${Date.now()}@example.com`,
    },
    headers: { Authorization: `JWT ${editorLogin.token}` },
  })
  expect(creation.status()).toBe(403)
  expect(await creation.json()).toEqual({ error: 'Forbidden' })
})
