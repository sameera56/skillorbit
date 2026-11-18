import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { MongoClient } from 'mongodb'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillorbit-test-'))
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'
const databaseName = `skillorbit_test_${process.pid}_${Date.now()}`
const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    JWT_SECRET: 'test-secret-with-more-than-thirty-two-characters',
    MONGODB_URI: mongoUri,
    MONGODB_DB: databaseName,
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    MAIL_FROM: '',
    SENDGRID_API_KEY: '',
  },
  stdio: 'ignore',
})

const baseUrl = `http://127.0.0.1:${port}`
let student
let company
let institution
let jobId

async function waitForServer() {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) throw new Error(`Test server exited with ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch { /* The server is not listening yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Test server did not become ready.')
}

async function call(route, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  })
  const payload = response.status === 204 ? null : await response.json()
  return { response, payload }
}

async function activateAccount(registration, email, password) {
  assert.equal(registration.response.status, 201)
  assert.equal(registration.payload.developmentLink, undefined)
  return call('/api/auth/login', { method: 'POST', body: { email, password } })
}

test('production startup rejects missing SMTP configuration', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillorbit-production-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-that-is-long-enough',
      APP_BASE_URL: 'https://skillorbit.example',
      MONGODB_URI: mongoUri,
      MONGODB_DB: `${databaseName}_production`,
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM: '',
    },
    encoding: 'utf8',
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SMTP_HOST/)
})

test('role workflows persist data and enforce tenant access', async (t) => {
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    const client = new MongoClient(mongoUri)
    await client.connect()
    await client.db(databaseName).dropDatabase()
    await client.close()
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })
  await waitForServer()

  const studentResult = await call('/api/auth/register/student', { method: 'POST', body: { email: 'student@example.test', password: 'strong-pass-123', fullName: 'Taylor Student', university: 'North College', department: 'Engineering', phone: '9876543210' } })
  assert.equal(studentResult.response.status, 201)
  student = (await activateAccount(studentResult, 'student@example.test', 'strong-pass-123')).payload
  const pendingStudent = await call('/api/auth/register/student', { method: 'POST', body: { email: 'pending@example.test', password: 'strong-pass-123', fullName: 'Pending Student' } })
  assert.equal(pendingStudent.response.status, 201)
  const mongoClient = new MongoClient(mongoUri)
  await mongoClient.connect()
  await mongoClient.db(databaseName).collection('users').updateOne({ email_normalized: 'pending@example.test' }, { $set: { email_verified: false } })
  await mongoClient.close()
  const pendingStudentLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'pending@example.test', password: 'strong-pass-123' } })
  assert.equal(pendingStudentLogin.response.status, 200)
  assert.equal((await call('/api/me', { token: pendingStudentLogin.payload.token })).response.status, 200)

  const companyResult = await call('/api/auth/register/company', { method: 'POST', body: { email: 'recruiter@example.test', password: 'strong-pass-123', companyName: 'Orbit Labs', industry: 'Technology' } })
  assert.equal(companyResult.response.status, 201)
  company = (await activateAccount(companyResult, 'recruiter@example.test', 'strong-pass-123')).payload
  const duplicateAccount = await call('/api/auth/register/company', { method: 'POST', body: { email: 'recruiter@example.test', password: 'strong-pass-123', companyName: 'Duplicate', industry: 'Technology' } })
  assert.equal(duplicateAccount.response.status, 409)

  const institutionResult = await call('/api/auth/register/institution', { method: 'POST', body: { email: 'admin@example.test', password: 'strong-pass-123', institutionName: 'North College' } })
  assert.equal(institutionResult.response.status, 201)
  institution = (await activateAccount(institutionResult, 'admin@example.test', 'strong-pass-123')).payload

  const unauthorizedJob = await call('/api/jobs', { method: 'POST', token: student.token, body: { title: 'Engineer', description: 'Build software' } })
  assert.equal(unauthorizedJob.response.status, 403)

  const studentProfile = await call('/api/auth/profile', { token: student.token })

  const jobResult = await call('/api/jobs', { method: 'POST', token: company.token, body: { title: 'Frontend Engineer', description: 'Build accessible web apps.', domain: 'Engineering', location: 'Remote', type: 'Full-time' } })
  assert.equal(jobResult.response.status, 201)
  assert.equal(jobResult.payload.notifications.recipientCount, 2)
  assert.equal(jobResult.payload.notifications.inAppSent, 2)
  assert.equal(jobResult.payload.notifications.emailsSkipped, 2)
  jobId = jobResult.payload.job.id
  const companyOverview = await call('/api/company/overview', { token: company.token })
  assert.equal(companyOverview.response.status, 200)
  assert.equal(companyOverview.payload.jobs.open, 1)
  assert.equal(companyOverview.payload.applications.total, 0)
  const companyJobs = await call('/api/jobs/mine', { token: company.token })
  assert.equal(companyJobs.response.status, 200)
  assert.equal(companyJobs.payload.jobs.length, 1)
  assert.equal(companyJobs.payload.jobs[0].id, jobId)
  const publicJob = await call(`/api/jobs/${jobId}`)
  assert.equal(publicJob.response.status, 200)
  assert.equal(publicJob.payload.job.id, jobId)
  const editedJob = await call(`/api/jobs/${jobId}`, { method: 'PATCH', token: company.token, body: { salary: 'INR 100k' } })
  assert.equal(editedJob.response.status, 200)
  assert.equal(editedJob.payload.job.salary, 'INR 100k')

  const resume = await call('/api/resume', { method: 'POST', token: student.token, body: { title: 'Engineering resume', fullName: 'Taylor Student', email: 'student@example.test', phone: '555-0101', summary: 'A practical builder.', skills: ['Languages: TypeScript'], education: ['North College'], experience: [], projects: [], certifications: ['Cloud Certification'] } })
  assert.equal(resume.response.status, 201)
  assert.deepEqual(resume.payload.resume.content.certifications, ['Cloud Certification'])
  const invalidApplication = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: student.token, body: { fullName: '', email: 'not-an-email' } })
  assert.equal(invalidApplication.response.status, 400)
  assert.equal((await call('/api/students/me/applications', { token: student.token })).payload.applications.length, 0)
  const missingResume = await call(`/api/jobs/${jobId}/apply`, {
    method: 'POST',
    token: student.token,
    body: { fullName: 'Taylor Student', email: 'student@example.test' },
  })
  assert.equal(missingResume.response.status, 400)
  assert.equal((await call('/api/students/me/applications', { token: student.token })).payload.applications.length, 0)

  const applied = await call(`/api/jobs/${jobId}/apply`, {
    method: 'POST',
    token: student.token,
    body: { fullName: 'Taylor Student', email: 'student@example.test', phone: '555-0101', coverLetter: 'I am excited to apply.', resumeId: resume.payload.resume.id },
  })
  assert.equal(applied.response.status, 201)
  const updatedCompanyOverview = await call('/api/company/overview', { token: company.token })
  assert.equal(updatedCompanyOverview.response.status, 200)
  assert.equal(updatedCompanyOverview.payload.applications.total, 1)
  assert.equal(updatedCompanyOverview.payload.pipeline.applied, 1)
  assert.equal(updatedCompanyOverview.payload.recentApplicants[0].fullName, 'Taylor Student')
  assert.equal(updatedCompanyOverview.payload.jobsNeedingAttention[0].recentApplicants, 1)
  const applicants = await call('/api/company/applicants', { token: company.token })
  assert.equal(applicants.response.status, 200)
  assert.equal(applicants.payload.applicants[0].email, 'student@example.test')
  assert.equal(applicants.payload.applicants[0].profile.fullName, 'Taylor Student')
  assert.equal(applicants.payload.applicants[0].profile.phone, '555-0101')
  assert.equal(applicants.payload.applicants[0].coverLetter, 'I am excited to apply.')
  assert.equal(applicants.payload.applicants[0].resumeName, 'engineering-resume.txt')
  const savedResumeDownload = await fetch(`${baseUrl}/api/company/applicants/${applied.payload.id}/resume`, { headers: { Authorization: `Bearer ${company.token}` } })
  assert.equal(savedResumeDownload.status, 200)
  assert.match(savedResumeDownload.headers.get('content-type'), /text\/plain/)
  const savedResumeText = await savedResumeDownload.text()
  assert.match(savedResumeText, /TypeScript/)
  assert.match(savedResumeText, /CERTIFICATIONS\nCloud Certification/)
  const otherCompanyRegistration = await call('/api/auth/register/company', { method: 'POST', body: { email: 'another-recruiter@example.test', password: 'strong-pass-123', companyName: 'Other Labs', industry: 'Technology' } })
  const otherCompanyResult = await activateAccount(otherCompanyRegistration, 'another-recruiter@example.test', 'strong-pass-123')
  const otherCompanyOverview = await call('/api/company/overview', { token: otherCompanyResult.payload.token })
  assert.deepEqual(otherCompanyOverview.payload.recentApplicants, [])
  assert.deepEqual(otherCompanyOverview.payload.jobsNeedingAttention, [])
  const privateResume = await fetch(`${baseUrl}/api/company/applicants/${applied.payload.id}/resume`, { headers: { Authorization: `Bearer ${otherCompanyResult.payload.token}` } })
  assert.equal(privateResume.status, 404)
  const privateApplicant = await call(`/api/company/applicants/${applied.payload.id}`, { token: otherCompanyResult.payload.token })
  assert.equal(privateApplicant.response.status, 404)
  const applicantDetails = await call(`/api/company/applicants/${applied.payload.id}`, { token: company.token })
  assert.equal(applicantDetails.response.status, 200)
  assert.equal(applicantDetails.payload.applicant.applicationId, applied.payload.id)
  assert.equal(applicantDetails.payload.applicant.jobTitle, 'Frontend Engineer')
  assert.equal(applicantDetails.payload.applicant.profile.fullName, 'Taylor Student')
  assert.equal(applicantDetails.payload.applicant.email, 'student@example.test')
  assert.equal(applicantDetails.payload.applicant.profile.phone, '555-0101')
  assert.equal(applicantDetails.payload.applicant.coverLetter, 'I am excited to apply.')
  assert.equal(applicantDetails.payload.applicant.resumeName, 'engineering-resume.txt')
  assert.equal(applicantDetails.payload.applicant.history.length, 1)
  assert.equal(applicantDetails.payload.applicant.history[0].newStatus, 'applied')
  const companyNotifications = await call('/api/notifications', { token: company.token })
  assert.equal(companyNotifications.payload.unread, 1)
  const notificationRead = await call(`/api/notifications/${companyNotifications.payload.notifications[0].id}`, { method: 'PATCH', token: company.token })
  assert.equal(notificationRead.response.status, 200)
  const duplicate = await call(`/api/jobs/${jobId}/apply`, {
    method: 'POST',
    token: student.token,
    body: { fullName: 'Taylor Student', email: 'student@example.test', phone: '555-0101', coverLetter: 'I am excited to apply.', resumeId: resume.payload.resume.id },
  })
  assert.equal(duplicate.response.status, 409)

  const application = (await call('/api/students/me/applications', { token: student.token })).payload.applications[0]
  assert.equal(application.title, 'Frontend Engineer')
  assert.equal(application.fullName, 'Taylor Student')
  assert.equal(application.email, 'student@example.test')
  assert.equal(application.resumeName, 'engineering-resume.txt')
  assert.equal(application.canModify, true)
  const studentResumeDownload = await fetch(`${baseUrl}/api/students/me/applications/${application.id}/resume`, { headers: { Authorization: `Bearer ${student.token}` } })
  assert.equal(studentResumeDownload.status, 200)
  assert.match(await studentResumeDownload.text(), /TypeScript/)
  const statusChange = await call(`/api/company/applicants/${application.id}`, { method: 'PATCH', token: company.token, body: { status: 'shortlisted' } })
  assert.equal(statusChange.response.status, 200)
  const updatedApplication = (await call('/api/students/me/applications', { token: student.token })).payload.applications[0]
  assert.equal(updatedApplication.status, 'shortlisted')
  assert.equal(updatedApplication.history.length, 2)
  const shortlistedDetails = (await call(`/api/company/applicants/${application.id}`, { token: company.token })).payload.applicant
  assert.equal(shortlistedDetails.status, 'shortlisted')
  assert.equal(shortlistedDetails.history.length, 2)
  assert.equal(shortlistedDetails.history[1].oldStatus, 'applied')
  assert.equal(shortlistedDetails.history[1].newStatus, 'shortlisted')
  const shortlistedPipeline = (await call('/api/company/overview', { token: company.token })).payload.pipeline
  assert.equal(shortlistedPipeline.shortlisted, 1)
  assert.equal(shortlistedPipeline.applied, 0)
  assert.equal((await call('/api/notifications', { token: student.token })).payload.unread, 2)
  const editedApplication = await call(`/api/students/me/applications/${application.id}`, {
    method: 'PATCH',
    token: student.token,
    body: { fullName: 'Taylor Student', email: 'student@example.test', phone: '555-0199', coverLetter: 'Updated application note.' },
  })
  assert.equal(editedApplication.response.status, 200)
  const filteredBySkill = await call('/api/company/applicants?skills=TypeScript', { token: company.token })
  assert.ok(filteredBySkill.payload.applicants.some((item) => item.applicationId === application.id))
  const filteredByExperience = await call('/api/company/applicants?experience=North%20College', { token: company.token })
  assert.ok(filteredByExperience.payload.applicants.some((item) => item.applicationId === application.id))
  const updatedApplicant = (await call(`/api/company/applicants?search=Taylor%20Student`, { token: company.token })).payload.applicants[0]
  assert.equal(updatedApplicant.profile.phone, '555-0199')
  assert.equal(updatedApplicant.coverLetter, 'Updated application note.')
  await call(`/api/jobs/${jobId}`, { method: 'PATCH', token: company.token, body: { status: 'closed' } })
  assert.equal((await call('/api/students/me/applications', { token: student.token })).payload.applications[0].canModify, false)
  assert.equal((await call(`/api/students/me/applications/${application.id}`, { method: 'PATCH', token: student.token, body: { fullName: 'Taylor Student', email: 'student@example.test' } })).response.status, 409)
  await call(`/api/jobs/${jobId}`, { method: 'PATCH', token: company.token, body: { status: 'open' } })

  const alert = await call('/api/students/me/job-alerts', { method: 'POST', token: student.token, body: { keyword: 'Data Analyst', domain: 'Analytics', location: 'Remote' } })
  assert.equal(alert.response.status, 201)
  const duplicateAlert = await call('/api/students/me/job-alerts', { method: 'POST', token: student.token, body: { keyword: 'Data Analyst', domain: 'Analytics', location: 'Remote' } })
  assert.equal(duplicateAlert.response.status, 409)
  const matchingJob = await call('/api/jobs', { method: 'POST', token: company.token, body: { title: 'Data Analyst', description: 'Analyze product data.', domain: 'Analytics', location: 'Remote', type: 'Full-time' } })
  assert.equal(matchingJob.response.status, 201)
  const matchingNotifications = await call('/api/notifications', { token: student.token })
  assert.ok(matchingNotifications.payload.notifications.some((item) => item.kind === 'job' && item.title === 'New job matches your alert'))
  assert.equal((await call('/api/students/me/job-alerts', { token: student.token })).payload.alerts.length, 1)
  assert.equal((await call(`/api/students/me/job-alerts/${alert.payload.alert.id}`, { method: 'DELETE', token: student.token })).response.status, 204)

  const saved = await call('/api/students/me/saved-jobs', { method: 'POST', token: student.token, body: { jobId } })
  assert.equal(saved.response.status, 201)
  assert.equal((await call('/api/students/me/saved-jobs', { token: student.token })).payload.jobs.length, 1)

  const image = new FormData()
  image.append('image', new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])], { type: 'image/png' }), 'profile.png')
  const imageUpload = await call('/api/auth/profile/image', { method: 'POST', token: student.token, body: image })
  assert.equal(imageUpload.response.status, 200)
  const profileImage = await fetch(`${baseUrl}/api/auth/profile/image`, { headers: { Authorization: `Bearer ${student.token}` } })
  assert.equal(profileImage.headers.get('content-type'), 'image/png')
  const otherImage = await call('/api/auth/profile/image', { token: company.token })
  assert.equal(otherImage.response.status, 404)
  const anotherStudentRegistration = await call('/api/auth/register/student', { method: 'POST', body: { email: 'other@example.test', password: 'strong-pass-123', fullName: 'Other Student', university: 'Elsewhere College' } })
  const anotherStudent = await activateAccount(anotherStudentRegistration, 'other@example.test', 'strong-pass-123')
  assert.equal((await call('/api/resume', { token: anotherStudent.payload.token })).payload.resumes.length, 0)
  const forgedResume = await call(`/api/jobs/${jobId}/apply`, {
    method: 'POST',
    token: anotherStudent.payload.token,
    body: { fullName: 'Other Student', email: 'other@example.test', resumeId: resume.payload.resume.id },
  })
  assert.equal(forgedResume.response.status, 400)
  const uploadedResume = new FormData()
  uploadedResume.set('fullName', 'Other Student')
  uploadedResume.set('email', 'other@example.test')
  uploadedResume.set('resume', new Blob(['Role-specific skills: Node.js and MongoDB.'], { type: 'text/plain' }), 'backend-role.txt')
  const uploadedApplication = await call(`/api/jobs/${jobId}/apply`, { method: 'POST', token: anotherStudent.payload.token, body: uploadedResume })
  assert.equal(uploadedApplication.response.status, 201)
  const uploadedApplicant = (await call('/api/company/applicants?search=Other%20Student', { token: company.token })).payload.applicants[0]
  assert.equal(uploadedApplicant.resumeName, 'backend-role.txt')
  const uploadedResumeDownload = await fetch(`${baseUrl}/api/company/applicants/${uploadedApplication.payload.id}/resume`, { headers: { Authorization: `Bearer ${company.token}` } })
  assert.equal(uploadedResumeDownload.status, 200)
  assert.equal(await uploadedResumeDownload.text(), 'Role-specific skills: Node.js and MongoDB.')
  const closingSoon = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const closingJob = await call('/api/jobs', { method: 'POST', token: company.token, body: { title: 'Closing soon role', description: 'This posting is nearing its deadline.', deadline: closingSoon } })
  assert.equal(closingJob.response.status, 201)
  assert.equal(closingJob.payload.notifications.recipientCount, 3)
  assert.equal(closingJob.payload.notifications.inAppSent, 3)
  assert.equal(closingJob.payload.notifications.emailsSkipped, 3)
  const otherStudentNotifications = await call('/api/notifications', { token: anotherStudent.payload.token })
  assert.ok(otherStudentNotifications.payload.notifications.some((item) => item.title === 'New job posted' && item.detail.includes('Closing soon role')))
  const dashboardDetails = (await call('/api/company/overview', { token: company.token })).payload
  assert.equal(dashboardDetails.recentApplicants[0].fullName, 'Other Student')
  const dueJob = dashboardDetails.jobsNeedingAttention.find((job) => job.id === closingJob.payload.job.id)
  assert.equal(dueJob.closingSoon, true)
  const activeJob = dashboardDetails.jobsNeedingAttention.find((job) => job.id === jobId)
  assert.equal(activeJob.recentApplicants, 2)
  const department = await call('/api/institution/departments', { method: 'POST', token: institution.token, body: { name: 'Engineering' } })
  assert.equal(department.response.status, 201)
  const roster = await call('/api/institution/students', { token: institution.token })
  assert.deepEqual(roster.payload.students.map((row) => row.email), ['student@example.test'])
  const departmentMetrics = await call('/api/institution/departments', { token: institution.token })
  assert.deepEqual(departmentMetrics.payload.departments[0], { id: department.payload.department.id, name: 'Engineering', students: 1, applications: 1, selected: 0 })
  const drive = await call('/api/institution/drives', { method: 'POST', token: institution.token, body: { title: 'Autumn hiring day', companyName: 'Orbit Labs' } })
  assert.equal(drive.response.status, 201)
  const updatedDrive = await call(`/api/institution/drives/${drive.payload.id}`, { method: 'PATCH', token: institution.token, body: { status: 'completed' } })
  assert.equal(updatedDrive.payload.status, 'completed')
  assert.equal((await call(`/api/institution/drives/${drive.payload.id}`, { method: 'DELETE', token: institution.token })).response.status, 204)

  const report = await fetch(`${baseUrl}/api/company/reports.csv`, { headers: { Authorization: `Bearer ${company.token}` } })
  assert.equal(report.status, 200)
  assert.match(await report.text(), /Taylor Student/)

  const ats = new FormData()
  ats.append('resume', new Blob(['Skills: TypeScript, React. Experience: built a web app.'], { type: 'text/plain' }), 'resume.txt')
  ats.append('jobDescription', 'TypeScript React engineer with experience.')
  const analysis = await call('/api/ats/upload', { method: 'POST', token: student.token, body: ats })
  assert.equal(analysis.response.status, 201)
  assert.ok(analysis.payload.score >= 0 && analysis.payload.score <= 100)

  const questions = (await call('/api/questions?mode=aptitude')).payload.questions
  const practiceQuestion = questions.find((question) => question.prompt.startsWith('A team completes'))
  const session = await call('/api/practice/sessions', { method: 'POST', token: student.token, body: { mode: 'aptitude', topic: practiceQuestion.topic } })
  assert.equal(session.response.status, 201)
  const answer = await call(`/api/practice/sessions/${session.payload.id}/answers`, { method: 'POST', token: student.token, body: { questionId: practiceQuestion.id, answer: '20' } })
  assert.equal(answer.payload.correct, true)
  const completed = await call(`/api/practice/sessions/${session.payload.id}/complete`, { method: 'POST', token: student.token, body: {} })
  assert.equal(completed.payload.score, 100)

  const resetRequest = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'student@example.test' } })
  assert.equal(resetRequest.response.status, 200)
  const unknownResetRequest = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'unknown@example.test' } })
  assert.equal(unknownResetRequest.response.status, 200)
  assert.equal(unknownResetRequest.payload.developmentLink, undefined)
  const resetToken = new URL(resetRequest.payload.developmentLink).searchParams.get('reset')
  const passwordReset = await call('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'new-strong-pass-456' } })
  assert.equal(passwordReset.response.status, 200)
  const reusedResetToken = await call('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, password: 'another-strong-pass-789' } })
  assert.equal(reusedResetToken.response.status, 400)
  assert.equal((await call('/api/me', { token: student.token })).response.status, 401)
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'student@example.test', password: 'strong-pass-123' } })).response.status, 401)
  const resetLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'student@example.test', password: 'new-strong-pass-456' } })
  assert.equal(resetLogin.response.status, 200)

  const withdraw = await call(`/api/students/me/applications/${application.id}`, { method: 'DELETE', token: resetLogin.payload.token })
  assert.equal(withdraw.response.status, 200)
  const withdrawnApplication = (await call('/api/students/me/applications', { token: resetLogin.payload.token })).payload.applications.find((item) => item.id === application.id)
  assert.equal(withdrawnApplication.status, 'withdrawn')
  assert.equal(withdrawnApplication.canModify, false)
  assert.equal((await call(`/api/students/me/applications/${application.id}`, { method: 'PATCH', token: resetLogin.payload.token, body: { fullName: 'Taylor Student', email: 'student@example.test' } })).response.status, 409)
  assert.equal((await call(`/api/company/applicants/${application.id}`, { method: 'PATCH', token: company.token, body: { status: 'rejected' } })).response.status, 404)
  assert.equal((await call('/api/company/overview', { token: company.token })).payload.applications.total, 1)
  assert.equal((await call('/api/company/applicants?search=Taylor%20Student', { token: company.token })).payload.applicants.length, 0)
})
