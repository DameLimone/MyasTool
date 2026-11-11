-- Owner email updated at the account holder's explicit request.
-- A privileged bootstrap narrowly assigns the explicitly requested initial
-- owner after the backend verifies control of this email with Clerk. It is not
-- exposed to PostgREST or executable by browser roles.
CREATE OR REPLACE FUNCTION scheduling.bootstrap_verified_owner(candidate_user_id text,verified_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bootstrap$
DECLARE workspace uuid;
BEGIN
  IF candidate_user_id IS DISTINCT FROM nullif(current_setting('mya.user_id',true),'')
    OR lower(btrim(verified_email)) IS DISTINCT FROM 'dambienb@gmail.com'
    OR NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=candidate_user_id AND disabled_at IS NULL)
  THEN RAISE EXCEPTION 'Verified owner identity required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mya_initial_owner_bootstrap'));
  SELECT id INTO workspace FROM public.organizations WHERE slug='mk-manikure-lounge' AND disabled_at IS NULL;
  IF workspace IS NULL THEN RETURN; END IF;
  -- Never re-bootstrap, transfer ownership or restore a revoked owner.
  IF EXISTS(SELECT 1 FROM public.organization_memberships WHERE organization_id=workspace AND role='owner') THEN RETURN; END IF;
  INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES(workspace,candidate_user_id,'owner')
    ON CONFLICT(organization_id,user_id) DO UPDATE SET role='owner',revoked_at=NULL;
  INSERT INTO scheduling.audit_events(organization_id,actor_user_id,event_type,metadata)
    VALUES(workspace,candidate_user_id,'workspace.initial_owner_verified','{"provider":"clerk"}');
END $bootstrap$;
REVOKE ALL ON FUNCTION scheduling.bootstrap_verified_owner(text,text) FROM PUBLIC;
