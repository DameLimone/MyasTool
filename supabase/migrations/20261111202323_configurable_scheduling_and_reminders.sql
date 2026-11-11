ALTER TABLE scheduling.settings
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN appointment_reminders_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN reminder_minutes_before integer[] NOT NULL DEFAULT '{60}'
    CHECK (cardinality(reminder_minutes_before) BETWEEN 1 AND 5
      AND 0 < ALL(reminder_minutes_before) AND 10080 >= ALL(reminder_minutes_before)
      AND array_position(reminder_minutes_before,NULL) IS NULL);

CREATE POLICY organizations_manager_update ON public.organizations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.organization_memberships m JOIN public.app_users u ON u.id=m.user_id
    WHERE m.organization_id=organizations.id AND m.user_id=(SELECT nullif(current_setting('mya.user_id',true),''))
      AND m.role IN ('owner','admin') AND m.revoked_at IS NULL AND u.disabled_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.organization_memberships m JOIN public.app_users u ON u.id=m.user_id
    WHERE m.organization_id=organizations.id AND m.user_id=(SELECT nullif(current_setting('mya.user_id',true),''))
      AND m.role IN ('owner','admin') AND m.revoked_at IS NULL AND u.disabled_at IS NULL
  ));

UPDATE scheduling.settings s SET
  notice_minutes=1440,
  policy_details=jsonb_set(policy_details,'{minimumNoticeConfirmed}','true'),
  appointment_reminders_enabled=true,
  reminder_minutes_before=ARRAY[60],
  revision=revision+1,
  updated_at=now()
FROM public.organizations o
WHERE o.id=s.organization_id AND o.slug='mk-manikure-lounge';

INSERT INTO scheduling.audit_events(organization_id,event_type,metadata)
SELECT id,'scheduling.booking_notice_and_reminder_confirmed',
  '{"minimumNoticeMinutes":1440,"appointmentReminderMinutesBefore":[60],"deliveryStatus":"not_implemented"}'::jsonb
FROM public.organizations WHERE slug='mk-manikure-lounge';
