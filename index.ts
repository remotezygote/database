import pg from 'pg'

const { Pool } = pg.native
const connectionString = process.env.DATABASE_URL

const pool = new Pool({ connectionString })

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

export const query = (text, params = [], callback = undefined as Function | undefined) => {
	return pool.query(text, params, callback)
}