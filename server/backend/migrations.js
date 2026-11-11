import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execute, resultRows } from './query.js';

const migrationDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const supabaseDirectory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

export async function runMigrations(database, directory) {
  const includeSupabase = directory === undefined;
  directory ??= migrationDirectory;
  await execute(database, `
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const directories = includeSupabase ? [directory, supabaseDirectory] : [directory];
  const files = [];
  for (const folder of directories) {
    let names;
    try { names = await readdir(folder); }
    catch (error) { if (error.code === 'ENOENT' && folder === supabaseDirectory) continue; throw error; }
    for (const file of names.filter(name => /^(?:\d{3}|\d{14})_[a-z0-9_]+\.sql$/.test(name))) files.push({ file, folder });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  const applied = [];

  for (const { file, folder } of files) {
    const version = file.slice(0, -4);
    const migration = await readFile(join(folder, file), 'utf8');
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
