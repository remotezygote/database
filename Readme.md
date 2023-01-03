# Database

```js
import { query } from '@remotezygote/database'

const getData = async () => {
	const { rows } = await query('<SQL>', [/* params */])
	return rows
}

```