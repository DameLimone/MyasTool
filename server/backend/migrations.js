import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execute, resultRows } from './query.js';

const migrationDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

export async function runMigrations(database, directory = migrationDirectory) {
  await execute(database, `
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(directory))
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  const applied = [];

  for (const file of files) {
    const version = file.slice(0, -4);
    const migration = await readFile(join(directory, file), 'utf8');
    const checksum = createHash('sha256').update(migration).digest('hex');
    const outcome = await database.begin(async transaction => {
      await execute(transaction, "SELECT pg_advisory_xact_lock(hashtext('mya_schema_migrations'))");
      const current = resultRows(await execute(transaction, `
        SELECT checksum
        FROM public.schema_migrations
        WHERE version = $1
      `, [version]))[0];
      if (current) {
        if (current.checksum !== checksum) {
          throw new Error(`Applied migration ${version} has changed; create a new migration instead.`);
        }
        return false;
      }

      await execute(transaction, migration);
      await execute(transaction, `
        INSERT INTO public.schema_migrations (version, checksum)
        VALUES ($1, $2)
      `, [version, checksum]);
      return true;
    });
    if (outcome) applied.push(version);
  }
  return applied;
}
