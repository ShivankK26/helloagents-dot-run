# SQL dialect cheat sheet

Differences that most often break a query when moving between databases.

| Task | PostgreSQL | MySQL 8 | SQLite | SQL Server |
| --- | --- | --- | --- | --- |
| Limit rows | `LIMIT 10 OFFSET 20` | `LIMIT 20, 10` or `LIMIT 10 OFFSET 20` | `LIMIT 10 OFFSET 20` | `OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY` (needs `ORDER BY`) or `TOP 10` |
| Auto-increment key | `id bigint GENERATED ALWAYS AS IDENTITY` | `id BIGINT AUTO_INCREMENT` | `id INTEGER PRIMARY KEY` | `id BIGINT IDENTITY(1,1)` |
| Upsert | `INSERT ... ON CONFLICT (col) DO UPDATE SET x = EXCLUDED.x` | `INSERT ... ON DUPLICATE KEY UPDATE x = VALUES(x)` (or row alias in 8.0.19+) | `INSERT ... ON CONFLICT (col) DO UPDATE SET x = excluded.x` | `MERGE` |
| Return inserted row | `RETURNING *` | not supported, use `LAST_INSERT_ID()` | `RETURNING *` (3.35+) | `OUTPUT INSERTED.*` |
| String concat | `a \|\| b` or `concat(a, b)` | `CONCAT(a, b)` (`\|\|` is OR by default) | `a \|\| b` | `a + b` or `CONCAT(a, b)` |
| Case-insensitive match | `ILIKE` or `lower(a) = lower(b)` | `LIKE` (depends on collation) | `LIKE` (ASCII only) | depends on collation |
| Current timestamp | `now()` (`timestamptz`) | `NOW()` (session time zone) | `datetime('now')` (UTC text) | `SYSDATETIMEOFFSET()` |
| Truncate to month | `date_trunc('month', ts)` | `DATE_FORMAT(ts, '%Y-%m-01')` | `strftime('%Y-%m-01', ts)` | `DATETRUNC(month, ts)` (2022+) |
| Boolean type | `boolean` | `TINYINT(1)` | integer 0/1 | `BIT` |
| JSON field | `data->>'key'` | `data->>'$.key'` | `json_extract(data, '$.key')` or `data->>'key'` (3.38+) | `JSON_VALUE(data, '$.key')` |
| Quote identifiers | `"name"` | `` `name` `` | `"name"` | `[name]` |
| Aggregate to string | `string_agg(x, ',')` | `GROUP_CONCAT(x SEPARATOR ',')` | `group_concat(x, ',')` | `STRING_AGG(x, ',')` |

## Gotchas

- **PostgreSQL:** unquoted identifiers are folded to lowercase. `CREATE INDEX` locks writes, so use `CONCURRENTLY` on busy tables. `NOT IN` with NULLs returns no rows.
- **MySQL:** `ONLY_FULL_GROUP_BY` may be off in older setups, allowing ambiguous `GROUP BY` queries that silently pick arbitrary values. `utf8` is 3-byte, so use `utf8mb4`. DDL is not transactional.
- **SQLite:** column types are advisory unless the table is `STRICT`. Foreign keys are off unless `PRAGMA foreign_keys = ON`. `ALTER TABLE` is limited, so many changes need a table rebuild.
- **SQL Server:** `ORDER BY` in a view or subquery is ignored without `TOP` or `OFFSET`. Default isolation can block readers; consider `READ_COMMITTED_SNAPSHOT`.
