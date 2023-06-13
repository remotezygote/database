import pg, { QueryResult } from 'pg'

const { Pool } = process.env.USE_NATIVE_PG !== 'false' ? pg.native : pg
const connectionString = process.env.DATABASE_URL

export const pool = new Pool({ connectionString })

export const withDatabaseClient = async (func: Function) => {
	try {
		const client = await pool.connect()
		try {
			return await func(client)
		} finally {
			client.release()
		}
	} catch (e) {
		console.error(e)
	}
}

export interface WithTransactionOptions {
	autoCommit?: boolean
	autoRollback?: boolean
}

export const withTransaction = async (func: Function, options: WithTransactionOptions = { autoCommit: true, autoRollback: false }) => {
	const { autoCommit, autoRollback } = options
	try {
		const client = await pool.connect()
		client.query('BEGIN')
		let returnValue
		try {
			returnValue = await func(client)
		} finally {
			if (autoRollback) {
				client.query('ROLLBACK')
			} else if (autoCommit) {
				client.query('COMMIT')
			} else {
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
			client.release()
		}
	} catch (e) {
		console.error(e)
	}
}

export const query = async (text: string, params: any[] = []): Promise<QueryResult> => 
	await pool.query(text, params)

type Callback = (err: Error, result: QueryResult<any>) => void
export const queryWithCallback = async (text: string, params: any[] = [], callback: Callback | undefined = undefined): Promise<void> => 
	await pool.query(text, params, callback)

export const listen = async (queue: string, onMessage: Function, exclusive: boolean = true) => {
	try {
		const client = await pool.connect()
		if (exclusive) {
			client.query(`SELECT pg_advisory_lock(('x'||substr(md5('listen-${queue}'),1,16))::bit(64)::bigint)`)
		}
		client.query(`LISTEN ${queue}`)
		client.on('notification', ({ channel, payload }) => {
			if (channel === queue) {
				onMessage(JSON.parse(payload))
			}
		})
		const stopper = () => {
			client.query(`UNLISTEN ${queue}`)
			if (exclusive) {
				client.query(`SELECT pg_advisory_unlock(('x'||substr(md5('listen-${queue}'),1,16))::bit(64)::bigint)`)
			}
			client.release()
		}
		process.on('SIGTERM', stopper)
		return stopper
	} catch (e) {
		console.error(e)
	}
}