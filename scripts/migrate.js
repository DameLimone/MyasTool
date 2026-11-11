import postgres from 'postgres';
import { runMigrations } from '../server/backend/migrations.js';

const connectionString = process.env.SUPABASE_MIGRATION_URL;
let connectionUrl;
try {
  connectionUrl = connectionString && new URL(connectionString);
} catch {
  connectionUrl = null;
}
if (!connectionUrl || !['postgres:', 'postgresql:'].includes(connectionUrl.protocol)
  || !connectionUrl.hostname || !connectionUrl.username || !connectionUrl.password
  || connectionUrl.pathname === '/') {
  console.error('Set SUPABASE_MIGRATION_URL to the privileged Supabase connection used for migrations.');
  process.exitCode = 1;
} else {
  const database = postgres(connectionString, {
    max: 1,
    prepare: false,
    ssl: { rejectUnauthorized: true },
    connect_timeout: 10,
  });
  try {
    const applied = await runMigrations(database);
    console.log(applied.length
      ? `Applied migrations: ${applied.join(', ')}`
      : 'Database schema is already up to date.');
  } catch (error) {
    console.error('Database migration failed.', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error?.code || 'UNKNOWN',
    });
    process.exitCode = 1;
  } finally {
    await database.end({ timeout: 5 });
  }
}
