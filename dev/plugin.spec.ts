import type { CollectionConfig, Config } from 'payload'

import { describe, expect, test } from 'vitest'

import { payloadInvite } from '../src/index.js'

const makeCollection = (slug: string): CollectionConfig => ({ slug, fields: [] })

const makeConfig = (collections: string[] = ['users']): Config =>
  ({
    collections: collections.map(makeCollection),
  }) as Config

describe('payloadInvite plugin options', () => {
  test('CRIT: defaults userCollections to ["users"] and adds the invite button there', () => {
    const config = payloadInvite()(makeConfig(['users', 'posts']))

    const users = config.collections?.find((c) => c.slug === 'users')
    const posts = config.collections?.find((c) => c.slug === 'posts')

    expect(users?.admin?.components?.afterListTable).toContainEqual(
      expect.objectContaining({ path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer' }),
    )
    expect(posts?.admin?.components?.afterListTable ?? []).not.toContainEqual(
      expect.objectContaining({ path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer' }),
    )
  })

  test('userCollections option adds the invite button only to the specified collections', () => {
    const config = payloadInvite({ userCollections: ['posts'] })(makeConfig(['users', 'posts']))

    const users = config.collections?.find((c) => c.slug === 'users')
    const posts = config.collections?.find((c) => c.slug === 'posts')

    expect(users?.admin?.components?.afterListTable ?? []).not.toContainEqual(
      expect.objectContaining({ path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer' }),
    )
    expect(posts?.admin?.components?.afterListTable).toContainEqual(
      expect.objectContaining({ path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer' }),
    )
  })

  test('silently skips a configured collection that does not exist', () => {
    // @ts-expect-error - testing invalid config
    const config = payloadInvite({ userCollections: ['missing-collection'] })(makeConfig(['users']))

    expect(config.collections).toHaveLength(2) // original + plugin-invites
  })

  test('fields option is exposed via config.admin.custom for the client button to read', () => {
    const fields = [{ name: 'name', label: 'Full Name', required: true }]
    const config = payloadInvite({ fields })(makeConfig())

    expect(config.admin?.custom?.['payload-invite']).toEqual({ fields })
  })

  test('defaults to an empty fields array when none is provided', () => {
    const config = payloadInvite()(makeConfig())

    expect(config.admin?.custom?.['payload-invite']).toEqual({ fields: [] })
  })

  test('keeps the access policy out of client configuration', () => {
    const create = () => true
    const config = payloadInvite({ access: { create } })(makeConfig())
    expect(config.admin?.custom?.['payload-invite']).toEqual({ fields: [] })
    expect(
      config.collections?.find((collection) => collection.slug === 'users')?.admin?.components
        ?.afterListTable,
    ).toContainEqual({
      path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer',
      serverProps: { options: { access: { create }, disabled: undefined } },
    })
  })

  test('always registers the plugin-invites collection to keep the DB schema consistent', () => {
    const enabled = payloadInvite()(makeConfig())
    const disabled = payloadInvite({ disabled: true })(makeConfig())

    expect(enabled.collections?.some((c) => c.slug === 'plugin-invites')).toBe(true)
    expect(disabled.collections?.some((c) => c.slug === 'plugin-invites')).toBe(true)
  })

  test('CRIT: registers the invite-accept admin view when enabled', () => {
    const config = payloadInvite()(makeConfig())

    expect(config.admin?.components?.views?.['invite-accept']).toEqual({
      Component: '@ace-ams/payload-invite/rsc#AcceptInviteView',
      exact: true,
      path: '/invite-accept',
    })
  })

  test('disabled option skips the admin view and invite button registration', () => {
    const config = payloadInvite({ disabled: true })(makeConfig(['users']))

    expect(config.admin?.components?.views?.['invite-accept']).toBeUndefined()
    const users = config.collections?.find((c) => c.slug === 'users')
    expect(users?.admin?.components?.afterListTable ?? []).not.toContainEqual(
      expect.objectContaining({ path: '@ace-ams/payload-invite/rsc#InviteUserButtonServer' }),
    )
  })
})
