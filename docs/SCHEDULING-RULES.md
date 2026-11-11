# Mya's confirmed scheduling rules

User-confirmed on 2026-11-11; stored in the MyasTool Supabase project for
organization slug `mk-manikure-lounge`. Configuration does not enable booking.

| Rule | Confirmed value |
| --- | --- |
| Timezone | `America/Chicago` (Central time, including daylight saving) |
| Monday–Friday | Closed |
| Saturday | 10:00–17:00, salon-local time |
| Sunday | 10:00–17:00, salon-local time |
| Before/after buffers | 0 minutes |
| Minimum notice for new bookings | 24 hours (1,440 minutes) |
| Booking horizon | 3 calendar months; not a fixed 90 days |
| Required contact fields | Phone number, first name, last name, email |
| Appointment reminder preference | 60 minutes before; delivery worker not implemented |

The last bookable local date is the salon's current local date plus three
calendar months, clamped to the last day of the target month if necessary.
For example, November 11 → February 11 and January 31 → April 30. The eventual
availability engine must enforce opening hours and require the whole appointment
to finish by 17:00; a 17:00 start is not valid for a positive-duration service.
The date-only helper in `server/backend/scheduling-rules.js` covers this horizon
arithmetic. It is not a slot generator or an enabled public booking API.

## Website FAQ policy

Reference reviewed: `stonksmasters/mknails` commit
`189424fd17367d12e93180844157aa5793a1eee3`,
`mk-lounge-deploy.tar.gz` → `dist/index.html`, “What if I'm running late?”

The published FAQ allows possible cancellation for arrivals more than ten
minutes late and possible booking restrictions for no-call/no-show appointments,
unless otherwise arranged. These are recorded as staff-review decisions, not
automatic cancellations or bans. Customers are directed to contact Mya when
plans change.

The FAQ does not specify an advance cancellation/rescheduling deadline or a fee.
Those values remain null/unknown, not zero or “no fee.” The user subsequently
confirmed that a new booking needs 24 hours' notice, so `notice_minutes=1440`
and `policy_details.minimumNoticeConfirmed=true`. This does not establish a
cancellation deadline. Public activation is still blocked.

## Still pending

- Cancellation/rescheduling notice deadline and whether a fee applies.
- Final service menu, add-on combinations, prices and durations.
- Confirmed owner identity, Square seller/location mapping, complete upcoming
  appointment reconciliation and launch/cutover approval.

Public booking stays disabled and the provider/resource stays disabled. Square
continues to accept live bookings. No customer records or existing appointments
were changed by saving these settings.

The settings are editable through the authenticated backend API described in
[Configurable Scheduling](CONFIGURABLE-SCHEDULING.md). John can use that contract
to build an owner/admin settings screen separately.
