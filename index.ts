import pg, { QueryResult } from 'pg'

const { Pool } = pg.native
const connectionString = process.env.DATABASE_URL

export const pool = new Pool({ connectionString })

export const withDatabaseClient = async (func) => {
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


export const query = (text: string, params: any[] = [], callback: Function | undefined = undefined): Promise<QueryResult> => 
	pool.query(text, params, callback)

export const listen = async (queue, onMessage, exclusive = true) => {
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
		return () => {
			client.query(`UNLISTEN ${queue}`)
			if (exclusive) {
				client.query(`SELECT pg_advisory_unlock(('x'||substr(md5('listen-${queue}'),1,16))::bit(64)::bigint)`)
			}
			client.release()
		}
	} catch (e) {
		console.error(e)
	}
}