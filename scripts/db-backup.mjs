// PostgreSQL backup and restore for the local Compose deployment (EAC-02 operation).
//   node scripts/db-backup.mjs backup            -> backups/edutrack-<UTC>.dump (+ .sha256), custom pg_dump format
//   node scripts/db-backup.mjs verify <file>     -> restores into a scratch database, compares row counts with the live
//                                                   database, verifies the audit hash chain and drops the scratch database
//   node scripts/db-backup.mjs restore <file> --yes -> replaces the live database contents (stop the API first)
// Uses `docker compose exec` against the "db" service; never touches Docker volumes.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = 'edutrack_restore_check';
function compose(args, input) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, input, maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`docker compose ${args.slice(0, 4).join(' ')} failed: ${result.stderr?.toString().trim()}`);
  return result.stdout;
}
const psql = (database, sql) => compose(['exec', '-T', 'db', 'sh', '-c', `psql -v ON_ERROR_STOP=1 -X -A -t -U "$POSTGRES_USER" -d ${database} -c "${sql.replace(/"/g, '\\"')}"`]).toString().trim();
const liveDb = () => compose(['exec', '-T', 'db', 'sh', '-c', 'printf %s "$POSTGRES_DB"']).toString();
const tables = ['identity.users', 'courses.courses', 'enrollments.enrollments', 'assessments.assessments', 'grading.grades', 'audit.entries', 'exams.attempts', 'exams.answers', 'submissions.files'];
function counts(database) {
  return Object.fromEntries(tables.map(table => [table, Number(psql(database, `SELECT count(*) FROM ${table}`))]));
}
const [command, file, flag] = process.argv.slice(2);
if (command === 'backup') {
  mkdirSync(path.join(root, 'backups'), { recursive: true });
  const dump = compose(['exec', '-T', 'db', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc']);
  const name = path.join(root, 'backups', `edutrack-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  writeFileSync(name, dump, { mode: 0o600 });
  const sha = createHash('sha256').update(dump).digest('hex'); writeFileSync(`${name}.sha256`, `${sha}  ${path.basename(name)}\n`);
  console.log(JSON.stringify({ backup: path.relative(root, name), bytes: dump.length, sha256: sha, counts: counts(liveDb()) }));
} else if (command === 'verify' || command === 'restore') {
  if (!file) throw new Error('Backup file required');
  const bytes = readFileSync(path.resolve(file));
  const expected = readFileSync(`${path.resolve(file)}.sha256`, 'utf8').split(/\s+/)[0];
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Checksum mismatch: the backup file is corrupted');
  if (command === 'restore' && flag !== '--yes') throw new Error('restore replaces the live database: stop the API and pass --yes');
  const target = command === 'verify' ? scratch : liveDb();
  if (command === 'verify') { psql('postgres', `DROP DATABASE IF EXISTS ${scratch}`); psql('postgres', `CREATE DATABASE ${scratch}`); }
  compose(['exec', '-T', 'db', 'sh', '-c', `pg_restore -U "$POSTGRES_USER" -d ${target} --exit-on-error ${command === 'restore' ? '--clean --if-exists' : ''}`], bytes);
  const restored = counts(target);
  const chain = psql(target, 'SELECT checked || \',\' || coalesce(first_invalid::text, \'\') FROM audit.verify_chain()').split(',');
  const report = { restoredInto: target, counts: restored, auditChain: { checked: Number(chain[0]), valid: chain[1] === '' } };
  if (command === 'verify') {
    psql('postgres', `DROP DATABASE ${scratch}`);
    report.matchesLiveCounts = JSON.stringify(restored) === JSON.stringify(counts(liveDb()));
  }
  console.log(JSON.stringify(report));
  if (!report.auditChain.valid) process.exit(1);
} else {
  console.error('Usage: node scripts/db-backup.mjs backup | verify <file> | restore <file> --yes'); process.exit(2);
}
