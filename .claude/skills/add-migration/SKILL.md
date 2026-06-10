---
name: add-migration
description: Use when adding a new database migration to the Anchor Client Dashboard. Covers the full procedure: write SQL, register the migration function in server/index.js, append to the migration chain, and verify locally.
---

# Add a Database Migration

## 1. Write the SQL

Create `server/sql/migrate_<feature_name>.sql`. All migrations **must be idempotent**:
- Use `IF NOT EXISTS` for new tables and columns
- Use `IF EXISTS` for drops and renames
- Use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$` for constraints/indexes that lack `IF NOT EXISTS`
- Never use plain `CREATE TABLE` or `ALTER TABLE ADD COLUMN` without guards

## 2. Add the migration function in `server/index.js`

Open `server/index.js` and add a new async function near the other `maybeRunX` functions:

```js
async function maybeRunMyFeatureMigration() {
  try {
    const sql = await fs.readFile(new URL('./sql/migrate_my_feature.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    console.error('maybeRunMyFeatureMigration: done');
  } catch (err) {
    console.error('maybeRunMyFeatureMigration error:', err.message);
  }
}
```

Use `console.error` (not `console.log`) — `console.log` is nulled in production.

## 3. Append to the migration chain

Find the `.then()` migration chain in `server/index.js` (inside the `app.listen` callback). It looks like:

```js
maybeRunFirstMigration()
  .then(() => maybeRunSecondMigration())
  // ...many more...
  .then(() => maybeRunLastMigration())
  .catch(err => console.error('Migration chain error:', err));
```

Append your new function **at the end**:

```js
  .then(() => maybeRunLastMigration())
  .then(() => maybeRunMyFeatureMigration())  // ← add here
  .catch(err => console.error('Migration chain error:', err));
```

## 4. Verify locally

```bash
yarn server
# Watch the startup logs for your migration function name
# Check that the new tables/columns exist in psql:
psql postgresql://bif@localhost:5432/anchor -c "\d my_new_table"
```

## 5. Update SKILLS.md

Add the new table(s) to the Database Schema Map section of `SKILLS.md`.

## Key reminders

- Server binds the port **before** migrations run — a migration failure won't crash the server, it just logs the error. Always check logs after deploy.
- The migration chain is sequential and cumulative — every migration runs on every server start. Idempotence is non-negotiable.
- `hub.js` is ~7400 lines — if you need to check existing table structure, use `psql` or read `SKILLS.md` rather than grepping hub.js.
