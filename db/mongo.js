import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI?.trim() || 'mongodb://127.0.0.1:27017'
const databaseName = process.env.MONGODB_DB?.trim() || 'skillorbit_app'

if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI?.trim()) {
  throw new Error('MONGODB_URI is required in production.')
}

const client = new MongoClient(uri)

export async function connectDatabase() {
  await client.connect()
  const database = client.db(databaseName)
  await Promise.all([
    database.collection('users').createIndex({ email_normalized: 1 }, { unique: true }),
    database.collection('account_tokens').createIndex({ token_hash: 1 }, { unique: true }),
    database.collection('account_tokens').createIndex({ user_id: 1, purpose: 1 }, { unique: true }),
    database.collection('profiles').createIndex({ user_id: 1 }, { unique: true }),
    database.collection('profile_images').createIndex({ user_id: 1 }, { unique: true }),
    database.collection('departments').createIndex({ institution_id: 1, name_normalized: 1 }, { unique: true }),
    database.collection('applications').createIndex({ opportunity_id: 1, student_id: 1 }, { unique: true }),
    database.collection('job_alerts').createIndex({ student_id: 1, keyword_normalized: 1, domain_normalized: 1, location_normalized: 1, type_normalized: 1 }, { unique: true }),
    database.collection('saved_jobs').createIndex({ student_id: 1, opportunity_id: 1 }, { unique: true }),
    database.collection('practice_questions').createIndex({ mode: 1, topic: 1 }),
    database.collection('practice_answers').createIndex({ session_id: 1, question_id: 1 }, { unique: true }),
  ])
  return database
}
