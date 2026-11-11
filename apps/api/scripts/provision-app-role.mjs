// Creates/updates the least-privilege PostgreSQL role used by the API at runtime (CAR-12, EAC-04, AGENTS rule 8).
// Run AFTER the migrations with the owner connection (DATABASE_URL). The role:
//   - is not owner of any object, not superuser, cannot create databases/roles/schemas;
//   - has SELECT/INSERT/UPDATE/DELETE on the business schemas it needs at runtime;
//   - on the audit schema only SELECT and INSERT (no UPDATE/DELETE/TRUNCATE), on top of the immutability triggers;
//   - cannot read or change the migration history.
// Idempotent: safe to run on every deployment. Never logs the password.
import pg from 'pg';

const ownerUrl = process.env.DATABASE_URL;
const role = process.env.APP_DB_USER ?? 'edutrack_app';
const password = process.env.APP_DB_PASSWORD ?? '';
if (!ownerUrl) throw new Error('DATABASE_URL (owner) is required');
if (!/^[a-z_][a-z0-9_]{0,40}$/.test(role)) throw new Error('Invalid APP_DB_USER');
if (password.length < 24) throw new Error('APP_DB_PASSWORD requires at least 24 characters');

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
const ident = client.escapeIdentifier(role);
try {
  await client.query('BEGIN');
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
  await client.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ident} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD ${client.escapeLiteral(password)}`);
  const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${ident}`);
  await client.query(`REVOKE CREATE ON DATABASE ${client.escapeIdentifier(database)} FROM ${ident}`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  const schemas = (await client.query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public') ORDER BY 1`)).rows.map(row => row.nspname);
  for (const name of schemas) {
    const schema = client.escapeIdentifier(name);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${ident}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${schema} FROM ${ident}`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${ident}`);
    await client.query(`GRANT ${name === 'audit' ? 'SELECT, INSERT' : 'SELECT, INSERT, UPDATE, DELETE'} ON ALL TABLES IN SCHEMA ${schema} TO ${ident}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${ident}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} TO ${ident}`);
  }
  if ((await client.query(`SELECT to_regclass('identity._prisma_migrations') AS t`)).rows[0].t) await client.query(`REVOKE ALL ON identity._prisma_migrations FROM ${ident}`);
  await client.query('COMMIT');
} catch (error) { await client.query('ROLLBACK'); throw error; }

// Self-check of the guarantees (fails the deployment if any is violated).
const checks = (await client.query(`SELECT
    (SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname = $1) AS elevated,
    (SELECT count(*)::int FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1) AS owned,
    has_table_privilege($1, 'audit.entries', 'UPDATE') AS audit_update,
    has_table_privilege($1, 'audit.entries', 'DELETE') AS audit_delete,
    has_table_privilege($1, 'audit.entries', 'TRUNCATE') AS audit_truncate,
    has_table_privilege($1, 'audit.entries', 'INSERT') AS audit_insert`, [role])).rows[0];
await client.end();
if (checks.elevated || checks.owned || checks.audit_update || checks.audit_delete || checks.audit_truncate || !checks.audit_insert) {
  console.error('Least-privilege self-check failed', checks); process.exit(1);
}
console.log(`Role ${role}: least privilege verified (no ownership, audit SELECT/INSERT only).`);
