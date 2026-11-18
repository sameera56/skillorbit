function notificationErrorCode(error) {
  if (typeof error?.code === 'string') return error.code
  if (Number.isInteger(error?.status)) return `HTTP_${error.status}`
  return error?.name || 'UnknownError'
}

function sendGridSender(value) {
  if (typeof value !== 'string') return null
  const formatted = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim())
  const email = (formatted ? formatted[2] : value).trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  const name = formatted?.[1].trim()
  return { email, ...(name ? { name } : {}) }
}

export function createJobNotificationSender({
  sendGridApiKey,
  mailFrom,
  fetchImpl = fetch,
  logger = console,
}) {
  const sender = sendGridSender(mailFrom)
  const emailConfigured = Boolean(sendGridApiKey && sender)

  async function sendEmail(recipient, job, companyName, jobUrl, summary) {
    if (!emailConfigured) {
      summary.emailsSkipped += 1
      return
    }

    const name = recipient.profile.fullName || 'there'
    const text = [
      `Hello ${name},`,
      '',
      `A new job opportunity has been posted on SkillOrbit: ${job.title} at ${companyName}.`,
      `Job type: ${job.type || 'Not specified'}`,
      `Location: ${job.location || 'Not specified'}`,
      job.salary ? `Salary: ${job.salary}` : '',
      '',
      job.description,
      job.requirements ? `\nRequirements:\n${job.requirements}` : '',
      '',
      `View opportunities: ${jobUrl}`,
    ].filter(Boolean).join('\n')

    try {
      const response = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendGridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient.email }] }],
          from: sender,
          subject: `New job opportunity: ${job.title}`,
          content: [{ type: 'text/plain', value: text }],
        }),
      })
      if (!response.ok) {
        const error = new Error('SendGrid request failed')
        error.status = response.status
        throw error
      }
      summary.emailsSent += 1
    } catch (error) {
      summary.emailsFailed += 1
      logger.error('Job email notification failed', {
        jobId: job.id,
        error: notificationErrorCode(error),
      })
    }
  }

  return async function sendJobNotifications({ recipients, job, companyName, jobUrl }) {
    const summary = {
      recipientCount: recipients.length,
      emailConfigured,
      emailsSent: 0,
      emailsFailed: 0,
      emailsSkipped: 0,
    }

    for (let offset = 0; offset < recipients.length; offset += 5) {
      const batch = recipients.slice(offset, offset + 5)
      await Promise.all(batch.map((recipient) => sendEmail(recipient, job, companyName, jobUrl, summary)))
    }

    return summary
  }
}
