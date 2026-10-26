import type { Access } from 'payload'

import { payloadInvite } from '../src/index.js'

const applicationAccess: Access = ({ req }) => Boolean(req.user)
payloadInvite({ access: { create: applicationAccess } })

const roles = ['admin', 'editor', 'practitioner'] as const
const mutableRoles = ['admin', 'editor']

payloadInvite({
  fields: [
    { name: 'name' },
    { name: 'name', type: 'text', required: true },
    { name: 'role', type: 'select', options: roles },
    { name: 'role', type: 'select', options: mutableRoles },
    { name: 'role', type: 'select' },
    { name: 'practitioner', type: 'relationship', relationTo: 'practitioners' },
  ],
})

payloadInvite({
  fields: [
    // @ts-expect-error Relationships require a target collection.
    { name: 'practitioner', type: 'relationship' },
    // @ts-expect-error Polymorphic relationships are not supported.
    { name: 'practitioner', type: 'relationship', relationTo: ['practitioners'] },
    // @ts-expect-error Multiple selections are not supported.
    { name: 'practitioner', type: 'relationship', hasMany: true, relationTo: 'practitioners' },
    // @ts-expect-error The target must be a Payload CollectionSlug.
    { name: 'practitioner', type: 'relationship', relationTo: 'missing-collection' },
  ],
})
