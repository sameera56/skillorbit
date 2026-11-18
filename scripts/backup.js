import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mongodb from 'mongodb'

const { BSON, MongoClient } = mongodb
const { EJSON } = BSON

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const backupDirectory = path.resolve(process.env.SKILLORBIT_BACKUP_DIR || path.join(process.env.SKILLORBIT_DATA_DIR || path.join(root, 'data'), 'backups'))
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017')

try {
  await client.connect()
  const database = client.db(process.env.MONGODB_DB || 'skillorbit_app')
  const names = (await database.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name)
  const collections = {}
  for (const name of names) collections[name] = await database.collection(name).find({}).toArray()
  const backup = { database: database.databaseName, createdAt: new Date().toISOString(), collections }
  await fs.mkdir(backupDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDirectory, `skillorbit-${timestamp}.ejson`)
  await fs.writeFile(backupPath, EJSON.stringify(backup, null, 2), { flag: 'wx' })
  console.log(`MongoDB backup created: ${backupPath}`)
} finally {
  await client.close()
}
