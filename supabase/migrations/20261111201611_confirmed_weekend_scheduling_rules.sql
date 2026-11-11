-- User-confirmed business configuration. Public booking remains disabled.
ALTER TABLE scheduling.settings
  ADD COLUMN horizon_months integer CHECK (horizon_months BETWEEN 1 AND 12),
  ADD COLUMN required_contact_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN policy_details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(policy_details) = 'object'),
  ALTER COLUMN horizon_days DROP NOT NULL;
ALTER TABLE scheduling.settings ADD CONSTRAINT exactly_one_booking_horizon
  CHECK ((horizon_days IS NOT NULL) <> (horizon_months IS NOT NULL));
ALTER TABLE scheduling.settings ADD CONSTRAINT valid_contact_fields
  CHECK (required_contact_fields <@ ARRAY['phone','firstName','lastName','email']::text[]
    AND cardinality(required_contact_fields) <= 4
    AND array_position(required_contact_fields, NULL) IS NULL);

CREATE FUNCTION scheduling.guard_confirmed_business_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $guard$
BEGIN
  IF NEW.public_booking_enabled AND (
    (NEW.policy_details->>'minimumNoticeConfirmed') IS DISTINCT FROM 'true'
    OR (NEW.policy_details->>'cancellationTermsConfirmed') IS DISTINCT FROM 'true'
    OR cardinality(NEW.required_contact_fields) = 0
  ) THEN
    RAISE EXCEPTION 'Booking notice, cancellation terms and required contact fields must be confirmed before activation'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION scheduling.guard_confirmed_business_rules() FROM PUBLIC;
CREATE TRIGGER guard_confirmed_business_rules BEFORE INSERT OR UPDATE ON scheduling.settings
  FOR EACH ROW EXECUTE FUNCTION scheduling.guard_confirmed_business_rules();

INSERT INTO public.organizations(id,name,slug,timezone,workflow_settings)
VALUES(gen_random_uuid(),'MK Manikure Lounge','mk-manikure-lounge','America/Chicago',
  '{"schedulingRulesSource":"User confirmation, 2026-11-11","rulesStatus":"partially_confirmed"}')
ON CONFLICT (slug) DO NOTHING;

WITH provider AS (
  INSERT INTO scheduling.resources(organization_id,name,enabled)
  SELECT id,'Mya',false FROM public.organizations o WHERE slug='mk-manikure-lounge'
    AND NOT EXISTS (SELECT 1 FROM scheduling.settings s WHERE s.organization_id=o.id)
  RETURNING id,organization_id
)
INSERT INTO scheduling.settings(organization_id,resource_id,booking_mode,public_booking_enabled,
  horizon_days,horizon_months,buffer_before_minutes,buffer_after_minutes,required_contact_fields,
  cancellation_policy,policy_details)
SELECT organization_id,id,'square_only',false,NULL,3,0,0,
  ARRAY['phone','firstName','lastName','email'],
  'Arrivals more than 10 minutes late may be canceled. No-call/no-show appointments may lead to a booking restriction unless otherwise arranged. Contact Mya if plans change.',
  '{"minimumNoticeConfirmed":false,"cancellationTermsConfirmed":false,"cancellationNoticeMinutes":null,"cancellationFeeMinor":null,"lateArrivalGraceMinutes":10,"lateArrivalAction":"staff_review","noShowAction":"staff_review","source":"stonksmasters/mknails FAQ","sourceCommit":"189424fd17367d12e93180844157aa5793a1eee3","sourceFile":"mk-lounge-deploy.tar.gz:dist/index.html"}'
FROM provider;

-- No working-hours rows on Mon-Fri means closed, not unknown availability.
INSERT INTO scheduling.working_hours(organization_id,resource_id,weekday,start_local,end_local)
SELECT s.organization_id,s.resource_id,days.weekday,'10:00'::time,'17:00'::time
FROM scheduling.settings s JOIN public.organizations o ON o.id=s.organization_id
CROSS JOIN (VALUES(0),(6)) AS days(weekday)
WHERE o.slug='mk-manikure-lounge'
ON CONFLICT (organization_id,resource_id,weekday,start_local) DO NOTHING;
