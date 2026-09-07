import type { EmailAdapter, SendEmailOptions } from 'payload'

/**
 * All emails sent through `testEmailAdapter` during the process lifetime.
 * Tests can inspect this to assert an email was "received" and clear it between runs.
 */
export const sentEmails: SendEmailOptions[] = []

export const clearSentEmails = () => {
  sentEmails.length = 0
}

/**
 * Logs all emails to stdout and records them in `sentEmails` for assertions in tests.
 */
export const testEmailAdapter: EmailAdapter<void> = ({ payload }) => ({
  name: 'test-email-adapter',
  defaultFromAddress: 'dev@payloadcms.com',
  defaultFromName: 'Payload Test',
  sendEmail: async (message) => {
    sentEmails.push(message)
    const stringifiedTo = getStringifiedToAddress(message)
    const res = `Test email to: '${stringifiedTo}', Subject: '${message.subject}'`
    payload.logger.info({ content: message, msg: res })
    return Promise.resolve()
  },
})

function getStringifiedToAddress(message: SendEmailOptions): string | undefined {
  let stringifiedTo: string | undefined

  if (typeof message.to === 'string') {
    stringifiedTo = message.to
  } else if (Array.isArray(message.to)) {
    stringifiedTo = message.to
      .map((to: { address: string } | string) => {
        if (typeof to === 'string') {
          return to
        } else if (to.address) {
          return to.address
        }
        return ''
      })
      .join(', ')
  } else if (message.to?.address) {
    stringifiedTo = message.to.address
  }
  return stringifiedTo
}
