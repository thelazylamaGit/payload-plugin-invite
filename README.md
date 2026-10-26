# payload-invite

A [Payload CMS](https://payloadcms.com) plugin that lets admins invite users by email. Instead of creating accounts with a password directly, an invitation email is sent and the user sets their own password by following a secure, time-limited link.

---

## How it works

1. An admin clicks **Invite User** from any user collection list view and enters an email address.
2. The plugin creates a signed invite record and sends an email with a unique link.
3. The user visits the link (served inside the Payload admin at `/admin/invite-accept`) and sets their password.
4. The account is created and the invite is marked as used.

Tokens are never stored in plain text — only a SHA-256 hash is persisted. Each token is single-use and expires after 48 hours by default.

---

## Installation

```bash
npm install @ace-ams/payload-invite
# or
pnpm add @ace-ams/payload-invite
```

---

## Setup

Add the plugin to your `payload.config.ts`:

```ts
import { buildConfig } from 'payload'
import { payloadInvite } from '@ace-ams/payload-invite'
import { isAdmin } from './access/isAdmin'

export default buildConfig({
  plugins: [
    payloadInvite({
      access: { create: isAdmin },
      userCollections: ['users'],
    }),
  ],
  // ...rest of your config
})
```

That's it. The plugin will:

- Show an **Invite User** button to permitted users in the list view of every collection you specify.
- Register a hidden `plugin-invites` collection to store pending invites.
- Mount the accept-invite page at `/admin/invite-accept` (no extra Next.js pages needed).
- Send invite emails through whatever email adapter you have configured in Payload.

> **Note:** Make sure `serverURL` is set in your Payload config so the invite links in emails are fully qualified (e.g. `https://example.com/admin/invite-accept?token=…`).

> **Breaking change:** Sending invitations is now denied by default. Existing consumers must explicitly configure `access.create` to enable invitations; being authenticated alone no longer grants permission. Existing invitation links still work.

---

## Options

```ts
payloadInvite({
  /** Application-owned Payload Access function. Defaults to deny. */
  access: { create: isAdmin },
  /**
   * Which auth-enabled collections users can be invited to.
   * Defaults to ['users'].
   */
  userCollections: ['users', 'admins'],

  /**
   * How long an invite link stays valid, in milliseconds.
   * Defaults to 48 hours.
   */
  inviteExpiryMs: 72 * 60 * 60 * 1000, // 72 hours

  /**
   * Customise the invite email. See the Email section below.
   */
  email: { ... },

  /**
   * Set to true to disable all plugin behaviour while keeping
   * the plugin-invites collection in the database schema.
   */
  disabled: false,
})
```

---

## Permission to send invitations

Reuse an application-owned Payload `Access` function. For example, if your application's generated user type has a `role` field:

```ts
// access/isAdmin.ts — part of your application
import type { Access } from 'payload'

export const isAdmin: Access = ({ req }) => req.user?.role === 'admin'
```

```ts
import { payloadInvite } from '@ace-ams/payload-invite'
import { isAdmin } from './access/isAdmin'

payloadInvite({
  access: { create: isAdmin },
})
```

Both synchronous and asynchronous access functions are supported. An unauthenticated creation request receives `401`. For an authenticated caller, **only literal `true` grants permission**: `false`, query constraints such as `{ role: { equals: 'admin' } }`, an omitted policy, or a thrown/rejected evaluation deny creation with `403`. Sending an invitation is an action, so query constraints do not authorize it.

The create endpoint evaluates the policy with the actual Payload `req` and proposed invitation `data: { collection, email, data }`, where the inner `data` contains extra field values. This happens before relationship lookups, invite persistence, or email delivery.

Use a **user-based policy**, such as an admin check. A React Server Component registered as `afterListTable` checks the same server policy **without proposed invitation data**, using Payload's supported local request built from the authenticated admin user and server context. It returns `null` when denied or policy evaluation fails; otherwise it renders the client button and drawer. Permission is resolved before the button is included, with no permission fetch after mounting. Access functions remain in component `serverProps` and are never passed to the client. Creation independently rechecks permission with the actual HTTP request. Data-dependent UI authorization is not supported.

After upgrading, regenerate your admin import map (`payload generate:importmap`) to register the new server wrapper.

This permission allows sending invitations with the configured fields, **including selecting a recipient's role**. Grant it only to trusted users. The plugin does not infer permission from the target user collection, implement role hierarchies, or apply per-recipient role policies. Keep `access.create` configured alongside the individual options shown in the examples below.

Direct external creation, reads, updates, and deletion of `plugin-invites` records are denied, including for authorized inviters and in debug mode. The plugin's internal operations manage records through the invite endpoints. Public token validation and acceptance remain available; acceptance uses the stored target collection, email, and extra data, accepting only the recipient's token and password from the request.

---

## Email customisation

The plugin ships with a default HTML email template. You can override the subject, HTML body, text body, or any combination of them via the `email` option.

### Available placeholders

| Placeholder | Replaced with                                                               |
| ----------- | --------------------------------------------------------------------------- |
| `{url}`     | The full invite URL, e.g. `https://example.com/admin/invite-accept?token=…` |
| `{email}`   | The email address of the person being invited                               |

### Overriding just the subject

```ts
payloadInvite({
  email: {
    subject: 'You have been invited to join Acme',
  },
})
```

### Overriding subject, HTML, and plain text

```ts
payloadInvite({
  email: {
    subject: 'Your invite to Acme is ready',
    html: `
      <p>Hi {email},</p>
      <p>You have been invited. <a href="{url}">Click here</a> to set your password.</p>
      <p>Or copy this link: {url}</p>
    `,
    text: `Hi {email},\n\nAccept your invite here: {url}`,
  },
})
```

Any field you omit falls back to the built-in default. You do not need to provide all three.

---

## Extra fields

You can collect additional information when sending an invite — for example a name or a role. Those values are stored with the invite and written directly onto the user document when the account is created. Each field name is also available as a placeholder in your email templates.

```ts
payloadInvite({
  userCollections: ['users'],
  fields: [
    {
      name: 'name',
      label: 'Full Name',
      required: true,
    },
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      options: ['editor', 'viewer'],
    },
  ],
})
```

The admin will see these inputs in the **Invite User** drawer, below the email field. On account creation the values are spread onto the user document, so `name: 'Jane'` will set the `name` field on the `users` collection document.

### Select option labels and readonly arrays

Select options use Payload's native `Option` type: strings, `{ label, value }` objects, or a mixture of both. Object options display their label while submitting and storing their internal string value:

```ts
type Role = 'admin' | 'editor' | 'practitioner'

const roleOptions: { label: string; value: Role }[] = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Practitioner', value: 'practitioner' },
]

payloadInvite({
  access: { create: isAdmin },
  fields: [{ name: 'role', type: 'select', options: roleOptions }],
})
```

Select options accept both mutable arrays and readonly tuples, including arrays declared with `as const`:

```ts
const roles = ['admin', 'editor', 'practitioner'] as const

payloadInvite({
  fields: [{ name: 'role', type: 'select', options: roles }],
})
```

### Relationship fields

Use a relationship field to select one document from one collection:

```ts
payloadInvite({
  userCollections: ['users'],
  fields: [
    {
      name: 'practitioner',
      label: 'Practitioner',
      type: 'relationship',
      relationTo: 'practitioners',
    },
  ],
})
```

Define the corresponding field on your user collection as a real Payload relationship:

```ts
{
  slug: 'users',
  auth: true,
  fields: [
    { name: 'practitioner', type: 'relationship', relationTo: 'practitioners' },
  ],
}
```

The drawer uses Payload's native relationship input, with searchable, paginated results and titles from the related collection's `admin.useAsTitle`. It submits document IDs, preserving numbers and strings. An optional selection can be cleared; empty values (`null`, `''`, or an omitted value) are left unset on the invite and user.

Lookup HTTP errors use Payload's native error display. Network-level fetch failures follow the installed `@payloadcms/ui` version's behavior; some versions do not surface these failures in the input.

Lookups respect the logged-in inviter's Payload read access. Invite creation also validates each relationship ID and checks that the inviter can read the selected document. Creation requires an authenticated inviter allowed by `access.create` and a target in `userCollections`. On acceptance, the plugin rechecks document existence and lets Payload validate the user document; an invalid or deleted relationship returns an error and leaves the invite pending.

Only single-collection, single-document relationships are supported. Polymorphic (`relationTo: [...]`) and `hasMany` relationships are not supported. The plugin does not add or change fields on your user collection.

### Field options

| Option       | Type                                   | Default    | Description                                                                                       |
| ------------ | -------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `name`       | `string`                               | —          | **Required.** Must match the field name on the user collection.                                   |
| `label`      | `string`                               | Field name | Label shown in the invite form.                                                                   |
| `type`       | `'text' \| 'select' \| 'relationship'` | `'text'`   | Input type rendered in the form.                                                                  |
| `options`    | `readonly Option[]`                    | —          | Payload select options: strings or label/value objects. Mutable and readonly arrays are accepted. |
| `relationTo` | `CollectionSlug`                       | —          | **Required** for `type: 'relationship'`. One collection slug.                                     |
| `required`   | `boolean`                              | `false`    | Prevents the form from submitting if left empty.                                                  |

### Using field values in email templates

Every field name is automatically available as a placeholder alongside `{url}` and `{email}`:

Relationship placeholders render the selected document ID as text, rather than its title. Numeric IDs remain numbers in stored invite data and in the created user document.

```ts
payloadInvite({
  fields: [{ name: 'name', label: 'Full Name' }],
  email: {
    subject: 'Hi {name}, your invitation is ready',
    html: '<p>Hi {name},</p><p><a href="{url}">Click here</a> to set your password.</p>',
    text: 'Hi {name},\n\nAccept your invite here: {url}',
  },
})
```

---

## API endpoints

The plugin registers three endpoints on the `plugin-invites` collection (paths shown with the default API route):

| Method | Path                                   | Auth     | Description                                           |
| ------ | -------------------------------------- | -------- | ----------------------------------------------------- |
| `POST` | `/api/plugin-invites/create`           | Required | Creates an invite and sends the email                 |
| `GET`  | `/api/plugin-invites/validate?token=…` | None     | Validates a token and returns the associated email    |
| `POST` | `/api/plugin-invites/accept`           | None     | Creates the user account and marks the invite as used |

---

## Requirements

- Payload `^3.37.0`
- An [email adapter](https://payloadcms.com/docs/email/overview) configured in Payload (nodemailer, Resend, etc.)
- `serverURL` set in your Payload config
