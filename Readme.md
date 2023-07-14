# Database

```js
import { query, withDatabaseClient, listen } from '@remotezygote/database'

const getUserData = async email => {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email])
  return rows && row[0]
}

const multipleQueriesWithClient = async updates => {
  const { email, data } = updates
  return await withDatabaseClient(async client => {
    const { rows } = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    )
    await client.query('INSERT INTO user_log (email, item) VALUES ($1, $2)', [
      email,
      'updated'
    ])
  })
}

const queryWithTransaction = async updates => {
  const { email, data } = updates
  const { commit } = await withTransaction(
    async client => {
      const { rows } = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      )
      await client.query('INSERT INTO user_log (email, item) VALUES ($1, $2)', [
        email,
        'updated'
      ])
    },
    { autoCommit: false }
  )
  return await commit()
}

const queryWithAutoCommit = async updates => {
  const { email, data } = updates
  return await withTransaction(async client => {
    const { rows } = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    )
    await client.query('INSERT INTO user_log (email, item) VALUES ($1, $2)', [
      email,
      'updated'
    ])
  })
}

const queryWithRollback = async updates => {
  const { email, data } = updates
  const { rollback } = await withTransaction(
    async client => {
      const { rows } = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      )
      await client.query('INSERT INTO user_log (email, item) VALUES ($1, $2)', [
        email,
        'updated'
      ])
    },
    { autoCommit: false }
  )
  return await rollback()
}

const queryWithAutoRollback = async updates => {
  const { email, data } = updates
  return await withTransaction(
    async client => {
      const { rows } = await client.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      )
      await client.query('INSERT INTO user_log (email, item) VALUES ($1, $2)', [
        email,
        'updated'
      ])
    },
    { autoRollback: true }
  )
}

const processJob = async job => {
  const queue = queues[job.queue]

  if (queue) {
    await queue.add(job.name, job.data)
  }
}

export const listenForJobs = async () => {
  await listen('jobs', processJob)
}
```

## Configuration

The only configuration needed is the connection information to Postgres, via environment variable.

### Environment variables

`DATABASE_URL` - This library uses only the connection URL method for connection configuration. [More info](https://node-postgres.com/features/connecting#connection-uri)
