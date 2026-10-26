import { payloadInvite } from '@ace-ams/payload-invite'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import { buildConfig } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { isAdmin } from './helpers/isAdmin.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    // A single-node replica set still supports transactions and avoids the
    // "InterruptedDueToReplStateChange" errors caused by elections in multi-node sets.
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 1,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URL = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname),
      },
    },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [
          { name: 'role', type: 'select', defaultValue: 'editor', options: ['admin', 'editor'] },
          {
            name: 'name',
            type: 'text',
            label: 'Full Name',
          },
          { name: 'practitioner', type: 'relationship', relationTo: 'practitioners' },
          {
            name: 'numericPractitioner',
            type: 'relationship',
            relationTo: 'numeric-practitioners',
          },
        ],
      },
      {
        slug: 'practitioners',
        access: { read: ({ req }) => (req.user ? { visible: { equals: true } } : false) },
        admin: { useAsTitle: 'name' },
        fields: [
          { name: 'name', type: 'text', required: true },
          { name: 'visible', type: 'checkbox', defaultValue: true },
        ],
      },
      {
        slug: 'numeric-practitioners',
        access: { read: ({ req }) => (req.user ? { visible: { equals: true } } : false) },
        admin: { useAsTitle: 'name' },
        fields: [
          { name: 'id', type: 'number', required: true },
          { name: 'name', type: 'text', required: true },
          { name: 'visible', type: 'checkbox', defaultValue: true },
        ],
      },
      {
        slug: 'posts',
        fields: [],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
    ],
    db: mongooseAdapter({
      ensureIndexes: true,
      url: process.env.DATABASE_URL || '',
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
      payloadInvite({
        access: { create: isAdmin },
        debug: true,
        fields: [
          {
            name: 'name',
            label: 'Full Name',
            required: true,
          },
          {
            name: 'role',
            type: 'select',
            options: [{ label: 'Administrator', value: 'admin' }, 'editor'],
          },
          { name: 'practitioner', type: 'relationship', relationTo: 'practitioners' },
          {
            name: 'numericPractitioner',
            type: 'relationship',
            relationTo: 'numeric-practitioners',
          },
        ],
        userCollections: ['users'],
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    serverURL: process.env.PAYLOAD_SERVER_URL || 'http://localhost:3000',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
