import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { connectDatabase } from './db/mongo.js'
import { createJobNotificationSender } from './job-notifications.js'
import express from 'express'
import multer from 'multer'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')
const nodemailer = require('nodemailer')
const scrypt = promisify(crypto.scrypt)
const root = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = path.resolve(process.env.SKILLORBIT_DATA_DIR || path.join(root, 'data'))
fs.mkdirSync(dataDirectory, { recursive: true })
const db = await connectDatabase()

async function nextId(collectionName) {
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: collectionName },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  return counter.sequence
}

async function insertRow(collectionName, document) {
  const row = { ...document, id: await nextId(collectionName), created_at: document.created_at || new Date().toISOString() }
  await db.collection(collectionName).insertOne(row)
  return row
}

const withoutMongoId = ({ _id, ...document }) => document
const findRow = async (collectionName, filter, options) => {
  const document = await db.collection(collectionName).findOne(filter, options)
  return document ? withoutMongoId(document) : null
}
const findRows = async (collectionName, filter = {}, options = {}) => (await db.collection(collectionName).find(filter, options).toArray()).map(withoutMongoId)
const countRows = (collectionName, filter = {}) => db.collection(collectionName).countDocuments(filter)
const updateRow = (collectionName, filter, update) => db.collection(collectionName).updateOne(filter, update)
const deleteRow = (collectionName, filter) => db.collection(collectionName).deleteOne(filter)
const deleteRows = (collectionName, filter) => db.collection(collectionName).deleteMany(filter)
const binaryBuffer = (value) => Buffer.isBuffer(value) ? value : Buffer.from(value.buffer.subarray(0, value.position))

let jwtSecret = process.env.JWT_SECRET
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production.')
  }
  const secretPath = path.join(dataDirectory, '.jwt-secret')
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(secretPath, crypto.randomBytes(48), { mode: 0o600, flag: 'wx' })
  }
  jwtSecret = fs.readFileSync(secretPath, 'utf8')
}
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || jwtSecret === 'replace-with-a-long-random-secret')) {
  throw new Error('JWT_SECRET must be a unique value with at least 32 characters in production.')
}

const smtpHost = process.env.SMTP_HOST?.trim()
const smtpPort = Number(process.env.SMTP_PORT || 587)
const mailFrom = process.env.MAIL_FROM?.trim()
const smtpUser = process.env.SMTP_USER
const smtpPassword = process.env.SMTP_PASSWORD
const smtpConfigured = Boolean(smtpHost && mailFrom && smtpUser && smtpPassword && Number.isInteger(smtpPort) && smtpPort > 0)
if (process.env.NODE_ENV === 'production' && !smtpConfigured) {
  throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM are required in production.')
}
const mailTransport = smtpConfigured
  ? nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: process.env.SMTP_SECURE === 'true', auth: { user: smtpUser, pass: smtpPassword } })
  : null
const sendJobNotifications = createJobNotificationSender({
  sendGridApiKey: process.env.SENDGRID_API_KEY?.trim(),
  mailFrom,
})
const configuredBaseUrl = process.env.APP_BASE_URL?.trim()
if (process.env.NODE_ENV === 'production' && !configuredBaseUrl) throw new Error('APP_BASE_URL is required in production.')
let appBaseUrl
try { appBaseUrl = new URL(configuredBaseUrl || 'http://localhost:5173') }
catch { throw new Error('APP_BASE_URL must be a valid absolute URL.') }
if (!['http:', 'https:'].includes(appBaseUrl.protocol) || appBaseUrl.username || appBaseUrl.password) {
  throw new Error('APP_BASE_URL must be an HTTP(S) URL without embedded credentials.')
}
if (process.env.NODE_ENV === 'production' && appBaseUrl.protocol !== 'https:') throw new Error('APP_BASE_URL must use HTTPS in production.')

const app = express()
app.disable('x-powered-by')
const capacitorOrigin = process.env.CAPACITOR_SERVER_ORIGIN?.trim() || 'https://localhost'
const allowedOrigins = new Set([appBaseUrl.origin, capacitorOrigin])
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403)
  next()
})
app.use(express.json({ limit: '100kb' }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

function singleResumeUpload(req, res, next) {
  upload.single('resume')(req, res, (error) => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'Resume files must be 5 MB or smaller.' : 'Upload one PDF or TXT resume.'
      return res.status(400).json({ message })
    }
    next(error)
  })
}

const questionCount = await countRows('practice_questions')
if (!questionCount) {
  const questions = [
    ['Quantitative', 'aptitude', 'A team completes 60% of a project in 12 days. At the same rate, how many days are needed for the full project?', ['18', '20', '22', '24'], '20', 'At the same rate, 12 ÷ 0.6 = 20 days.'],
    ['Quantitative', 'aptitude', 'What is 15% of 240?', ['24', '30', '36', '42'], '36', '0.15 × 240 = 36.'],
    ['Logical reasoning', 'aptitude', 'Find the next number: 2, 6, 12, 20, 30, ...', ['36', '40', '42', '44'], '42', 'The increments are 4, 6, 8, 10, then 12.'],
    ['Verbal', 'aptitude', 'Choose the closest meaning to “concise”.', ['Brief', 'Uncertain', 'Detailed', 'Formal'], 'Brief', 'Concise means expressing something briefly and clearly.'],
    ['Technical', 'aptitude', 'Which data structure follows first-in, first-out ordering?', ['Stack', 'Queue', 'Tree', 'Heap'], 'Queue', 'A queue removes items in the order they were added.'],
    ['Behavioral', 'interview', 'Describe a project you are proud of. What was your role, what challenge did you face, and what was the result?', [], null, 'A strong response clearly describes context, your actions, and a measurable or specific result.'],
    ['Behavioral', 'interview', 'Tell me about a time you received difficult feedback. How did you respond?', [], null, 'Explain the feedback, how you listened and acted on it, and what changed afterward.'],
    ['Technical', 'interview', 'How do you approach debugging an issue you cannot reproduce consistently?', [], null, 'Describe gathering evidence, narrowing variables, adding observability, and validating a fix.'],
    ['Technical', 'interview', 'How would you explain a technical trade-off to a non-technical stakeholder?', [], null, 'Connect options to user or business impact, explain uncertainty, and recommend a path.'],
  ]
  await db.collection('practice_questions').insertMany(await Promise.all(questions.map(async ([topic, mode, prompt, options, answer, explanation]) => ({
    id: await nextId('practice_questions'),
    topic,
    mode,
    prompt,
    options,
    answer,
    explanation,
  }))))
}

const allowedProfileFields = {
  student: new Set(['fullName', 'phone', 'location', 'university', 'department', 'degree', 'graduationYear', 'cgpa', 'skills', 'summary', 'institutionId']),
  institution: new Set(['institutionName', 'phone', 'location', 'website', 'address', 'description', 'establishedYear', 'accreditation']),
  company: new Set(['companyName', 'industry', 'website', 'location', 'phone', 'description', 'contactName']),
}
const cleanUser = (row) => ({ id: row.id, email: row.email, role: row.role })
const parseJson = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return value
  try { return JSON.parse(value) } catch { return fallback }
}
const validEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const text = (value, max = 5000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const numberId = (value) => /^\d+$/.test(String(value)) && Number(value) > 0
const profileFor = async (id) => (await findRow('profiles', { user_id: id }))?.data_json || {}
const publicUser = async (row) => ({ ...cleanUser(row), profile: await profileFor(row.id) })

function signToken(userId, tokenVersion = 0) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: userId, ver: tokenVersion, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 })).toString('base64url')
  const data = `${header}.${payload}`
  return `${data}.${crypto.createHmac('sha256', jwtSecret).update(data).digest('base64url')}`
}

async function verifyToken(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const data = `${parts[0]}.${parts[1]}`
  const expected = crypto.createHmac('sha256', jwtSecret).update(data).digest()
  let actual
  try { actual = Buffer.from(parts[2], 'base64url') } catch { return null }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null
  let payload
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) } catch { return null }
  if (!Number.isInteger(payload.sub) || payload.exp < Date.now() / 1000) return null
  const user = await findRow('users', { id: payload.sub }, { projection: { id: 1, email: 1, role: 1, token_version: 1 } })
  if (!user || (payload.ver ?? 0) !== user.token_version) return null
  return user
}

async function auth(req, res, next) {
  const value = req.get('authorization') || ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  const user = match ? await verifyToken(match[1]) : null
  if (!user) return res.status(401).json({ message: 'Please sign in to continue.' })
  req.user = user
  next()
}

function role(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ message: 'You do not have permission to perform this action.' })
    next()
  }
}

const loginAttempts = new Map()
function limitAuth(req, res, next) {
  const key = req.ip || 'local'
  const now = Date.now()
  if (loginAttempts.size > 5000) {
    for (const [address, value] of loginAttempts) if (value.reset < now) loginAttempts.delete(address)
  }
  if (loginAttempts.size >= 10000 && !loginAttempts.has(key)) return res.status(429).json({ message: 'Too many account requests. Try again later.' })
  const entry = loginAttempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 }
  if (entry.reset < now) {
    entry.count = 0
    entry.reset = now + 15 * 60 * 1000
  }
  entry.count += 1
  loginAttempts.set(key, entry)
  if (entry.count > 30) return res.status(429).json({ message: 'Too many account requests. Try again later.' })
  next()
}

function logActivity(userId, kind, detail) {
  return insertRow('activity_events', { user_id: userId, kind, detail: detail.slice(0, 250) })
}

function createNotification(userId, kind, title, detail) {
  return insertRow('notifications', { user_id: userId, kind, title: title.slice(0, 120), detail: detail.slice(0, 250), read_at: null })
}

function profileFields(input, userRole) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const allowed = allowedProfileFields[userRole]
  if (Object.keys(input).some((key) => !allowed.has(key))) return null
  const values = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string' && value.length > 2000) return null
    if (key === 'institutionId' && value !== '' && value !== null && !numberId(value)) return null
    values[key] = typeof value === 'string' ? value.trim() : value
  }
  return values
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'SkillOrbit' }))

function accountActionUrl(purpose, token) {
  const url = new URL('/auth', appBaseUrl)
  url.searchParams.set(purpose === 'verify_email' ? 'verify' : 'reset', token)
  return url.toString()
}

async function createAccountAction(userId, email, purpose) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await db.collection('account_tokens').updateOne(
    { user_id: userId, purpose },
    { $set: { token_hash: tokenHash, expires_at: Date.now() + 60 * 60 * 1000, created_at: new Date().toISOString() }, $setOnInsert: { id: await nextId('account_tokens'), user_id: userId, purpose } },
    { upsert: true },
  )
  const url = accountActionUrl(purpose, token)
  if (!mailTransport) return url
  const verification = purpose === 'verify_email'
  await mailTransport.sendMail({
    from: mailFrom,
    to: email,
    subject: verification ? 'Verify your SkillOrbit email' : 'Reset your SkillOrbit password',
    text: `${verification ? 'Verify your email address' : 'Reset your password'} using this one-time link (expires in one hour): ${url}`,
  })
  return null
}

app.post('/api/auth/register/:role', limitAuth, async (req, res) => {
  const { role: userRole } = req.params
  if (!['student', 'institution', 'company'].includes(userRole)) return res.status(400).json({ message: 'Unsupported account type.' })
  const { email, password } = req.body || {}
  if (!validEmail(email) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Enter a valid email and a password of 8 to 128 characters.' })
  }
  const input = { ...req.body }
  delete input.email
  delete input.password
  const profile = profileFields(input, userRole)
  if (!profile) return res.status(400).json({ message: 'Profile contains unsupported or invalid fields.' })
  const identityField = { student: 'fullName', institution: 'institutionName', company: 'companyName' }[userRole]
  if (!text(profile[identityField], 120)) return res.status(400).json({ message: `Enter your ${identityField}.` })
  if (userRole === 'company' && !text(profile.industry, 120)) return res.status(400).json({ message: 'Enter your industry.' })

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = (await scrypt(password, salt, 64)).toString('hex')
  try {
    const user = await insertRow('users', { email: email.trim(), email_normalized: email.trim().toLowerCase(), password_hash: `${salt}:${hash}`, role: userRole, email_verified: true, token_version: 0 })
    try {
      await db.collection('profiles').insertOne({ user_id: user.id, data_json: profile, updated_at: new Date().toISOString() })
      return res.status(201).json({ message: 'Account created. You can sign in now.' })
    } catch (error) {
      await deleteRow('profiles', { user_id: user.id })
      await deleteRow('users', { id: user.id })
      throw error
    }
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.email_normalized) return res.status(409).json({ message: 'An account with that email already exists.' })
    throw error
  }
})

app.post('/api/auth/login', limitAuth, async (req, res) => {
  const { email, password } = req.body || {}
  if (!validEmail(email) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ message: 'Enter a valid email and password.' })
  const user = await findRow('users', { email_normalized: email.trim().toLowerCase() }, { projection: { id: 1, email: 1, role: 1, password_hash: 1, token_version: 1 } })
  if (!user) return res.status(401).json({ message: 'Email or password is incorrect.' })
  const [salt, storedHash] = user.password_hash.split(':')
  const candidate = await scrypt(password, salt, 64)
  const expected = Buffer.from(storedHash, 'hex')
  if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return res.status(401).json({ message: 'Email or password is incorrect.' })
  return res.json({ token: signToken(user.id, user.token_version), user: await publicUser(user) })
})

app.get('/api/auth/verify', limitAuth, async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!token || token.length > 200) return res.status(400).json({ message: 'Verification link is invalid or expired.' })
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const action = await findRow('account_tokens', { token_hash: tokenHash, purpose: 'verify_email', expires_at: { $gt: Date.now() } })
  if (!action) return res.status(400).json({ message: 'Verification link is invalid or expired. Request a new one and try again.' })
  await updateRow('users', { id: action.user_id }, { $set: { email_verified: true } })
  await deleteRow('account_tokens', { token_hash: tokenHash })
  return res.json({ message: 'Email verified. You can now sign in.' })
})

app.post('/api/auth/resend-verification', limitAuth, async (req, res) => {
  const email = req.body?.email
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' })
  await deleteRows('account_tokens', { expires_at: { $lte: Date.now() } })
  const user = await findRow('users', { email_normalized: email.trim().toLowerCase(), email_verified: false })
  const developmentLink = user ? await createAccountAction(user.id, user.email, 'verify_email') : null
  return res.json({ message: 'If that account needs verification, a link has been sent.', ...(developmentLink ? { developmentLink } : {}) })
})

app.post('/api/auth/forgot-password', limitAuth, async (req, res) => {
  const email = req.body?.email
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' })
  await deleteRows('account_tokens', { expires_at: { $lte: Date.now() } })
  const user = await findRow('users', { email_normalized: email.trim().toLowerCase() })
  const developmentLink = user ? await createAccountAction(user.id, user.email, 'reset_password') : null
  return res.json({ message: 'If an account exists for that email, a password reset link has been sent.', ...(developmentLink ? { developmentLink } : {}) })
})

app.post('/api/auth/reset-password', limitAuth, async (req, res) => {
  const { token, password } = req.body || {}
  if (typeof token !== 'string' || token.length > 200 || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: 'Use a valid reset link and a password of 8 to 128 characters.' })
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const action = await findRow('account_tokens', { token_hash: tokenHash, purpose: 'reset_password', expires_at: { $gt: Date.now() } })
  if (!action) return res.status(400).json({ message: 'Reset link is invalid or expired. Request another link and try again.' })
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`
  await updateRow('users', { id: action.user_id }, { $set: { password_hash: passwordHash }, $inc: { token_version: 1 } })
  await deleteRows('account_tokens', { user_id: action.user_id })
  return res.json({ message: 'Password reset. Sign in with your new password.' })
})

app.get('/api/me', auth, async (req, res) => res.json({ user: await publicUser(req.user) }))
app.get('/api/auth/profile', auth, async (req, res) => res.json({ user: await publicUser(req.user) }))
async function updateProfile(req, res) {
  const patch = profileFields(req.body, req.user.role)
  if (!patch) return res.status(400).json({ message: 'Profile contains unsupported or invalid fields.' })
  const updated = { ...await profileFor(req.user.id), ...patch }
  await updateRow('profiles', { user_id: req.user.id }, { $set: { data_json: updated, updated_at: new Date().toISOString() } })
  await logActivity(req.user.id, 'profile', 'Updated profile')
  return res.json({ user: await publicUser(req.user) })
}
app.patch('/api/auth/profile', auth, updateProfile)
app.put('/api/auth/profile', auth, updateProfile)
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } })
app.post('/api/auth/profile/image', auth, imageUpload.single('image'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image.' })
  const buffer = file.buffer
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
  const mimeType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : null
  if (!mimeType) return res.status(400).json({ message: 'The selected file is not a supported image.' })
  await db.collection('profile_images').updateOne({ user_id: req.user.id }, { $set: { mime_type: mimeType, image_data: buffer, updated_at: new Date().toISOString() }, $setOnInsert: { user_id: req.user.id } }, { upsert: true })
  res.json({ message: 'Profile image updated.' })
})
app.get('/api/auth/profile/image', auth, async (req, res) => {
  const image = await findRow('profile_images', { user_id: req.user.id })
  if (!image) return res.status(404).json({ message: 'No profile image is set.' })
  res.set({ 'Content-Type': image.mime_type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' }).send(binaryBuffer(image.image_data))
})
app.get('/api/notifications', auth, async (req, res) => {
  const notifications = (await findRows('notifications', { user_id: req.user.id }, { sort: { created_at: -1 }, limit: 50 })).map(({ _id, id, kind, title, detail, read_at, created_at }) => ({ id, kind, title, detail, readAt: read_at, createdAt: created_at }))
  const unread = await countRows('notifications', { user_id: req.user.id, read_at: null })
  res.json({ notifications, unread })
})
app.patch('/api/notifications/:id', auth, async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid notification id.' })
  const result = await updateRow('notifications', { id: Number(req.params.id), user_id: req.user.id }, { $set: { read_at: new Date().toISOString() } })
  if (!result.matchedCount) return res.status(404).json({ message: 'Notification not found.' })
  res.json({ read: true })
})

app.get('/api/jobs', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12))
  const filters = { status: 'open' }
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  for (const key of ['domain', 'location', 'type']) {
    const value = typeof req.query[key] === 'string' ? req.query[key].trim() : ''
    if (value) filters[key] = { $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
  }
  let jobs = await findRows('opportunities', filters, { sort: { created_at: -1 } })
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const profiles = await findRows('profiles', { user_id: { $in: [...new Set(jobs.map((job) => job.company_id))] } })
    const companyNames = new Map(profiles.map((profile) => [profile.user_id, profile.data_json.companyName || 'Employer']))
    jobs = jobs.filter((job) => pattern.test(`${job.title} ${job.description} ${companyNames.get(job.company_id) || ''}`))
  }
  const total = jobs.length
  jobs = await Promise.all(jobs.slice((page - 1) * limit, page * limit).map(async (job) => ({
    ...job,
    company: (await profileFor(job.company_id)).companyName || 'Employer',
  })))
  res.json({ jobs, total, page, pages: Math.ceil(total / limit) })
})

function savedResumeAttachment(title, contentValue) {
  const content = parseJson(contentValue)
  const sections = [
    String(content.fullName || ''),
    String(content.email || ''),
    String(content.phone || ''),
    title,
    String(content.summary || ''),
    ...(['skills', 'education', 'experience', 'projects', 'certifications'].flatMap((key) => {
      const values = content[key]
      return Array.isArray(values) && values.length ? [`\n${key.toUpperCase()}`, ...values.map(String)] : []
    })),
  ].filter(Boolean).join('\n')
  const safeTitle = title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'resume'
  return { fileName: `${safeTitle}.txt`, contentType: 'text/plain; charset=utf-8', data: Buffer.from(sections, 'utf8'), searchText: sections }
}

async function uploadedResumeAttachment(file) {
  const extension = path.extname(file.originalname).toLowerCase()
  const fileName = path.basename(file.originalname).replace(/[\r\n"]/g, '_')
  if (!text(fileName, 200)) return null
  if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') {
    try {
      const parsed = await pdfParse(file.buffer)
      return { fileName, contentType: 'application/pdf', data: file.buffer, searchText: String(parsed.text || '') }
    } catch (error) {
      console.error('PDF resume parsing failed:', { size: file.buffer.length, error: error.message })
      return null
    }
  }
  if (extension === '.txt' && file.buffer.length > 0 && !file.buffer.includes(0)) {
    return { fileName, contentType: 'text/plain; charset=utf-8', data: file.buffer, searchText: file.buffer.toString('utf8') }
  }
  return null
}

function applicationCanBeChanged(application) {
  const today = new Date().toISOString().slice(0, 10)
  return !application.withdrawn_at && application.jobStatus === 'open' && (!application.deadline || application.deadline >= today)
}

app.post('/api/jobs/:id/apply', auth, role('student'), singleResumeUpload, async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' })
  const details = req.body
  const allowedFields = ['fullName', 'email', 'phone', 'coverLetter', 'resumeId']
  if (!details || typeof details !== 'object' || Array.isArray(details) || Object.keys(details).some((key) => !allowedFields.includes(key))) {
    return res.status(400).json({ message: 'Enter your name and email to apply.' })
  }
  const { fullName, email, phone = '', coverLetter = '' } = details
  if (!text(fullName, 120) || !text(email, 254) || !validEmail(email) ||
    typeof phone !== 'string' || phone.length > 40 ||
    typeof coverLetter !== 'string' || coverLetter.length > 2000) {
    return res.status(400).json({ message: 'Check your application details and try again.' })
  }
  const resumeId = details.resumeId === undefined || details.resumeId === '' ? null : Number(details.resumeId)
  if (req.file && resumeId !== null) return res.status(400).json({ message: 'Choose a saved resume or upload a file, not both.' })
  const job = await findRow('opportunities', { id: Number(req.params.id) })
  if (!job) return res.status(404).json({ message: 'Job not found.' })
  if (job.status !== 'open') return res.status(410).json({ message: 'This opportunity is closed.' })
  if (job.deadline && job.deadline < new Date().toISOString().slice(0, 10)) return res.status(410).json({ message: 'The application deadline has passed.' })
  if (!req.file && !numberId(resumeId)) return res.status(400).json({ message: 'Choose a saved resume or upload a PDF or TXT resume.' })
  const savedResume = resumeId === null ? null : await findRow('resumes', { id: resumeId, student_id: req.user.id })
  if (resumeId !== null && !savedResume) return res.status(400).json({ message: 'The selected resume is no longer available. Choose another resume or upload a file.' })
  const resumeAttachment = req.file
    ? await uploadedResumeAttachment(req.file)
    : savedResumeAttachment(savedResume.title, savedResume.content)
  if (!resumeAttachment) return res.status(400).json({ message: 'Upload a readable text-based PDF or TXT resume.' })
  try {
    const application = await insertRow('applications', {
      opportunity_id: job.id,
      student_id: req.user.id,
      status: 'applied',
      withdrawn_at: null,
      applied_at: new Date().toISOString(),
      details: { full_name: fullName.trim(), email: email.trim(), phone: phone.trim(), cover_letter: coverLetter.trim() },
      resume: { file_name: resumeAttachment.fileName, content_type: resumeAttachment.contentType, resume_data: resumeAttachment.data, search_text: resumeAttachment.searchText },
      history: [{ actor_id: req.user.id, new_status: 'applied', created_at: new Date().toISOString() }],
    })
    await createNotification(job.company_id, 'application', 'New job application', 'A candidate applied to one of your open jobs.')
    await logActivity(req.user.id, 'application', 'Applied to an opportunity')
    res.status(201).json({ message: 'Application submitted.', id: application.id })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'You have already applied to this opportunity.' })
    throw error
  }
})

function sendResumeAttachment(res, resume) {
  res.set('Cache-Control', 'private, no-store')
    .set('Content-Type', resume.contentType)
    .attachment(resume.fileName)
    .send(binaryBuffer(resume.data))
}

app.get('/api/students/me/applications', auth, role('student'), async (req, res) => {
  const rows = await findRows('applications', { student_id: req.user.id }, { sort: { applied_at: -1 } })
  const applications = await Promise.all(rows.map(async (item) => {
    const [job, student, companyProfile] = await Promise.all([
      findRow('opportunities', { id: item.opportunity_id }),
      findRow('users', { id: item.student_id }),
      findRow('opportunities', { id: item.opportunity_id }).then((opportunity) => opportunity ? profileFor(opportunity.company_id) : {}),
    ])
    if (!job) return null
    const studentProfile = await profileFor(item.student_id)
    return {
      id: item.id,
      status: item.withdrawn_at ? 'withdrawn' : item.status,
      withdrawnAt: item.withdrawn_at,
      appliedAt: item.applied_at,
      jobId: job.id,
      title: job.title,
      domain: job.domain,
      location: job.location,
      type: job.type,
      fullName: item.details?.full_name || studentProfile.fullName || '',
      email: item.details?.email || student?.email || '',
      phone: item.details?.phone || studentProfile.phone || '',
      coverLetter: item.details?.cover_letter || '',
      resumeName: item.resume?.file_name || '',
      company: companyProfile.companyName || 'Employer',
      canModify: applicationCanBeChanged({ withdrawn_at: item.withdrawn_at, jobStatus: job.status, deadline: job.deadline }),
      history: (item.history || []).map((entry) => ({ oldStatus: entry.old_status, newStatus: entry.new_status, createdAt: entry.created_at })),
    }
  }))
  res.json({ applications: applications.filter(Boolean) })
})
app.get('/api/students/me/applications/:id/resume', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid application id.' })
  const application = await findRow('applications', { id: Number(req.params.id), student_id: req.user.id })
  if (!application?.resume) return res.status(404).json({ message: 'Resume not found.' })
  sendResumeAttachment(res, { fileName: application.resume.file_name, contentType: application.resume.content_type, data: application.resume.resume_data })
})
app.patch('/api/students/me/applications/:id', auth, role('student'), singleResumeUpload, async (req, res) => {
  const id = Number(req.params.id)
  if (!numberId(id)) return res.status(400).json({ message: 'Invalid application id.' })
  const details = req.body
  const allowedFields = ['fullName', 'email', 'phone', 'coverLetter']
  if (!details || typeof details !== 'object' || Array.isArray(details) || Object.keys(details).some((key) => !allowedFields.includes(key))) {
    return res.status(400).json({ message: 'Check the application details and try again.' })
  }
  const { fullName, email, phone = '', coverLetter = '' } = details
  if (!text(fullName, 120) || !text(email, 254) || !validEmail(email) ||
    typeof phone !== 'string' || phone.length > 40 ||
    typeof coverLetter !== 'string' || coverLetter.length > 2000) {
    return res.status(400).json({ message: 'Check your application details and try again.' })
  }
  const application = await findRow('applications', { id, student_id: req.user.id })
  if (!application) return res.status(404).json({ message: 'Application not found.' })
  const job = await findRow('opportunities', { id: application.opportunity_id })
  if (!job || !applicationCanBeChanged({ withdrawn_at: application.withdrawn_at, jobStatus: job.status, deadline: job.deadline })) return res.status(409).json({ message: 'This application can no longer be changed.' })
  const attachment = req.file ? await uploadedResumeAttachment(req.file) : null
  if (req.file && !attachment) return res.status(400).json({ message: 'Upload a readable text-based PDF or TXT resume.' })
  const changes = {
    'details.full_name': fullName.trim(),
    'details.email': email.trim(),
    'details.phone': phone.trim(),
    'details.cover_letter': coverLetter.trim(),
  }
  if (attachment) Object.assign(changes, {
    'resume.file_name': attachment.fileName,
    'resume.content_type': attachment.contentType,
    'resume.resume_data': attachment.data,
    'resume.search_text': attachment.searchText,
  })
  await updateRow('applications', { id, student_id: req.user.id }, { $set: changes })
  await logActivity(req.user.id, 'application', 'Updated an application')
  res.json({ message: 'Application updated.' })
})
app.delete('/api/students/me/applications/:id', auth, role('student'), async (req, res) => {
  const id = Number(req.params.id)
  if (!numberId(id)) return res.status(400).json({ message: 'Invalid application id.' })
  const application = await findRow('applications', { id, student_id: req.user.id })
  if (!application) return res.status(404).json({ message: 'Application not found.' })
  const job = await findRow('opportunities', { id: application.opportunity_id })
  if (!job || !applicationCanBeChanged({ withdrawn_at: application.withdrawn_at, jobStatus: job.status, deadline: job.deadline })) return res.status(409).json({ message: 'This application can no longer be withdrawn.' })
  const now = new Date().toISOString()
  await updateRow('applications', { id, student_id: req.user.id }, { $set: { withdrawn_at: now }, $push: { history: { actor_id: req.user.id, old_status: application.status, new_status: 'withdrawn', created_at: now } } })
  await createNotification(job.company_id, 'application', 'Application withdrawn', 'A candidate withdrew an application to one of your open jobs.')
  await logActivity(req.user.id, 'application', 'Withdrew an application')
  res.json({ message: 'Application withdrawn.' })
})

app.get('/api/students/me/saved-jobs', auth, role('student'), async (req, res) => {
  const saved = await findRows('saved_jobs', { student_id: req.user.id }, { sort: { created_at: -1 } })
  const jobs = (await Promise.all(saved.map(async (item) => {
    const job = await findRow('opportunities', { id: item.opportunity_id })
    if (!job) return null
    return { id: job.id, title: job.title, domain: job.domain, location: job.location, type: job.type, company: (await profileFor(job.company_id)).companyName || 'Employer' }
  }))).filter(Boolean)
  res.json({ jobs })
})
app.post('/api/students/me/saved-jobs', auth, role('student'), async (req, res) => {
  const id = Number(req.body?.jobId)
  if (!numberId(id) || !await findRow('opportunities', { id, status: 'open' })) return res.status(404).json({ message: 'Open job not found.' })
  await db.collection('saved_jobs').updateOne({ student_id: req.user.id, opportunity_id: id }, { $setOnInsert: { id: await nextId('saved_jobs'), student_id: req.user.id, opportunity_id: id, created_at: new Date().toISOString() } }, { upsert: true })
  res.status(201).json({ saved: true })
})
app.delete('/api/students/me/saved-jobs/:id', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' })
  await deleteRow('saved_jobs', { student_id: req.user.id, opportunity_id: Number(req.params.id) })
  res.status(204).end()
})

function jobAlertInput(body) {
  const keys = ['keyword', 'domain', 'location', 'type']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key))) return null
  const values = Object.fromEntries(keys.map((key) => [key, body[key] ?? '']))
  if (keys.some((key) => typeof values[key] !== 'string' || values[key].length > 120)) return null
  for (const key of keys) values[key] = values[key].trim()
  if (!keys.some((key) => values[key])) return null
  if (values.type && !['Full-time', 'Internship', 'Contract', 'Part-time'].includes(values.type)) return null
  return values
}

app.get('/api/students/me/job-alerts', auth, role('student'), async (req, res) => {
  const alerts = (await findRows('job_alerts', { student_id: req.user.id }, { sort: { created_at: -1 } }))
    .map(({ id, keyword, domain, location, type, created_at }) => ({ id, keyword, domain, location, type, createdAt: created_at }))
  res.json({ alerts })
})
app.post('/api/students/me/job-alerts', auth, role('student'), async (req, res) => {
  const values = jobAlertInput(req.body)
  if (!values) return res.status(400).json({ message: 'Add a keyword, domain, location, or job type to create an alert.' })
  const count = await countRows('job_alerts', { student_id: req.user.id })
  if (count >= 10) return res.status(400).json({ message: 'You can create up to 10 job alerts.' })
  try {
    const alert = await insertRow('job_alerts', {
      student_id: req.user.id,
      ...values,
      keyword_normalized: values.keyword.toLowerCase(),
      domain_normalized: values.domain.toLowerCase(),
      location_normalized: values.location.toLowerCase(),
      type_normalized: values.type.toLowerCase(),
    })
    res.status(201).json({ alert: { id: alert.id, ...values } })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That job alert already exists.' })
    throw error
  }
})
app.delete('/api/students/me/job-alerts/:id', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid job alert id.' })
  const result = await deleteRow('job_alerts', { id: Number(req.params.id), student_id: req.user.id })
  if (!result.deletedCount) return res.status(404).json({ message: 'Job alert not found.' })
  res.status(204).end()
})

function jobInput(body) {
  const keys = ['title', 'type', 'domain', 'location', 'salary', 'description', 'requirements', 'deadline']
  if (!body || Object.keys(body).some((key) => !keys.includes(key))) return null
  const values = Object.fromEntries(keys.map((key) => [key, body[key] ?? '']))
  if (!text(values.title, 150) || !text(values.description, 10000)) return null
  if (keys.some((key) => typeof values[key] !== 'string' || values[key].length > 10000)) return null
  return values
}

async function notifyStudentsOfJob(job, companyName, students) {
  const alerts = await findRows('job_alerts')
  const searchable = `${job.title} ${job.description} ${job.domain} ${companyName}`.toLowerCase()
  const matchingStudents = new Set()
  for (const alert of alerts) {
    if (alert.keyword && !searchable.includes(alert.keyword.toLowerCase())) continue
    if (alert.domain && !job.domain.toLowerCase().includes(alert.domain.toLowerCase())) continue
    if (alert.location && !job.location.toLowerCase().includes(alert.location.toLowerCase())) continue
    if (alert.type && alert.type.toLowerCase() !== job.type.toLowerCase()) continue
    matchingStudents.add(alert.student_id)
  }
  for (const student of students) {
    const matched = matchingStudents.has(student.id)
    await createNotification(
      student.id,
      'job',
      matched ? 'New job matches your alert' : 'New job posted',
      matched
        ? `${job.title} at ${companyName} matches a saved job alert.`
        : `${job.title} at ${companyName} is now open.`,
    )
  }
}

app.get('/api/company/overview', auth, role('company'), async (req, res) => {
  const companyJobs = await findRows('opportunities', { company_id: req.user.id })
  const jobs = { total: companyJobs.length, open: companyJobs.filter((job) => job.status === 'open').length }
  const jobIds = companyJobs.map((job) => job.id)
  const applications = await findRows('applications', { opportunity_id: { $in: jobIds }, withdrawn_at: null })
  const pipeline = Object.fromEntries(['interested', 'applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected']
    .map((status) => [status, applications.filter((application) => application.status === status).length]))
  const recentApplicants = await Promise.all([...applications]
    .sort((a, b) => b.applied_at.localeCompare(a.applied_at))
    .slice(0, 5)
    .map(async (application) => {
      const [job, student, profile] = await Promise.all([
        findRow('opportunities', { id: application.opportunity_id }),
        findRow('users', { id: application.student_id }),
        profileFor(application.student_id),
      ])
      return {
        applicationId: application.id,
        status: application.status,
        appliedAt: application.applied_at,
        jobTitle: job?.title || '',
        fullName: application.details?.full_name || profile.fullName || student?.email.split('@')[0] || '',
      }
    }))
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const week = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const recentCutoff = new Date(now.getTime() - 7 * 86400000).toISOString()
  const jobsNeedingAttention = companyJobs.filter((job) => job.status === 'open').map((job) => {
    const matching = applications.filter((application) => application.opportunity_id === job.id)
    return {
      id: job.id,
      title: job.title,
      deadline: job.deadline,
      applicants: matching.length,
      recentApplicants: matching.filter((application) => application.applied_at >= recentCutoff).length,
      deadlinePassed: Boolean(job.deadline && job.deadline < today),
      closingSoon: Boolean(job.deadline && job.deadline >= today && job.deadline <= week),
    }
  }).filter((job) => (job.deadline && job.deadline <= week) || job.recentApplicants > 0)
    .sort((a, b) => (a.deadlinePassed ? 0 : a.deadline ? 1 : 2) - (b.deadlinePassed ? 0 : b.deadline ? 1 : 2) ||
      (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.recentApplicants - a.recentApplicants)
    .slice(0, 5)
  res.json({
    jobs: { total: jobs.total || 0, open: jobs.open || 0 },
    applications: {
      total: applications.length,
      shortlisted: pipeline.shortlisted || 0,
      interview: pipeline.interview || 0,
      selected: pipeline.selected || 0,
    },
    pipeline,
    recentApplicants,
    jobsNeedingAttention,
  })
})
app.get('/api/jobs/mine', auth, role('company'), async (req, res) => {
  const jobs = await findRows('opportunities', { company_id: req.user.id }, { sort: { created_at: -1 } })
  await Promise.all(jobs.map(async (job) => { job.applicants = await countRows('applications', { opportunity_id: job.id, withdrawn_at: null }) }))
  res.json({ jobs })
})
app.get('/api/jobs/:id', async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' })
  const job = await findRow('opportunities', { id: Number(req.params.id), status: 'open' })
  if (!job) return res.status(404).json({ message: 'Job not found.' })
  job.company = (await profileFor(job.company_id)).companyName || 'Employer'
  res.json({ job })
})
app.post('/api/jobs', auth, role('company'), async (req, res) => {
  const values = jobInput(req.body)
  if (!values) return res.status(400).json({ message: 'Enter a job title and description; keep fields within 10,000 characters.' })
  const job = await insertRow('opportunities', { company_id: req.user.id, ...values, title: values.title.trim(), deadline: values.deadline || null, status: 'open' })
  await logActivity(req.user.id, 'job', 'Posted a new opportunity')
  const companyName = (await profileFor(req.user.id)).companyName || 'Employer'
  const students = await findRows('users', { role: 'student' }, { projection: { id: 1, email: 1 } })
  await notifyStudentsOfJob(job, companyName, students)
  const recipients = await Promise.all(students.map(async (student) => ({
    email: student.email,
    profile: await profileFor(student.id),
  })))
  const notifications = await sendJobNotifications({
    recipients,
    job,
    companyName,
    jobUrl: new URL('/dashboard/jobs', appBaseUrl).toString(),
  })
  res.status(201).json({ job, notifications: { ...notifications, inAppSent: students.length } })
})
app.patch('/api/jobs/:id', auth, role('company'), async (req, res) => {
  const id = Number(req.params.id)
  if (!numberId(id)) return res.status(400).json({ message: 'Invalid job id.' })
  const job = await findRow('opportunities', { id, company_id: req.user.id })
  if (!job) return res.status(404).json({ message: 'Job not found.' })
  const keys = ['title', 'type', 'domain', 'location', 'salary', 'description', 'requirements', 'deadline']
  const values = jobInput(Object.fromEntries(keys.map((key) => [key, req.body[key] ?? job[key]])))
  if (!values) return res.status(400).json({ message: 'Job details are invalid.' })
  const status = req.body.status ?? job.status
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ message: 'Invalid job status.' })
  await updateRow('opportunities', { id, company_id: req.user.id }, { $set: { ...values, deadline: values.deadline || null, status } })
  res.json({ job: await findRow('opportunities', { id }) })
})
app.delete('/api/jobs/:id', auth, role('company'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' })
  const filter = { id: Number(req.params.id), company_id: req.user.id }
  const job = await findRow('opportunities', filter)
  if (!job) return res.status(404).json({ message: 'Job not found.' })
  await Promise.all([
    deleteRows('applications', { opportunity_id: job.id }),
    deleteRows('saved_jobs', { opportunity_id: job.id }),
  ])
  const result = await deleteRow('opportunities', filter)
  if (!result.deletedCount) return res.status(404).json({ message: 'Job not found.' })
  res.status(204).end()
})

async function applicantRows(companyId, status) {
  const jobs = await findRows('opportunities', { company_id: companyId }, { projection: { id: 1 } })
  const filter = { opportunity_id: { $in: jobs.map((job) => job.id) }, withdrawn_at: null }
  if (status) filter.status = status
  const applications = await findRows('applications', filter, { sort: { applied_at: -1 } })
  return Promise.all(applications.map(async (item) => {
    const [user, profile, job] = await Promise.all([
      findRow('users', { id: item.student_id }),
      profileFor(item.student_id),
      findRow('opportunities', { id: item.opportunity_id }),
    ])
    return {
      applicationId: item.id,
      status: item.status,
      appliedAt: item.applied_at,
      studentId: item.student_id,
      email: item.details?.email || user?.email || '',
      jobTitle: job?.title || '',
      jobId: item.opportunity_id,
      coverLetter: item.details?.cover_letter || '',
      resumeName: item.resume?.file_name || '',
      resumeSearchText: item.resume?.search_text || '',
      profile: {
        ...profile,
        fullName: item.details?.full_name || profile.fullName,
        phone: item.details?.phone ?? profile.phone,
      },
    }
  }))
}
app.get('/api/company/applicants', auth, role('company'), async (req, res) => {
  const validStatuses = ['interested', 'applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected']
  const status = typeof req.query.status === 'string' && validStatuses.includes(req.query.status) ? req.query.status : ''
  const skills = typeof req.query.skills === 'string' ? req.query.skills.trim().toLowerCase() : ''
  const experience = typeof req.query.experience === 'string' ? req.query.experience.trim().toLowerCase() : ''
  if (skills.length > 120 || experience.length > 120) return res.status(400).json({ message: 'Applicant filters must be 120 characters or fewer.' })
  let applicants = await applicantRows(req.user.id, status)
  const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase().trim() : ''
  if (search) applicants = applicants.filter((a) => `${a.profile.fullName || ''} ${a.email} ${a.jobTitle}`.toLowerCase().includes(search))
  if (skills) applicants = applicants.filter((a) => `${a.profile.skills || ''} ${a.resumeSearchText}`.toLowerCase().includes(skills))
  if (experience) applicants = applicants.filter((a) => `${a.profile.experience || ''} ${a.resumeSearchText}`.toLowerCase().includes(experience))
  res.json({ applicants: applicants.map(({ resumeSearchText: _resumeSearchText, ...item }) => item) })
})
app.get('/api/company/applicants/:id', auth, role('company'), async (req, res) => {
  const id = Number(req.params.id)
  if (!numberId(id)) return res.status(400).json({ message: 'Invalid application id.' })
  const applicant = (await applicantRows(req.user.id, '')).find((item) => item.applicationId === id)
  if (!applicant) return res.status(404).json({ message: 'Applicant not found.' })
  const { resumeSearchText: _resumeSearchText, ...details } = applicant
  const history = (await findRow('applications', { id }))?.history?.map((entry) => ({ oldStatus: entry.old_status, newStatus: entry.new_status, createdAt: entry.created_at })) || []
  res.json({ applicant: { ...details, history } })
})
app.get('/api/company/applicants/:id/resume', auth, role('company'), async (req, res) => {
  const id = Number(req.params.id)
  if (!numberId(id)) return res.status(400).json({ message: 'Invalid application id.' })
  const application = await findRow('applications', { id })
  const job = application && await findRow('opportunities', { id: application.opportunity_id, company_id: req.user.id })
  if (!job || !application?.resume) return res.status(404).json({ message: 'Resume not found.' })
  const resume = { fileName: application.resume.file_name, contentType: application.resume.content_type, data: application.resume.resume_data }
  sendResumeAttachment(res, resume)
})
app.patch('/api/company/applicants/:id', auth, role('company'), async (req, res) => {
  const id = Number(req.params.id)
  const status = req.body?.status
  const statuses = ['interested', 'applied', 'shortlisted', 'assessment', 'interview', 'selected', 'rejected']
  if (!numberId(id) || !statuses.includes(status)) return res.status(400).json({ message: 'Choose a valid application status.' })
  const owned = await findRow('applications', { id, withdrawn_at: null })
  const job = owned && await findRow('opportunities', { id: owned.opportunity_id, company_id: req.user.id })
  if (!owned || !job) return res.status(404).json({ message: 'Applicant not found.' })
  const update = { $set: { status } }
  if (owned.status !== status) update.$push = { history: { actor_id: req.user.id, old_status: owned.status, new_status: status, created_at: new Date().toISOString() } }
  await updateRow('applications', { id }, update)
  await createNotification(owned.student_id, 'application', 'Application status updated', `Your application status changed to ${status}.`)
  res.json({ applicationId: id, status })
})
app.get('/api/company/reports.csv', auth, role('company'), async (req, res) => {
  const jobs = await findRows('opportunities', { company_id: req.user.id }, { sort: { created_at: -1 } })
  const jobById = new Map(jobs.map((job) => [job.id, job]))
  const rows = (await applicantRows(req.user.id, '')).map((applicant) => ({ ...applicant, job: jobById.get(applicant.jobId) }))
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = ['Job,Type,Job Status,Candidate,Email,Application Status,Applied At', ...rows.map((row) => {
    return [row.job.title, row.job.type, row.job.status, row.profile.fullName, row.email, row.status, row.appliedAt].map(escape).join(',')
  })].join('\r\n')
  res.type('text/csv').attachment('company-hiring-report.csv').send(csv)
})

app.get('/api/resume', auth, role('student'), async (req, res) => {
  const resumes = await findRows('resumes', { student_id: req.user.id }, { sort: { updated_at: -1 } })
  res.json({ resumes: resumes.map(({ id, title, content, created_at, updated_at }) => ({ id, title, content, createdAt: created_at, updatedAt: updated_at })) })
})
function resumePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const allowed = ['title', 'summary', 'skills', 'education', 'experience', 'projects', 'certifications', 'email', 'phone', 'fullName']
  if (Object.keys(body).some((key) => !allowed.includes(key))) return null
  if (!text(body.title, 100)) return null
  for (const key of ['summary', 'email', 'phone', 'fullName']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 4000)) return null
  const content = { ...body }
  for (const key of ['skills', 'education', 'experience', 'projects', 'certifications']) {
    if (content[key] === undefined) content[key] = []
    if (!Array.isArray(content[key]) || content[key].length > 50 || content[key].some((value) => typeof value !== 'string' || value.length > 1000)) return null
  }
  return { title: body.title.trim(), content }
}
app.post('/api/resume', auth, role('student'), async (req, res) => {
  const item = resumePayload(req.body)
  if (!item) return res.status(400).json({ message: 'Resume details are invalid.' })
  const resume = await insertRow('resumes', { student_id: req.user.id, title: item.title, content: item.content, updated_at: new Date().toISOString() })
  await logActivity(req.user.id, 'resume', 'Created a resume')
  res.status(201).json({ resume: { id: resume.id, ...item } })
})
app.put('/api/resume/:id', auth, role('student'), async (req, res) => {
  const item = resumePayload(req.body)
  if (!numberId(req.params.id) || !item) return res.status(400).json({ message: 'Resume details are invalid.' })
  const result = await updateRow('resumes', { id: Number(req.params.id), student_id: req.user.id }, { $set: { title: item.title, content: item.content, updated_at: new Date().toISOString() } })
  if (!result.matchedCount) return res.status(404).json({ message: 'Resume not found.' })
  res.json({ resume: { id: Number(req.params.id), ...item } })
})
app.delete('/api/resume/:id', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid resume id.' })
  const result = await deleteRow('resumes', { id: Number(req.params.id), student_id: req.user.id })
  if (!result.deletedCount) return res.status(404).json({ message: 'Resume not found.' })
  res.status(204).end()
})

app.post('/api/ats/upload', auth, role('student'), upload.single('resume'), async (req, res) => {
  const file = req.file
  const jobDescription = req.body?.jobDescription
  if (!file || !text(jobDescription, 20000)) return res.status(400).json({ message: 'Choose a resume file and enter a job description.' })
  const extension = path.extname(file.originalname).toLowerCase()
  let resumeText
  if (extension === '.txt' && !file.buffer.includes(0)) resumeText = file.buffer.toString('utf8')
  else if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') {
    try { resumeText = (await pdfParse(file.buffer)).text } catch { return res.status(400).json({ message: 'This PDF could not be read. Try a text-based PDF or TXT file.' }) }
  } else return res.status(400).json({ message: 'Upload a text-based PDF or TXT file.' })
  if (!resumeText.trim()) return res.status(400).json({ message: 'No readable text was found in the resume.' })
  const words = (value) => new Set((value.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || []).filter((word) => word.length > 2))
  const terms = [...words(jobDescription)]
  const resumeTerms = words(resumeText)
  const matched = terms.filter((term) => resumeTerms.has(term))
  const missing = terms.filter((term) => !resumeTerms.has(term)).slice(0, 15)
  const sections = ['education', 'experience', 'skills', 'projects']
  const presentSections = sections.filter((section) => resumeText.toLowerCase().includes(section))
  const keywordScore = terms.length ? Math.round((matched.length / terms.length) * 100) : 0
  const structureScore = Math.round((presentSections.length / sections.length) * 100)
  const score = Math.round(keywordScore * 0.75 + structureScore * 0.25)
  const report = { score, keywordScore, structureScore, matched, missing, presentSections, method: 'Local keyword and section heuristic; not a hiring prediction.' }
  const analysis = await insertRow('ats_analyses', { student_id: req.user.id, file_name: path.basename(file.originalname).slice(0, 200), job_description: jobDescription, report })
  await logActivity(req.user.id, 'ats', 'Analyzed a resume')
  res.status(201).json({ id: analysis.id, fileName: analysis.file_name, ...report })
})
app.get('/api/resume/score', auth, role('student'), async (req, res) => {
  const rows = (await findRows('ats_analyses', { student_id: req.user.id }, { sort: { created_at: -1 }, limit: 50 }))
    .map(({ id, file_name, report, created_at }) => ({ id, fileName: file_name, report, createdAt: created_at }))
  res.json({ analyses: rows })
})
app.delete('/api/resume/score/:id', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid analysis id.' })
  const result = await deleteRow('ats_analyses', { id: Number(req.params.id), student_id: req.user.id })
  if (!result.deletedCount) return res.status(404).json({ message: 'Analysis not found.' })
  res.status(204).end()
})

app.get('/api/questions', async (req, res) => {
  const mode = req.query.mode === 'interview' ? 'interview' : 'aptitude'
  const topic = typeof req.query.topic === 'string' ? req.query.topic : ''
  const rows = await findRows('practice_questions', { mode, ...(topic ? { topic } : {}) }, { sort: { id: 1 }, projection: { id: 1, topic: 1, prompt: 1, options: 1 } })
  res.json({ questions: rows })
})
app.post('/api/practice/sessions', auth, role('student'), async (req, res) => {
  const mode = req.body?.mode
  const topic = typeof req.body?.topic === 'string' ? req.body.topic : ''
  if (!['aptitude', 'interview'].includes(mode)) return res.status(400).json({ message: 'Choose aptitude or interview practice.' })
  const question = await findRow('practice_questions', { mode, topic })
  if (!question) return res.status(404).json({ message: 'No questions are available for this practice topic.' })
  const session = await insertRow('practice_sessions', { student_id: req.user.id, mode, topic, status: 'active', score: null, answers: [] })
  await logActivity(req.user.id, 'practice', `Started ${mode} practice`)
  res.status(201).json({ id: session.id, mode, topic })
})
app.post('/api/practice/sessions/:id/answers', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id) || !numberId(req.body?.questionId) || !text(req.body?.answer, 4000)) return res.status(400).json({ message: 'Provide a session, question, and answer.' })
  const session = await findRow('practice_sessions', { id: Number(req.params.id), student_id: req.user.id, status: 'active' })
  if (!session) return res.status(404).json({ message: 'Active practice session not found.' })
  const question = await findRow('practice_questions', { id: Number(req.body.questionId), mode: session.mode, topic: session.topic })
  if (!question) return res.status(404).json({ message: 'Question not found for this session.' })
  let isCorrect = null
  let feedback = question.explanation
  if (session.mode === 'aptitude') {
    isCorrect = req.body.answer.trim().toLowerCase() === question.answer.toLowerCase()
  } else {
    const answerWords = req.body.answer.trim().split(/\s+/).filter(Boolean).length
    const hasAction = /\b(I|we|built|created|improved|implemented|led|tested|designed|resolved)\b/i.test(req.body.answer)
    feedback = `Practice rubric: ${answerWords >= 40 ? 'good answer depth' : 'add more specific detail'}; ${hasAction ? 'your actions are clear' : 'explain the actions you personally took'}. This is structured self-practice feedback, not an AI evaluation.`
  }
  const answer = { question_id: question.id, answer_text: req.body.answer.trim(), is_correct: isCorrect, feedback, created_at: new Date().toISOString() }
  const existingAnswer = (session.answers || []).some((item) => item.question_id === question.id)
  if (existingAnswer) await updateRow('practice_sessions', { id: session.id, student_id: req.user.id, 'answers.question_id': question.id }, { $set: { 'answers.$': answer } })
  else await updateRow('practice_sessions', { id: session.id, student_id: req.user.id }, { $push: { answers: answer } })
  res.json({ correct: isCorrect === null ? null : Boolean(isCorrect), answer: question.answer, explanation: feedback })
})
app.post('/api/practice/sessions/:id/complete', auth, role('student'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid session id.' })
  const session = await findRow('practice_sessions', { id: Number(req.params.id), student_id: req.user.id })
  if (!session) return res.status(404).json({ message: 'Practice session not found.' })
  const answers = session.answers || []
  const correct = answers.filter((answer) => answer.is_correct === true).length
  const score = answers.length ? Math.round(correct * 100 / answers.length) : null
  await updateRow('practice_sessions', { id: session.id }, { $set: { status: 'completed', score, completed_at: new Date().toISOString() } })
  res.json({ score, answered: answers.length, mode: session.mode })
})
app.get('/api/practice/sessions', auth, role('student'), async (req, res) => {
  const sessions = (await findRows('practice_sessions', { student_id: req.user.id }, { sort: { created_at: -1 }, limit: 50 }))
    .map(({ id, mode, topic, status, score, created_at, completed_at }) => ({ id, mode, topic, status, score, createdAt: created_at, completedAt: completed_at }))
  res.json({ sessions })
})

app.get('/api/interview-experiences', async (req, res) => {
  const experiences = (await findRows('interview_experiences', {}, { sort: { created_at: -1 }, limit: 100 }))
    .map(({ id, company, role, interview_type, difficulty, rating, experience, tips, created_at }) => ({ id, company, role, interviewType: interview_type, difficulty, rating, experience, tips, createdAt: created_at }))
  res.json({ experiences })
})
app.post('/api/interview-experiences', auth, role('student'), async (req, res) => {
  const { company, role: jobRole, interviewType, difficulty, rating, experience, tips = '' } = req.body || {}
  if (![company, jobRole, interviewType, difficulty, experience].every((value) => text(value, 5000)) || typeof tips !== 'string' || tips.length > 5000 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Complete the required fields and choose a rating from 1 to 5.' })
  }
  const entry = await insertRow('interview_experiences', { student_id: req.user.id, company: company.trim(), role: jobRole.trim(), interview_type: interviewType.trim(), difficulty: difficulty.trim(), rating, experience: experience.trim(), tips: tips.trim() })
  res.status(201).json({ id: entry.id })
})

app.post('/api/career-guidance', auth, role('student'), async (req, res) => {
  const targetRole = typeof req.body?.targetRole === 'string' ? req.body.targetRole.trim().slice(0, 120) : ''
  const skills = Array.isArray(req.body?.skills) ? req.body.skills.filter((s) => typeof s === 'string').slice(0, 40) : []
  if (!targetRole) return res.status(400).json({ message: 'Enter a target role to get guidance.' })
  const known = new Set(skills.map((skill) => skill.toLowerCase()))
  const suggestions = [
    { skill: 'Communication', reason: 'Practice describing project decisions and outcomes clearly.' },
    { skill: 'Problem solving', reason: 'Work through role-relevant problems and explain your approach.' },
    { skill: 'Portfolio evidence', reason: 'Create a small project that demonstrates the skills in the target role.' },
  ].filter((item) => !known.has(item.skill.toLowerCase()))
  const result = {
    targetRole,
    summary: `For a ${targetRole} role, compare job descriptions with your current evidence and build one project that demonstrates the most repeated requirements.`,
    suggestions,
    sources: [
      { title: 'O*NET OnLine: Occupation profiles', url: 'https://www.onetonline.org/' },
      { title: 'U.S. Department of Labor: CareerOneStop', url: 'https://www.careeronestop.org/' },
    ],
    note: 'Practical guidance only; this is not an AI prediction or a substitute for current job-posting research.',
  }
  await logActivity(req.user.id, 'guidance', `Requested guidance for ${targetRole}`)
  res.json(result)
})

app.get('/api/institution/departments', auth, role('institution'), async (req, res) => {
  const students = await institutionStudents(req.user.id)
  const departments = await Promise.all((await findRows('departments', { institution_id: req.user.id }, { sort: { name: 1 } })).map(async (department) => {
    const members = students.filter((student) => String(student.profile.department || '').toLowerCase() === department.name.toLowerCase())
    const ids = members.map((student) => student.id)
    const applications = ids.length ? await findRows('applications', { withdrawn_at: null, student_id: { $in: ids } }) : []
    return { id: department.id, name: department.name, students: members.length, applications: applications.length, selected: applications.filter((application) => application.status === 'selected').length }
  }))
  res.json({ departments })
})
app.post('/api/institution/departments', auth, role('institution'), async (req, res) => {
  const name = req.body?.name
  if (!text(name, 100)) return res.status(400).json({ message: 'Department name must be 1 to 100 characters.' })
  try {
    const department = await insertRow('departments', { institution_id: req.user.id, name: name.trim(), name_normalized: name.trim().toLowerCase() })
    res.status(201).json({ department: { id: department.id, name: name.trim() } })
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'That department already exists.' })
    throw error
  }
})
app.delete('/api/institution/departments/:id', auth, role('institution'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid department id.' })
  const result = await deleteRow('departments', { id: Number(req.params.id), institution_id: req.user.id })
  if (!result.deletedCount) return res.status(404).json({ message: 'Department not found.' })
  res.status(204).end()
})
app.get('/api/institution/students', auth, role('institution'), async (req, res) => {
  const students = await institutionStudents(req.user.id)
  res.json({ students })
})
async function institutionStudents(institutionId) {
  const institution = await profileFor(institutionId)
  const students = await findRows('users', { role: 'student' }, { sort: { id: -1 } })
  return (await Promise.all(students.map(async (item) => ({ id: item.id, email: item.email, profile: await profileFor(item.id) }))))
    .filter((item) => Number(item.profile.institutionId) === institutionId || (institution.institutionName && item.profile.university?.toLowerCase() === institution.institutionName.toLowerCase()))
}
app.get('/api/institution/analytics', auth, role('institution'), async (req, res) => {
  const students = await institutionStudents(req.user.id)
  const studentIds = new Set(students.map((student) => student.id))
  const applications = await findRows('applications', { withdrawn_at: null, student_id: { $in: [...studentIds] } })
  const departments = await countRows('departments', { institution_id: req.user.id })
  res.json({ students: students.length, applications: applications.length, placed: applications.filter((a) => a.status === 'selected').length, departments })
})
app.get('/api/institution/reports.csv', auth, role('institution'), async (req, res) => {
  const students = (await institutionStudents(req.user.id)).map((student) => ({ email: student.email, ...student.profile }))
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = ['Name,Email,Department,University,Graduation Year', ...students.map((s) => [s.fullName, s.email, s.department, s.university, s.graduationYear].map(escape).join(','))].join('\r\n')
  res.type('text/csv').attachment('institution-students.csv').send(csv)
})
app.get('/api/institution/drives', auth, role('institution'), async (req, res) => {
  const drives = (await findRows('placement_drives', { institution_id: req.user.id }, { sort: { created_at: -1 } }))
    .map(({ id, title, company_name, description, drive_date, status }) => ({ id, title, companyName: company_name, description, driveDate: drive_date, status }))
  res.json({ drives })
})
app.post('/api/institution/drives', auth, role('institution'), async (req, res) => {
  const { title, companyName, description = '', driveDate = '' } = req.body || {}
  if (!text(title, 150) || !text(companyName, 150) || typeof description !== 'string' || description.length > 4000 || typeof driveDate !== 'string') return res.status(400).json({ message: 'Enter a drive title and company name.' })
  const drive = await insertRow('placement_drives', { institution_id: req.user.id, title: title.trim(), company_name: companyName.trim(), description, drive_date: driveDate || null, status: 'planned' })
  res.status(201).json({ id: drive.id })
})
app.patch('/api/institution/drives/:id', auth, role('institution'), async (req, res) => {
  const status = req.body?.status
  if (!numberId(req.params.id) || !['planned', 'active', 'completed'].includes(status)) return res.status(400).json({ message: 'Choose a valid drive status.' })
  const result = await updateRow('placement_drives', { id: Number(req.params.id), institution_id: req.user.id }, { $set: { status } })
  if (!result.matchedCount) return res.status(404).json({ message: 'Placement drive not found.' })
  res.json({ id: Number(req.params.id), status })
})
app.delete('/api/institution/drives/:id', auth, role('institution'), async (req, res) => {
  if (!numberId(req.params.id)) return res.status(400).json({ message: 'Invalid drive id.' })
  const result = await deleteRow('placement_drives', { id: Number(req.params.id), institution_id: req.user.id })
  if (!result.deletedCount) return res.status(404).json({ message: 'Placement drive not found.' })
  res.status(204).end()
})

app.get('/api/dashboard/summary', auth, async (req, res) => {
  if (req.user.role === 'student') {
    const [applications, resumes, practice, activityRows] = await Promise.all([
      countRows('applications', { student_id: req.user.id, withdrawn_at: null }),
      countRows('resumes', { student_id: req.user.id }),
      countRows('practice_sessions', { student_id: req.user.id, status: 'completed' }),
      findRows('activity_events', { user_id: req.user.id }, { sort: { id: -1 }, limit: 5 }),
    ])
    const activity = activityRows.map(({ kind, detail, created_at }) => ({ kind, detail, createdAt: created_at }))
    return res.json({ applications, resumes, practice, activity })
  }
  if (req.user.role === 'company') {
    const jobs = await countRows('opportunities', { company_id: req.user.id })
    const companyJobs = await findRows('opportunities', { company_id: req.user.id }, { projection: { id: 1 } })
    const applicants = await countRows('applications', { opportunity_id: { $in: companyJobs.map((job) => job.id) }, withdrawn_at: null })
    return res.json({ jobs, applicants })
  }
  const [students, departments] = await Promise.all([institutionStudents(req.user.id), countRows('departments', { institution_id: req.user.id })])
  return res.json({ students: students.length, departments })
})

app.use('/api', (_req, res) => res.status(404).json({ message: 'API route not found.' }))
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File is larger than the 5 MB limit.' })
  console.error(error)
  res.status(500).json({ message: 'An unexpected server error occurred.' })
})

const webDirectory = path.join(root, 'dist')
if (process.env.NODE_ENV === 'production' && !fs.existsSync(path.join(webDirectory, 'index.html'))) {
  throw new Error('Production client build not found. Run npm run build before starting the server.')
}
if (fs.existsSync(webDirectory)) {
  app.use(express.static(webDirectory))
  app.get('*path', (_req, res) => res.sendFile(path.join(webDirectory, 'index.html')))
}

const port = Number(process.env.PORT) || 5000
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`SkillOrbit API listening on http://localhost:${port}`))
}

export { app, db }
