---
name: sql-helper
description: Writes, explains, reviews, and optimizes SQL queries and schema changes for PostgreSQL, MySQL, SQLite, SQL Server and other dialects, with attention to correctness, NULL handling, indexes, and safe migrations. Use when writing a query, debugging wrong results or slow queries, reading an EXPLAIN plan, or designing tables and migrations.
category: data
tags: [sql, database, postgres, mysql, performance]
author: ShivankK26
---

# SQL helper

Help with SQL the way an experienced database engineer would: get the results right first, then make the query fast, and never put data at risk.

## First, establish context

- **Dialect and version.** Check the project for clues: ORM config, migration files, `docker-compose.yml`, connection strings, driver packages. If you can't tell, ask. Dialect differences are covered in [references/dialects.md](references/dialects.md).
- **Schema.** Read the migration files, schema dumps, or ORM models for the tables involved: columns, types, nullability, constraints, and indexes. Don't guess column names.
- **Intent.** Restate what the query must return in one plain sentence, including how duplicates, missing rows, and ties should be handled.

## Writing queries

- Name the columns you need. Use `SELECT *` only in quick exploration.
- Use explicit `JOIN ... ON`, never comma joins. Pick `LEFT JOIN` deliberately, and remember that a `WHERE` condition on the right-hand table turns it back into an inner join. Put that condition in the `ON` clause instead.
- Handle NULL on purpose: `NULL = NULL` is not true, `NOT IN (subquery)` returns nothing if the subquery yields a NULL (use `NOT EXISTS`), and `COUNT(col)` skips NULLs while `COUNT(*)` doesn't.
- Watch for join fan-out: joining two one-to-many relations multiplies rows and inflates `SUM` and `COUNT`. Aggregate in a subquery or CTE first.
- Use CTEs (`WITH`) to make multi-step logic readable, and window functions (`ROW_NUMBER`, `LAG`, `SUM() OVER`) for rankings, running totals, and "latest row per group".
- Make ordering deterministic: add a unique tiebreaker to `ORDER BY` when paginating. Prefer keyset pagination (`WHERE id > :last_id`) over large `OFFSET`s.
- Always use parameterized queries in application code. Never build SQL by concatenating user input.
- Be explicit about time zones and use half-open date ranges: `created_at >= '2026-01-01' AND created_at < '2026-02-01'`.

## Optimizing

1. Get the plan: `EXPLAIN ANALYZE` (PostgreSQL), `EXPLAIN ANALYZE` or `EXPLAIN FORMAT=TREE` (MySQL 8), `EXPLAIN QUERY PLAN` (SQLite). Note that `EXPLAIN ANALYZE` actually runs the query, so wrap data-modifying statements in a transaction you roll back.
2. Look for sequential scans on large tables, big gaps between estimated and actual row counts (stale statistics, so run `ANALYZE`), nested loops over many rows, and sorts or hashes spilling to disk.
3. Fix in this order: rewrite the query (make predicates sargable by not wrapping indexed columns in functions, avoid leading `%` in `LIKE`, replace correlated subqueries), then add or adjust indexes, then consider schema changes.
4. For indexes, put equality columns first, then range columns, and consider covering or partial indexes. Every index slows writes, so justify each one.

## Schema changes and migrations

- Choose precise types: `timestamptz` over `timestamp` in PostgreSQL, `numeric`/`decimal` for money, and never floats for currency.
- Add `NOT NULL`, foreign keys, and `CHECK` or unique constraints so the database enforces invariants.
- Make migrations safe on large tables: add columns as nullable or with a constant default, backfill in batches, then add the constraint. In PostgreSQL use `CREATE INDEX CONCURRENTLY`. Provide a down migration or rollback plan.

## Safety

Never run `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, or `ALTER` against a real database without explicit confirmation from the user. Before a destructive statement, show a `SELECT` that previews the affected rows and the row count. Prefer running changes inside a transaction.

## Output

Give the SQL in a code block tagged with the dialect, then a short explanation of how it works and any assumptions you made about the schema or data. When optimizing, show before and after, say which index or rewrite made the difference, and include the evidence from the query plan.
