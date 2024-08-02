import pg from 'pg'
import type { QueryResult } from 'pg'

const { Pool } = pg

const connectionString = process.env.DATABASE_URL

export const pool = new Pool({ connectionString })

pool.on('error', (err, client) => {
	console.error(err)
	process.exit(-1)
})

export const withDatabaseClient = async (func: Function) => {
	const client = await pool.connect()
	try {
		return await func(client)
	} finally {
		client.release()
	}
}

export interface WithTransactionOptions {
	autoCommit?: boolean
	autoRollback?: boolean
}

export const withTransaction = async (func: Function, options: WithTransactionOptions = { autoCommit: true, autoRollback: false }) => {
	const { autoCommit, autoRollback } = options
	const client = await pool.connect()
	await client.query('CREATE TEMPORARY TABLE a (b int) ON COMMIT DROP')
	let inTransaction = false
	const { rows } = await client.query('SELECT pg_current_xact_id_if_assigned() IS NOT NULL AS is_transaction')
	if (!rows[0].is_transaction) {
		inTransaction = true
	}
	client.query(inTransaction ? 'SAVEPOINT' : 'BEGIN')
	let returnValue
	try {
		returnValue = await func(client)
	} finally {
		if (autoRollback) {
			client.query('ROLLBACK')
			client.release()
			return { returnValue }
		} else if (autoCommit) {
			client.query('COMMIT')
			client.release()
			return { returnValue }
		} else {
			client.release()
			return {
				returnValue,
				commit: async () => {
					try {
						client.query('COMMIT')
						return returnValue
					} catch (e) {
						client.query('ROLLBACK')
						throw e
					} finally {
						client.release()
					}
				},
				rollback: async () => {
					try {
						client.query('ROLLBACK')
						return returnValue
					} catch (e) {
						throw e
					} finally {
						client.release()
					}
				}
			}
		}
	}
}

export const query = async (text: string, params: any[] = []): Promise<QueryResult> =>
	await pool.query(text, params)

type Callback = (err: Error, result: QueryResult<any>) => void
export const queryWithCallback = async (text: string, params: any[] = [], callback: Callback | undefined = undefined): Promise<void> =>
	await pool.query(text, params, callback)

const listenerStoppers = []

const termStopper = () => {
	listenerStoppers.forEach(async stopper => {
		try {
			await stopper()
		} catch (err) {
			console.error(err)
		}
	})
}

process.on('SIGTERM', termStopper)

interface ListenOptions {
	exclusive?: boolean
	parseJSON?: boolean
}

export const listen = async (queue: string, onMessage: Function, { exclusive = true, parseJSON = true }: ListenOptions = { exclusive: true, parseJSON: true }) => {
	const lockName = `('x'||substr(md5('listen-${queue}'),1,16))::bit(64)::bigint`
	const client = await pool.connect()
	if (exclusive) {
		await client.query(`SELECT pg_advisory_lock(${lockName})`)
	}
	console.log(`Listening to ${queue}...`)
	await client.query(`LISTEN "${queue}"`)
	client.on('notification', ({ channel, payload }) => {
		if (channel === queue) {
			onMessage(parseJSON ? JSON.parse(payload) : payload)
		}
	})
	const stopper = async () => {
		client.release(true)
		if (exclusive) {
			await query(`SELECT pg_advisory_unlock(${lockName})`)
		}
		listenerStoppers.splice(listenerStoppers.indexOf(stopper), 1)
	}

	listenerStoppers.push(stopper)

	client.on('error', e => {
		console.error('Database client error')
		console.error(e)
		try {
			stopper()
		} catch (err) {
			console.error(err)
		} finally {
			throw new Error('Database client error')
		}
	})
	return stopper
}