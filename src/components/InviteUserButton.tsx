'use client'

import { Banner, Button, Drawer, SelectInput, TextInput, useConfig, useModal } from '@payloadcms/ui'
import React, { useCallback, useMemo, useState } from 'react'

import type { InviteField } from '../types.js'

const DRAWER_SLUG = 'invite-user-drawer'
const baseClass = 'invite-user'

type AuthCollection = {
  labels?: { plural?: Record<string, string> | string }
  slug: string
}

export const InviteUserButton: React.FC = () => {
  const { config } = useConfig()
  const { closeModal, openModal } = useModal()

  const authCollections: AuthCollection[] = (config.collections ?? []).filter(
    (c) => Boolean(c.auth) && c.slug !== 'plugin-invites',
  )

  const inviteFields = useMemo<InviteField[]>(
    () => (config.admin?.custom?.['payload-invite']?.fields as InviteField[] | undefined) ?? [],
    [config.admin?.custom],
  )

  const [email, setEmail] = useState('')
  const [selectedCollection, setSelectedCollection] = useState<string>(
    authCollections[0]?.slug ?? 'users',
  )
  // Extra field values keyed by field name
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(inviteFields.map((f) => [f.name, ''])),
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const [successEmail, setSuccessEmail] = useState<null | string>(null)

  const setFieldValue = useCallback((name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const resetForm = useCallback(() => {
    setEmail('')
    setError(null)
    setSuccessEmail(null)
    setFieldValues(Object.fromEntries(inviteFields.map((f) => [f.name, ''])))
  }, [inviteFields])

  const handleOpen = useCallback(() => {
    openModal(DRAWER_SLUG)
  }, [openModal])

  const handleClose = useCallback(() => {
    closeModal(DRAWER_SLUG)
    setTimeout(resetForm, 300)
  }, [closeModal, resetForm])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setIsSubmitting(true)
      setError(null)

      try {
        const res = await fetch('/api/plugin-invites/create', {
          body: JSON.stringify({
            collection: selectedCollection,
            data: fieldValues,
            email,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })

        const result: { error?: string } = await res.json()

        if (!res.ok) {
          setError(result.error ?? 'Something went wrong')
          return
        }

        setSuccessEmail(email)
        setEmail('')
      } catch {
        setError('Network error. Please try again.')
      } finally {
        setIsSubmitting(false)
      }
    },
    [email, fieldValues, selectedCollection],
  )

  const handleInviteAnother = useCallback(() => {
    resetForm()
  }, [resetForm])

  const collectionOptions = useMemo(
    () =>
      authCollections.map((c) => {
        const rawLabel = c.labels?.plural
        const label =
          typeof rawLabel === 'string' ? rawLabel : c.slug.charAt(0).toUpperCase() + c.slug.slice(1)
        return { label, value: c.slug }
      }),
    [authCollections],
  )

  const collectionSelect = useMemo(() => {
    if (authCollections.length <= 1) {
      return null
    }

    return (
      <SelectInput
        label="Invite To"
        name="collection"
        onChange={(value) => {
          const nextValue = Array.isArray(value) ? value[0]?.value : value?.value
          if (typeof nextValue === 'string') {
            setSelectedCollection(nextValue)
          }
        }}
        options={collectionOptions}
        path="collection"
        readOnly={isSubmitting}
        value={selectedCollection}
      />
    )
  }, [authCollections.length, collectionOptions, isSubmitting, selectedCollection])

  return (
    <>
      <Button onClick={handleOpen}>Invite User</Button>

      <style>{`
        .${baseClass}-drawer .drawer__content {
          max-width: 30rem;
        }
        .${baseClass}__actions {
          display: flex;
          gap: var(--base);
          margin-top: var(--base);
        }
      `}</style>

      <Drawer className={`${baseClass}-drawer`} slug={DRAWER_SLUG}>
        {successEmail ? (
          <div className={`${baseClass}__success`}>
            <Banner type="success">
              Invitation sent to <strong>{successEmail}</strong>
            </Banner>
            <div className={`${baseClass}__actions`}>
              <Button onClick={handleInviteAnother}>Invite Another</Button>
              <Button buttonStyle="secondary" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <Banner type="error">{error}</Banner>}

            <div className="render-fields">
              {/* Email — always first */}
              <TextInput
                label="Email Address"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                path="email"
                readOnly={isSubmitting}
                required
                value={email}
              />

              {/* Extra fields from plugin config */}
              {inviteFields.map((field) => {
                const label =
                  field.label ?? field.name.charAt(0).toUpperCase() + field.name.slice(1)
                const value = fieldValues[field.name] ?? ''

                if (field.type === 'select' && field.options?.length) {
                  return (
                    <SelectInput
                      key={field.name}
                      label={label}
                      name={field.name}
                      onChange={(optionValue) => {
                        const nextValue = Array.isArray(optionValue)
                          ? optionValue[0]?.value
                          : optionValue?.value
                        if (typeof nextValue === 'string') {
                          setFieldValue(field.name, nextValue)
                        }
                      }}
                      options={field.options.map((opt) => ({ label: opt, value: opt }))}
                      path={field.name}
                      readOnly={isSubmitting}
                      required={field.required}
                      value={value}
                    />
                  )
                }

                return (
                  <TextInput
                    key={field.name}
                    label={label}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFieldValue(field.name, e.target.value)
                    }
                    path={field.name}
                    readOnly={isSubmitting}
                    required={field.required}
                    value={value}
                  />
                )
              })}

              {/* Collection selector — only shown when there are multiple targets */}
              {collectionSelect}
            </div>

            <div className={`${baseClass}__actions`}>
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Sending\u2026' : 'Send Invitation'}
              </Button>
              <Button buttonStyle="secondary" onClick={handleClose} type="button">
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Drawer>
    </>
  )
}
