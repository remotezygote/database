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

export const releaseClient = (client: pg.PoolClient, clientReleased: boolean = false) => {
	if (!clientReleased) {
		client.release()
		clientReleased = true
	}
	return clientReleased
}

export interface WithTransactionOptions {
	autoCommit?: boolean
	autoRollback?: boolean
	timeout?: number
}

export const begin = async (client: pg.PoolClient, inTransaction: boolean | string = false) => {
	client.query(inTransaction ? `SAVEPOINT ${inTransaction}` : 'BEGIN')
}

export const commit = async (client: pg.PoolClient, inTransaction: boolean | string = false) => {
	client.query(inTransaction ? `RELEASE SAVEPOINT ${inTransaction}` : 'COMMIT')
}

export const rollback = async (client: pg.PoolClient, inTransaction: boolean | string = false) => {
	client.query(inTransaction ? `ROLLBACK TO SAVEPOINT ${inTransaction}` : 'ROLLBACK')
}

export const inTransaction = async (client: pg.PoolClient) => {
	await client.query('CREATE TEMPORARY TABLE IF NOT EXISTS a (b int) ON COMMIT DROP')

	const { rows } = await client.query(
		`SELECT 
			pg_current_xact_id_if_assigned() IS NOT NULL AS inTransaction,
			'trx_' || replace(gen_random_uuid()::text, '-', '_') AS transactionId`
	)
	const { intransaction: inTransaction, transactionid: transactionId } = rows[0]
	
	return inTransaction ? transactionId : false
}

export const withTransaction = async (func: Function, options: WithTransactionOptions = { autoCommit: true, autoRollback: false, timeout: 2000 }) => {
	const { autoCommit, autoRollback, timeout } = options
	const client = await pool.connect()

	const transactionId = await inTransaction(client)

	await begin(client, transactionId)
	let returnValue, clientReleased = false
	try {
		returnValue = await func(client)
	} catch (e) {
		try {
			await rollback(client, transactionId)
		} catch (e) {
			console.error(e)
		} finally {
			clientReleased = releaseClient(client, clientReleased)
		}
		throw e
	} finally {
		if (autoRollback) {
			try {
				await rollback(client, transactionId)
			} finally {
				clientReleased = releaseClient(client, clientReleased)
			}
			return { returnValue }
		} else if (autoCommit) {
			try {
				await commit(client, transactionId)
			} finally {
				clientReleased = releaseClient(client, clientReleased)
			}
			return { returnValue }
		} else {
			const timeOut = setTimeout(() => {
				clientReleased = releaseClient(client, clientReleased)
				throw new Error('Transaction timed out')
			}, timeout)
			return {
				returnValue,
				commit: async () => {
					try {
						await commit(client, transactionId)
						clearTimeout(timeOut)
						return returnValue
					} catch (e) {
						await rollback(client, transactionId)
						throw e
					} finally {
						clearTimeout(timeOut)
						clientReleased = releaseClient(client, clientReleased)
					}
				},
				rollback: async () => {
					try {
						await rollback(client, transactionId)
						clearTimeout(timeOut)
						return returnValue
					} catch (e) {
						throw e
					} finally {
						clearTimeout(timeOut)
						clientReleased = releaseClient(client, clientReleased)
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