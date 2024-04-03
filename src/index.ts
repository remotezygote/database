import { Pool, QueryResult } from 'pg'

const connectionString = process.env.DATABASE_URL

export const pool = new Pool({ connectionString })

pool.on('error', (err, client) => {
	console.error(err)
	process.exit(-1)
})

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
	const lockName = `('x'||substr(md5('listen-${queue}'),1,16))::bit(64)::bigint`
	const client = await pool.connect()
	if (exclusive) {
		await client.query(`SELECT pg_advisory_lock(${lockName})`)
	}
	console.log(`Listening to ${queue}...`)
	await client.query(`LISTEN ${queue}`)
	client.on('notification', ({ channel, payload }) => {
		if (channel === queue) {
			onMessage(JSON.parse(payload))
		}
	})
	const stopper = async () => {
		await client.query(`UNLISTEN ${queue}`)
		if (exclusive) {
			await client.query(`SELECT pg_advisory_unlock(${lockName})`)
		}
		client.release()
	}
	process.on('SIGTERM', stopper)
	client.on('error', e => {
		console.error('Database client error')
		console.error(e)
		try {
			stopper()
		} catch (err) {
			console.error(err)
		} finally {
			console.log('Exiting process...')
			process.exit(-1)
		}
	})
	return stopper
}