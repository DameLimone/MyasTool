-- Cache transaction identity lookups once per statement, not once per row.
ALTER POLICY app_users_self_select ON public.app_users
  USING (id = (SELECT nullif(current_setting('mya.user_id', true), '')));
ALTER POLICY app_users_self_insert ON public.app_users
  WITH CHECK (id = (SELECT nullif(current_setting('mya.user_id', true), '')));
ALTER POLICY memberships_self_select ON public.organization_memberships
  USING (user_id = (SELECT nullif(current_setting('mya.user_id', true), '')) AND revoked_at IS NULL);
ALTER POLICY organizations_member_select ON public.organizations
  USING (disabled_at IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.app_users u ON u.id = m.user_id
    WHERE m.organization_id = organizations.id
      AND m.user_id = (SELECT nullif(current_setting('mya.user_id', true), ''))
      AND m.revoked_at IS NULL AND u.disabled_at IS NULL
  ));
DO $security$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'scheduling' LOOP
    EXECUTE format($policy$ALTER POLICY backend_organization_context ON scheduling.%I
      USING (organization_id = (SELECT nullif(current_setting('mya.organization_id', true), '')::uuid))
      WITH CHECK (organization_id = (SELECT nullif(current_setting('mya.organization_id', true), '')::uuid))$policy$, item.tablename);
  END LOOP;
END $security$;
