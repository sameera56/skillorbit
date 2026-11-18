import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mongodb from 'mongodb'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const { BSON, MongoClient } = mongodb
const { EJSON } = BSON
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

test('backup command creates a readable MongoDB export', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skillorbit-backup-test-'))
  const databaseName = `skillorbit_backup_test_${process.pid}_${Date.now()}`
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017'
  const client = new MongoClient(uri)
  await client.connect()
  t.after(async () => {
    await client.db(databaseName).dropDatabase()
    await client.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  await client.db(databaseName).collection('sample').insertOne({ value: 'persisted' })
  const backupDirectory = path.join(directory, 'backups')

  const result = spawnSync(process.execPath, ['scripts/backup.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: uri, MONGODB_DB: databaseName, SKILLORBIT_BACKUP_DIR: backupDirectory },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)

  const [backupName] = await fs.readdir(backupDirectory)
  assert.match(backupName, /^skillorbit-.*\.ejson$/)
  const backup = EJSON.parse(await fs.readFile(path.join(backupDirectory, backupName), 'utf8'))
  assert.deepEqual(backup.collections.sample.map(({ value }) => value), ['persisted'])
})
