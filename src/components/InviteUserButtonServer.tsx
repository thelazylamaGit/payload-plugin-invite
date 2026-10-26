import type { AfterListTableServerProps } from 'payload'

import { createLocalReq } from 'payload'
import React from 'react'

import type { PayloadInviteConfig } from '../types.js'

import { canCreateInvite } from '../access/canCreateInvite.js'
import { InviteUserButton } from './InviteUserButton.js'

type Props = {
  options: Pick<PayloadInviteConfig, 'access' | 'disabled'>
} & Pick<AfterListTableServerProps, 'locale' | 'payload' | 'user'>

export const InviteUserButtonServer = async ({ locale, options, payload, user }: Props) => {
  if (!user) {
    return null
  }

  // Payload's list slots provide the authenticated user and Payload instance, not an HTTP req.
  // Build a supported local request for this user-based visibility check.
  const req = await createLocalReq({ locale: locale?.code, user }, payload)
  if (!(await canCreateInvite(options, req))) {
    return null
  }

  return <InviteUserButton />
}
