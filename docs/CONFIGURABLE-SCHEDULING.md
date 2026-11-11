# Configurable scheduling and reminders

## Confirmed defaults

- Central time: `America/Chicago`.
- Saturday and Sunday: 10:00–17:00; other days closed.
- No appointment buffers.
- Minimum notice for a new booking: **1,440 minutes (24 hours)**.
- Booking horizon: three calendar months.
- Required contact fields: phone, first name, last name, email.
- Appointment reminder preference: enabled, **60 minutes before**.

Reminder timing is saved configuration. No delivery worker, channel registration,
or customer messaging is implemented. The initial recipient model is the workspace
owner; the API explicitly returns `deliveryStatus: "not_implemented"`. Do not
display a promise that a reminder will arrive or claim email/SMS/push is enabled.
Selecting actual notification channels/recipients remains future work.

The 24-hour notice applies to creating a booking. It does not establish an
advance cancellation deadline, cancellation fee, or automatic no-show action.
Those cancellation values remain unknown until explicitly confirmed.

## API for John's settings screen

`GET /api/v1/workspaces/{workspaceId}/scheduling-settings`

`PATCH /api/v1/workspaces/{workspaceId}/scheduling-settings`

These source handlers use Clerk bearer sessions, active database membership and
the configured runtime Postgres connection. They are mounted in Vite development
and have a Vercel Function entrypoint. This change applies Supabase schema/defaults
but does not deploy the handlers, configure Vercel credentials or assign users.
There is no settings screen in the public website or this change.

Any active member can read configuration. Only owners/admins can edit it. There
is no permission to self-enroll or select a different workspace by changing the
request ID. Private responses use `Cache-Control: no-store` and request IDs.

The editable properties are:

| Property | Behavior |
| --- | --- |
| `timezone` | Valid IANA timezone; Central is `America/Chicago` |
| `weeklyHours` | Up to 28 nonoverlapping same-day periods; weekday 0 is Sunday, 6 is Saturday; omitted days are closed |
| `minimumNoticeMinutes` | 0–43,200; zero must be an explicit choice |
| `bookingHorizon` | `{unit:"months",value:1..12}` or `{unit:"days",value:1..365}` |
| `buffers` | Optional `beforeMinutes` and `afterMinutes`, each 0–180 |
| `slotIntervalMinutes` | 5–60 |
| `holdMinutes` | 1–15 |
| `requiredContactFields` | Unique nonempty subset of `phone`, `firstName`, `lastName`, `email` |
| `cancellation` | Policy text, optional notice/fee/currency, late-arrival grace and explicit terms confirmation |
| `reminders` | Enabled/disabled and 1–5 unique offsets, each 1–10,080 minutes before |

`revision` from the latest GET is mandatory on PATCH. Send only fields being
changed. Nested buffers/cancellation/reminder objects accept partial changes.
Hours are replaced as a complete weekly list when provided. An empty list closes
all days; it does not delete existing appointments.

Example:

```json
{
  "revision": 2,
  "minimumNoticeMinutes": 1440,
  "reminders": {"enabled": true, "minutesBefore": [60]}
}
```

The response contains `{data,meta:{requestId}}`. The revision increases only
after a successful transactional save. Audit records store actor, revision and
changed field names. No client or contact data is part of this endpoint.

Read-only fields include `canEdit`, `minimumNoticeConfirmed`, `bookingMode`,
`publicBookingEnabled`, reminder recipient and delivery status. Unknown fields
are rejected; this endpoint cannot enable public booking or bypass reconciliation.
When first-party booking is active, updates return
`LIVE_SCHEDULE_REVIEW_REQUIRED` until an operational review pauses new booking.
Settings changes never cancel or move existing Square appointments.

Cancellation terms can only be marked confirmed after policy text, a numeric
notice period and a numeric fee are supplied. A fee of zero explicitly means
none; null means unknown. A nonzero fee also requires an ISO currency code.
These values configure policy, not automatic financial charges.

Errors include `SETTINGS_CHANGED` (409), `INVALID_SCHEDULING_SETTINGS` (400),
`SETTINGS_EDIT_FORBIDDEN` (403), `WORKSPACE_NOT_FOUND` (404), request-size limit
(413), JSON content-type requirement (415), and dependency/configuration errors.
Requests are capped at 16 KiB. Reload after a stale revision rather than silently
overwriting another person's changes.

See `docs/openapi.json` and `docs/fixtures/api-v1/scheduling-settings.*.json`.

## Restricted runtime grants

After creating the restricted application role and configuring its pooler URL,
add these permissions to the identity grants in `BACKEND-SETUP.md`. Replace the
example role name with the actual runtime role. Never use an owner role in the
web app. These grants have not been run against an invented role.

```sql
GRANT USAGE ON SCHEMA scheduling TO mya_runtime;
GRANT SELECT ON scheduling.settings, scheduling.working_hours TO mya_runtime;
GRANT UPDATE(timezone, updated_at) ON public.organizations TO mya_runtime;
GRANT UPDATE(notice_minutes, horizon_days, horizon_months, buffer_before_minutes,
  buffer_after_minutes, slot_minutes, hold_minutes, required_contact_fields,
  cancellation_policy, policy_details, appointment_reminders_enabled,
  reminder_minutes_before, revision, updated_at)
  ON scheduling.settings TO mya_runtime;
GRANT INSERT(organization_id, resource_id, weekday, start_local, end_local), DELETE
  ON scheduling.working_hours TO mya_runtime;
GRANT INSERT(organization_id, actor_user_id, event_type, metadata)
  ON scheduling.audit_events TO mya_runtime;
```

The backend verifies membership before setting its transaction-local organization
context. Supabase browser roles retain no access to the scheduling schema. The
runtime role is not granted migrations, memberships, activation flags, booking
writes, Square secrets or customer data by these instructions.

## Verification

Integration tests use PostgreSQL-compatible storage to exercise owner/admin saves,
member read-only access, denied/revoked memberships, stale revisions, input
validation, hours, reminders, audit records and a non-owner runtime database role.
Supabase verification confirms 24-hour notice, `[60]` reminder timing and disabled
public booking. No reminder is sent by these tests or migrations.
