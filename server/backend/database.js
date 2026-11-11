import postgres from 'postgres';
import { ApiError } from './errors.js';
import { createRepositories } from './repositories.js';
import { execute } from './query.js';

const poolKey = Symbol.for('mya.backend.postgres.pools');

export function getDatabase(env = process.env) {
  const connectionString = env.POSTGRES_URL;
  if (!connectionString) {
    throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'Backend storage is not configured.');
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'Backend storage configuration is invalid.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname || !url.username || !url.password || url.pathname === '/') {
    throw new ApiError(503, 'BACKEND_NOT_CONFIGURED', 'Backend storage configuration is invalid.');
  }

  const pools = globalThis[poolKey] || (globalThis[poolKey] = new Map());
  if (!pools.has(connectionString)) {
    pools.set(connectionString, postgres(connectionString, {
      max: 1,
      prepare: false,
      ssl: { rejectUnauthorized: true },
      connect_timeout: 10,
      idle_timeout: 20,
    }));
  }
  return pools.get(connectionString);
}

export async function inUserTransaction(database, userId, callback) {
  return database.begin(async transaction => {
    await execute(transaction, "SELECT set_config('mya.user_id', $1, true)", [userId]);
    const repositories = createRepositories(transaction);
    await repositories.ensureUser(userId);
    const user = await repositories.getUser(userId);
    if (!user || user.disabledAt) {
      throw new ApiError(403, 'USER_DISABLED', 'This account is not authorized to use the workspace.');
    }
    return callback({ repositories, user });
  });
}
