import pg, { QueryResult } from 'pg'

const { native } = pg
const Pool = ((process.env.USE_NATIVE_PG !== 'false' && native) || pg).Pool

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