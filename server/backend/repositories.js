import { execute, resultRows } from './query.js';

export function createRepositories(queryable) {
  return {
    async ensureUser(userId) {
      await execute(queryable, `
        INSERT INTO public.app_users (id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING
      `, [userId]);
    },

    async getUser(userId) {
      const result = await execute(queryable, `
        SELECT id, disabled_at AS "disabledAt"
        FROM public.app_users
        WHERE id = $1
      `, [userId]);
      return resultRows(result)[0] || null;
    },

    async listMemberships(userId) {
      const result = await execute(queryable, `
        SELECT
          o.id,
          o.name,
          o.slug,
          o.timezone,
          m.role
        FROM public.organization_memberships AS m
        JOIN public.organizations AS o ON o.id = m.organization_id
        JOIN public.app_users AS u ON u.id = m.user_id
        WHERE m.user_id = $1
          AND m.revoked_at IS NULL
          AND o.disabled_at IS NULL
          AND u.disabled_at IS NULL
        ORDER BY o.name, o.id
      `, [userId]);
      return resultRows(result);
    },

    async getWorkspaceMembership(userId, workspaceId) {
      const result = await execute(queryable, `
        SELECT o.id, o.name, o.slug, o.timezone, m.role
        FROM public.organization_memberships AS m
        JOIN public.organizations AS o ON o.id = m.organization_id
        JOIN public.app_users AS u ON u.id = m.user_id
        WHERE m.user_id = $1
          AND m.organization_id = $2
          AND m.revoked_at IS NULL
          AND o.disabled_at IS NULL
          AND u.disabled_at IS NULL
        LIMIT 1
      `, [userId, workspaceId]);
      return resultRows(result)[0] || null;
    },
  };
}
