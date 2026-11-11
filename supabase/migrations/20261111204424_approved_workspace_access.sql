-- Only trusted backend requests may set this transaction-local context, after
-- verifying an active owner membership. Browser roles retain no table grants.
CREATE POLICY owner_membership_select ON public.organization_memberships FOR SELECT
  USING (organization_id=(SELECT nullif(current_setting('mya.organization_id',true),'')::uuid)
    AND (SELECT current_setting('mya.membership_admin',true))='true');
CREATE POLICY owner_membership_insert ON public.organization_memberships FOR INSERT
  WITH CHECK (organization_id=(SELECT nullif(current_setting('mya.organization_id',true),'')::uuid)
    AND (SELECT current_setting('mya.membership_admin',true))='true' AND role IN ('admin','member'));
CREATE POLICY owner_membership_update ON public.organization_memberships FOR UPDATE
  USING (organization_id=(SELECT nullif(current_setting('mya.organization_id',true),'')::uuid)
    AND (SELECT current_setting('mya.membership_admin',true))='true' AND role <> 'owner')
  WITH CHECK (organization_id=(SELECT nullif(current_setting('mya.organization_id',true),'')::uuid)
    AND (SELECT current_setting('mya.membership_admin',true))='true' AND role IN ('admin','member'));
