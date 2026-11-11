import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { authenticateClerkRequest } from './auth.js';
import { getDatabase, inUserTransaction } from './database.js';
import { backendMiddleware } from './local-middleware.js';
import { runMigrations } from './migrations.js';
import sessionHandler from '../../api/v1/session.js';
import capabilitiesHandler from '../../api/v1/workspaces/[workspaceId]/capabilities.js';

const migrationDirectory = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
const workspaceOne = '11111111-1111-4111-8111-111111111111';
const workspaceTwo = '22222222-2222-4222-8222-222222222222';

function databaseFor(pg) {
  const statements = [];
  function queryable(client) {
    return {
      async unsafe(statement, parameters = []) {
        statements.push({ statement, parameters });
        if (statement.includes(';') && parameters.length === 0) return client.exec(statement);
        return client.query(statement, parameters);
      },
    };
  }
  return {
    statements,
    ...queryable(pg),
    async begin(callback) {
      await pg.exec('BEGIN');
      try {
        const result = await callback(queryable(pg));
        await pg.exec('COMMIT');
        return result;
      } catch (error) {
        await pg.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

async function responseFor(handler, req, dependencies) {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    end(body) { this.body = body; },
  };
  await handler(req, res, dependencies);
  return { statusCode: res.statusCode, headers, body: JSON.parse(res.body) };
}

async function seededDatabase() {
  const pg = new PGlite();
  const database = databaseFor(pg);
  await runMigrations(database, migrationDirectory);
  await pg.query(`
    INSERT INTO public.organizations (id, name, slug)
    VALUES ($1, 'Mya Workspace', 'mya-workspace'), ($2, 'Partner Workspace', 'partner-workspace')
  `, [workspaceOne, workspaceTwo]);
  await pg.query(`
    INSERT INTO public.app_users (id)
    VALUES ('user_mya'), ('user_partner'), ('user_disabled')
  `);
  await pg.query(`
    INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES ($1, 'user_mya', 'owner'), ($2, 'user_partner', 'admin')
  `, [workspaceOne, workspaceTwo]);
  return { pg, database };
}

function authFor(tokens) {
  return async req => {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const userId = tokens[token];
    if (!userId) {
      const error = new Error('Invalid test token.');
      error.status = 401;
      error.code = 'AUTHENTICATION_REQUIRED';
      throw error;
    }
    return { userId };
  };
}

test('migration runner applies checksummed migrations once and verifies the schema', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  const database = databaseFor(pg);
  const applied = await runMigrations(database, migrationDirectory);
  assert.deepEqual(applied, ['001_identity_workspaces_and_jobs']);
  assert.deepEqual(await runMigrations(database, migrationDirectory), []);

  await pg.query(`
    INSERT INTO public.organizations (id, name, slug)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Mya Workspace', 'mya-workspace')
  `);
  const defaults = await pg.query(`
    SELECT enabled_modules, timezone
    FROM public.organizations
    WHERE id = '11111111-1111-4111-8111-111111111111'
  `);
  assert.deepEqual(defaults.rows[0], { enabled_modules: {}, timezone: 'UTC' });

  const tables = await pg.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  assert.deepEqual(tables.rows.map(row => row.table_name), [
    'app_users',
    'jobs',
    'organization_memberships',
    'organizations',
    'schema_migrations',
  ]);
});

test('migration runner refuses edits to an already-applied migration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mya-migrations-'));
  const pg = new PGlite();
  t.after(async () => {
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  });
  const migration = await readFile(join(migrationDirectory, '001_identity_workspaces_and_jobs.sql'), 'utf8');
  await writeFile(join(directory, '001_identity_workspaces_and_jobs.sql'), migration);
  const database = databaseFor(pg);
  await runMigrations(database, directory);
  await writeFile(join(directory, '001_identity_workspaces_and_jobs.sql'), `${migration}\n-- changed\n`);
  await assert.rejects(runMigrations(database, directory), /has changed; create a new migration/);
});

test('verified user sees only active memberships and cannot read another workspace', async t => {
  const { pg, database } = await seededDatabase();
  t.after(() => pg.close());
  const dependencies = { database, authenticate: authFor({ mya: 'user_mya', partner: 'user_partner' }) };

  const mySession = await responseFor(sessionHandler, {
    method: 'GET',
    url: '/api/v1/session',
    headers: { authorization: 'Bearer mya', 'x-workspace-id': workspaceTwo },
  }, dependencies);
  assert.equal(mySession.statusCode, 200);
  assert.equal(mySession.body.data.user.id, 'user_mya');
  assert.deepEqual(mySession.body.data.workspaces.map(workspace => workspace.id), [workspaceOne]);
  assert.equal(mySession.body.meta.requestId, mySession.headers['X-Request-Id']);
  assert.equal(mySession.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.stringify(mySession.body).includes('token'), false);

  const authorized = await responseFor(capabilitiesHandler, {
    method: 'GET',
    url: `/api/v1/workspaces/${workspaceOne}/capabilities`,
    headers: { authorization: 'Bearer mya' },
    query: { workspaceId: workspaceOne },
  }, dependencies);
  assert.equal(authorized.statusCode, 200);
  assert.equal(authorized.body.data.workspace.role, 'owner');
  assert.deepEqual(authorized.body.data.capabilities, []);

  const isolated = await responseFor(capabilitiesHandler, {
    method: 'GET',
    url: `/api/v1/workspaces/${workspaceTwo}/capabilities`,
    headers: { authorization: 'Bearer mya' },
    query: { workspaceId: workspaceTwo },
  }, dependencies);
  assert.equal(isolated.statusCode, 404);
  assert.equal(isolated.body.error.code, 'WORKSPACE_NOT_FOUND');
});

test('disabled users and revoked memberships are denied', async t => {
  const { pg, database } = await seededDatabase();
  t.after(() => pg.close());
  await pg.query(`UPDATE public.app_users SET disabled_at = now() WHERE id = 'user_disabled'`);
  await pg.query(`
    INSERT INTO public.organization_memberships (organization_id, user_id, role)
    VALUES ($1, 'user_disabled', 'member')
  `, [workspaceOne]);
  await pg.query(`
    UPDATE public.organization_memberships
    SET revoked_at = now()
    WHERE organization_id = $1 AND user_id = 'user_partner'
  `, [workspaceTwo]);
  const dependencies = {
    database,
    authenticate: authFor({ disabled: 'user_disabled', partner: 'user_partner' }),
  };

  const disabled = await responseFor(sessionHandler, {
    method: 'GET', url: '/api/v1/session', headers: { authorization: 'Bearer disabled' },
  }, dependencies);
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.body.error.code, 'USER_DISABLED');

  const revoked = await responseFor(sessionHandler, {
    method: 'GET', url: '/api/v1/session', headers: { authorization: 'Bearer partner' },
  }, dependencies);
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(revoked.body.data.workspaces, []);
});

test('authenticated database work is scoped to an atomic user transaction', async t => {
  const { pg, database } = await seededDatabase();
  t.after(() => pg.close());
  const statementsBefore = database.statements.length;
  await assert.rejects(
    inUserTransaction(database, 'user_rollback', async () => {
      throw new Error('abort transaction');
    }),
    /abort transaction/,
  );
  assert.ok(database.statements.slice(statementsBefore).some(({ statement, parameters }) => (
    statement.includes("set_config('mya.user_id', $1, true)") && parameters[0] === 'user_rollback'
  )));
  const rollback = await pg.query(`SELECT id FROM public.app_users WHERE id = 'user_rollback'`);
  assert.equal(rollback.rows.length, 0);
});

test('Clerk auth fails closed when unconfigured or when a bearer token is absent', async () => {
  await assert.rejects(
    authenticateClerkRequest({ method: 'GET', url: '/', headers: {} }, {}),
    error => error.status === 503 && error.code === 'BACKEND_NOT_CONFIGURED',
  );
  await assert.rejects(
    authenticateClerkRequest({ method: 'GET', url: '/', headers: {} }, {
      CLERK_SECRET_KEY: 'secret',
      CLERK_PUBLISHABLE_KEY: 'publishable',
      CLERK_AUTHORIZED_PARTIES: 'https://myas-tool.vercel.app',
    }),
    error => error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED',
  );
});

test('Clerk verification accepts only signed-in session state and configured parties', async () => {
  const req = {
    method: 'GET',
    url: '/api/v1/session',
    headers: {
      authorization: 'Bearer session-token',
      origin: 'https://myas-tool.vercel.app',
      host: 'myas-tool.vercel.app',
    },
  };
  const env = {
    CLERK_SECRET_KEY: 'secret',
    CLERK_PUBLISHABLE_KEY: 'publishable',
    CLERK_AUTHORIZED_PARTIES: 'https://myas-tool.vercel.app',
  };
  const identity = await authenticateClerkRequest(req, env, options => ({
    authenticateRequest: async (request, authOptions) => {
      assert.equal(options.secretKey, env.CLERK_SECRET_KEY);
      assert.equal(request.headers.get('authorization'), 'Bearer session-token');
      assert.deepEqual(authOptions, {
        acceptsToken: 'session_token',
        authorizedParties: ['https://myas-tool.vercel.app'],
      });
      return { isAuthenticated: true, toAuth: () => ({ userId: 'user_mya' }) };
    },
  }));
  assert.deepEqual(identity, { userId: 'user_mya' });

  await assert.rejects(
    authenticateClerkRequest(req, env, () => ({
      authenticateRequest: async () => ({ isAuthenticated: false }),
    })),
    error => error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED',
  );
});

test('database configuration is validated and TLS verifies the server certificate', async () => {
  assert.throws(
    () => getDatabase({ POSTGRES_URL: 'https://not-postgres.example/db' }),
    error => error.code === 'BACKEND_NOT_CONFIGURED',
  );
  const database = getDatabase({
    POSTGRES_URL: 'postgresql://runtime:password@db.example:6543/postgres',
  });
  assert.equal(database.options.ssl.rejectUnauthorized, true);
  assert.match(database.options.ssl.ca, /BEGIN CERTIFICATE/);
  await database.end();
});

test('local Vite API middleware routes private endpoints and returns structured unknown-route errors', async () => {
  async function invoke(path) {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { headers[name] = value; },
      end(body) { this.body = body; },
    };
    await backendMiddleware({})(
      { method: 'GET', url: path, headers: {} },
      res,
      () => assert.fail('API request must not fall through to the frontend'),
    );
    return { statusCode: res.statusCode, headers, body: JSON.parse(res.body) };
  }

  const session = await invoke('/api/v1/session');
  assert.equal(session.statusCode, 503);
  assert.equal(session.body.error.code, 'BACKEND_NOT_CONFIGURED');

  const missing = await invoke('/api/v1/unknown');
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});
