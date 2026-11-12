# Database snapshot

`commons.sql` is a `pg_dump` of the local dev database: players, coins (economy ledger),
homes, inventory, fish and the rest. Books and login tokens are left out; the API
restocks the library on startup and players just log in again.

Restore into an empty database:

    psql -h localhost -U commons -d commons -f infra/db-snapshot/commons.sql
