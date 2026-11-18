import assert from 'node:assert/strict'
import test from 'node:test'
import { createJobNotificationSender } from '../job-notifications.js'

const job = {
  id: 12,
  title: 'Frontend Engineer',
  type: 'Full-time',
  location: 'Remote',
  description: 'Build accessible web apps.',
  requirements: 'React experience',
}
const jobUrl = 'https://skillorbit.example/dashboard/jobs'

test('emails all recipients, including unverified accounts', async () => {
  const emailRequests = []
  const send = createJobNotificationSender({
    sendGridApiKey: 'test-sendgrid-key',
    mailFrom: 'SkillOrbit <jobs@example.test>',
    fetchImpl: async (url, options) => {
      emailRequests.push({ url, options })
      return { ok: true, status: 202 }
    },
    logger: { error: assert.fail },
  })

  const summary = await send({
    recipients: [
      { email: 'student@example.test', profile: { fullName: 'Taylor' } },
      { email: 'another-student@example.test', profile: {} },
      { email: 'unverified@example.test', emailVerified: false, profile: { fullName: 'Pending Student' } },
    ],
    job,
    companyName: 'Orbit Labs',
    jobUrl,
  })

  assert.equal(emailRequests.length, 3)
  assert.equal(emailRequests[0].options.headers.Authorization, 'Bearer test-sendgrid-key')
  const emailPayload = JSON.parse(emailRequests[0].options.body)
  assert.deepEqual(emailPayload.personalizations[0].to, [{ email: 'student@example.test' }])
  assert.deepEqual(emailPayload.from, { email: 'jobs@example.test', name: 'SkillOrbit' })
  assert.match(emailPayload.content[0].value, /Frontend Engineer at Orbit Labs/)
  assert.match(emailPayload.content[0].value, new RegExp(jobUrl.replaceAll('/', '\\/')))
  assert.ok(emailRequests.some(({ options }) => JSON.parse(options.body).personalizations[0].to[0].email === 'unverified@example.test'))
  assert.ok(emailRequests.every(({ url }) => url === 'https://api.sendgrid.com/v3/mail/send'))
  assert.deepEqual(summary, {
    recipientCount: 3,
    emailConfigured: true,
    emailsSent: 3,
    emailsFailed: 0,
    emailsSkipped: 0,
  })
})

test('reports provider failures without aborting job notifications', async () => {
  const errors = []
  const send = createJobNotificationSender({
    sendGridApiKey: 'test-sendgrid-key',
    mailFrom: 'SkillOrbit <jobs@example.test>',
    fetchImpl: async () => ({ ok: false, status: 503 }),
    logger: { error: (...args) => errors.push(args) },
  })

  const summary = await send({
    recipients: [{ email: 'student@example.test', profile: {} }],
    job,
    companyName: 'Orbit Labs',
    jobUrl,
  })

  assert.equal(summary.emailsFailed, 1)
  assert.equal(errors.length, 1)
})
