# Albatross

The constant migrator.


All SQL!


Have a migrations table. when new migrations are found, simply insert them into the database, with the contents of the migration up/down in text fields. Have a trigger run when new rows are inserted to migrate appropriately. Allow foa lock of migration version via some other table/field, with an update trigger to migrate as needed.

Keep a log of all actions, period, even when rolling up/down, and log the output and any errors.

Push to pubsub queues for output, status, etc. for interface(s). Expose via web sockets for API.