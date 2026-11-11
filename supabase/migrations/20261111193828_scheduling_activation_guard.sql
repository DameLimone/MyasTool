ALTER TABLE scheduling.settings ADD COLUMN square_seller_id text, ADD COLUMN square_location_id text;

-- A non-null report ID is not evidence of reconciliation. Validate the actual
-- report, its approval, scope, coverage and freshness before accepting activation.
CREATE FUNCTION scheduling.guard_booking_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $guard$
DECLARE report scheduling.reconciliation_reports%ROWTYPE;
DECLARE zone text;
BEGIN
  IF NOT NEW.public_booking_enabled THEN RETURN NEW; END IF;
  SELECT * INTO report FROM scheduling.reconciliation_reports
    WHERE organization_id = NEW.organization_id AND id = NEW.migration_approved_report_id;
  SELECT timezone INTO zone FROM public.organizations WHERE id = NEW.organization_id AND disabled_at IS NULL;
  IF zone IS NULL OR NEW.square_seller_id IS NULL OR NEW.square_location_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM scheduling.resources WHERE organization_id = NEW.organization_id AND id = NEW.resource_id AND enabled)
    OR report.approved_at IS NULL OR report.approved_by IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.app_users u ON u.id=m.user_id
      WHERE m.organization_id=NEW.organization_id AND m.user_id=report.approved_by AND m.role='owner'
      AND m.revoked_at IS NULL AND u.disabled_at IS NULL)
    OR report.sync_state <> 'complete' OR report.conflict_count <> 0 OR report.gap_count <> 0
    OR report.seller_id IS DISTINCT FROM NEW.square_seller_id OR report.location_id IS DISTINCT FROM NEW.square_location_id
    OR report.finished_at IS NULL OR report.finished_at < NEW.square_writes_closed_at
    OR report.finished_at < now() - make_interval(secs => NEW.square_sync_max_age_seconds)
    OR report.range_start > (NEW.cutover_from::timestamp AT TIME ZONE zone)
    OR report.range_end < (NEW.cutover_to::timestamp AT TIME ZONE zone)
  THEN
    RAISE EXCEPTION 'Scheduling activation requires an owner-approved, fresh and complete reconciliation report for the cutover scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION scheduling.guard_booking_activation() FROM PUBLIC;
CREATE TRIGGER guard_booking_activation BEFORE INSERT OR UPDATE ON scheduling.settings
  FOR EACH ROW EXECUTE FUNCTION scheduling.guard_booking_activation();
