import { ApiError } from './errors.js';
import { execute, resultRows } from './query.js';

const invalid = message => { throw new ApiError(400, 'INVALID_SCHEDULING_SETTINGS', message); };
const own = (object, key) => Object.hasOwn(object, key);
function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${label} contains an unsupported or read-only field.`);
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') invalid(`${label} must be true or false.`);
  return value;
}
function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) invalid(`${label} must be text no longer than ${max} characters.`);
  return value.trim();
}

export function validateSettingsPatch(input, current) {
  keys(input, ['revision','timezone','weeklyHours','minimumNoticeMinutes','bookingHorizon','buffers','slotIntervalMinutes','holdMinutes','requiredContactFields','cancellation','reminders'], 'Settings');
  integer(input.revision, 1, 2147483646, 'Revision');
  if (Object.keys(input).length < 2) invalid('Include at least one setting to change.');
  const next = structuredClone(current);
  if (own(input, 'timezone')) {
    const zone = text(input.timezone, 100, 'Timezone');
    try { next.timezone = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone; }
    catch { invalid('Use a valid IANA timezone.'); }
  }
  if (own(input, 'minimumNoticeMinutes')) next.minimumNoticeMinutes = integer(input.minimumNoticeMinutes, 0, 43200, 'Minimum booking notice');
  if (own(input, 'holdMinutes')) next.holdMinutes = integer(input.holdMinutes, 1, 15, 'Hold duration');
  if (own(input, 'slotIntervalMinutes')) next.slotIntervalMinutes = integer(input.slotIntervalMinutes, 5, 60, 'Slot interval');
  if (own(input, 'bookingHorizon')) {
    keys(input.bookingHorizon, ['unit','value'], 'Booking horizon');
    if (!['months','days'].includes(input.bookingHorizon.unit)) invalid('Booking horizon unit must be months or days.');
    next.bookingHorizon = { unit: input.bookingHorizon.unit, value: integer(input.bookingHorizon.value, 1, input.bookingHorizon.unit === 'months' ? 12 : 365, 'Booking horizon') };
  }
  if (own(input, 'buffers')) {
    keys(input.buffers, ['beforeMinutes','afterMinutes'], 'Buffers');
    for (const key of Object.keys(input.buffers)) next.buffers[key] = integer(input.buffers[key], 0, 180, 'Appointment buffer');
  }
  if (own(input, 'weeklyHours')) {
    if (!Array.isArray(input.weeklyHours) || input.weeklyHours.length > 28) invalid('Weekly hours must contain at most 28 periods. Omitted days are closed.');
    next.weeklyHours = input.weeklyHours.map(period => {
      keys(period, ['weekday','start','end'], 'Working-hours period');
      integer(period.weekday, 0, 6, 'Weekday');
      if (![period.start,period.end].every(t => typeof t === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) || period.start >= period.end) invalid('Working hours need a start before the end on the same day, using HH:MM.');
      return { weekday: period.weekday, start: period.start, end: period.end };
    }).sort((a,b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    for (let i=1; i<next.weeklyHours.length; i++) {
      const previous = next.weeklyHours[i-1], period = next.weeklyHours[i];
      if (previous.weekday === period.weekday && period.start < previous.end) invalid('Working-hours periods cannot overlap.');
    }
  }
  if (own(input, 'requiredContactFields')) {
    const fields = input.requiredContactFields;
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > 4 || new Set(fields).size !== fields.length || fields.some(f => !['phone','firstName','lastName','email'].includes(f))) invalid('Choose one or more unique contact fields: phone, firstName, lastName, email.');
    next.requiredContactFields = [...fields];
  }
  if (own(input, 'cancellation')) {
    keys(input.cancellation, ['policyText','noticeMinutes','feeMinor','feeCurrency','termsConfirmed','lateArrivalGraceMinutes'], 'Cancellation settings');
    for (const [key,value] of Object.entries(input.cancellation)) {
      if (key === 'policyText') next.cancellation.policyText = text(value, 4000, 'Cancellation policy');
      else if (key === 'termsConfirmed') next.cancellation.termsConfirmed = boolean(value, 'Cancellation terms confirmation');
      else if (key === 'feeCurrency') {
        if (value !== null && (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))) invalid('Fee currency must be an ISO currency code or null.');
        next.cancellation.feeCurrency = value;
      } else next.cancellation[key] = value === null && key !== 'lateArrivalGraceMinutes' ? null : integer(value, 0, key === 'feeMinor' ? 10000000 : key === 'lateArrivalGraceMinutes' ? 180 : 43200, key);
    }
    if (next.cancellation.feeMinor > 0 && !next.cancellation.feeCurrency) invalid('A cancellation fee needs a currency.');
    if (next.cancellation.termsConfirmed && (next.cancellation.noticeMinutes === null || next.cancellation.feeMinor === null || !next.cancellation.policyText)) invalid('Confirm the notice period, fee (zero for none), and policy text before confirming cancellation terms.');
  }
  if (own(input, 'reminders')) {
    keys(input.reminders, ['enabled','minutesBefore'], 'Reminder settings');
    if (own(input.reminders, 'enabled')) next.reminders.enabled = boolean(input.reminders.enabled, 'Reminders');
    if (own(input.reminders, 'minutesBefore')) {
      const offsets = input.reminders.minutesBefore;
      if (!Array.isArray(offsets) || offsets.length < 1 || offsets.length > 5 || new Set(offsets).size !== offsets.length) invalid('Choose one to five unique reminder offsets.');
      next.reminders.minutesBefore = offsets.map(v => integer(v, 1, 10080, 'Reminder minutes before')).sort((a,b) => b-a);
    }
  }
  return next;
}

export async function setSchedulingContext(transaction, organizationId) {
  await execute(transaction, "SELECT set_config('mya.organization_id',$1,true)", [organizationId]);
}

export async function getSchedulingSettings(transaction, workspace, { lock = false } = {}) {
  const row = resultRows(await execute(transaction, `SELECT s.*,o.timezone FROM scheduling.settings s JOIN public.organizations o ON o.id=s.organization_id WHERE s.organization_id=$1 ${lock ? 'FOR UPDATE OF s' : ''}`, [workspace.id]))[0];
  if (!row) throw new ApiError(404, 'SCHEDULING_NOT_CONFIGURED', 'Scheduling settings have not been configured for this workspace.');
  const hours = resultRows(await execute(transaction, `SELECT weekday,left(start_local::text,5) AS start,left(end_local::text,5) AS end FROM scheduling.working_hours WHERE organization_id=$1 AND resource_id=$2 ORDER BY weekday,start_local`, [workspace.id,row.resource_id]));
  const p = row.policy_details;
  return {
    revision: row.revision, timezone: row.timezone, weeklyHours: hours,
    minimumNoticeMinutes: row.notice_minutes,
    minimumNoticeConfirmed: p.minimumNoticeConfirmed === true,
    bookingHorizon: { unit: row.horizon_months === null ? 'days' : 'months', value: row.horizon_months ?? row.horizon_days },
    buffers: { beforeMinutes: row.buffer_before_minutes, afterMinutes: row.buffer_after_minutes },
    slotIntervalMinutes: row.slot_minutes, holdMinutes: row.hold_minutes,
    requiredContactFields: row.required_contact_fields,
    cancellation: { policyText: row.cancellation_policy || '', noticeMinutes: p.cancellationNoticeMinutes ?? null, feeMinor: p.cancellationFeeMinor ?? null, feeCurrency: p.cancellationFeeCurrency ?? null, termsConfirmed: p.cancellationTermsConfirmed === true, lateArrivalGraceMinutes: p.lateArrivalGraceMinutes ?? 10 },
    reminders: { enabled: row.appointment_reminders_enabled, minutesBefore: row.reminder_minutes_before, recipient: 'workspace_owner', deliveryStatus: 'not_implemented' },
    publicBookingEnabled: row.public_booking_enabled, bookingMode: row.booking_mode,
    canEdit: ['owner','admin'].includes(workspace.role),
  };
}

export async function updateSchedulingSettings(transaction, workspace, userId, input) {
  const current = await getSchedulingSettings(transaction, workspace, { lock: true });
  const next = validateSettingsPatch(input, current);
  if (input?.revision !== current.revision) throw new ApiError(409, 'SETTINGS_CHANGED', 'Settings changed. Reload the current settings before saving.');
  if (current.publicBookingEnabled) throw new ApiError(409, 'LIVE_SCHEDULE_REVIEW_REQUIRED', 'Pause first-party booking and review existing reservations before changing schedule settings.');
  if (own(input,'minimumNoticeMinutes')) next.minimumNoticeConfirmed = true;
  await execute(transaction, 'UPDATE public.organizations SET timezone=$2,updated_at=now() WHERE id=$1', [workspace.id,next.timezone]);
  const policy = { minimumNoticeConfirmed: next.minimumNoticeConfirmed, cancellationTermsConfirmed: next.cancellation.termsConfirmed, cancellationNoticeMinutes: next.cancellation.noticeMinutes, cancellationFeeMinor: next.cancellation.feeMinor, cancellationFeeCurrency: next.cancellation.feeCurrency, lateArrivalGraceMinutes: next.cancellation.lateArrivalGraceMinutes };
  await execute(transaction, `UPDATE scheduling.settings SET notice_minutes=$2,horizon_days=$3,horizon_months=$4,buffer_before_minutes=$5,buffer_after_minutes=$6,slot_minutes=$7,hold_minutes=$8,required_contact_fields=$9::text[],cancellation_policy=$10,policy_details=policy_details||$11::jsonb,appointment_reminders_enabled=$12,reminder_minutes_before=$13::integer[],revision=revision+1,updated_at=now() WHERE organization_id=$1`, [workspace.id,next.minimumNoticeMinutes,next.bookingHorizon.unit==='days'?next.bookingHorizon.value:null,next.bookingHorizon.unit==='months'?next.bookingHorizon.value:null,next.buffers.beforeMinutes,next.buffers.afterMinutes,next.slotIntervalMinutes,next.holdMinutes,next.requiredContactFields,next.cancellation.policyText,JSON.stringify(policy),next.reminders.enabled,next.reminders.minutesBefore]);
  if (own(input,'weeklyHours')) {
    await execute(transaction,'DELETE FROM scheduling.working_hours WHERE organization_id=$1 AND resource_id=(SELECT resource_id FROM scheduling.settings WHERE organization_id=$1)',[workspace.id]);
    for (const period of next.weeklyHours) await execute(transaction,`INSERT INTO scheduling.working_hours(organization_id,resource_id,weekday,start_local,end_local) SELECT organization_id,resource_id,$2,$3::time,$4::time FROM scheduling.settings WHERE organization_id=$1`,[workspace.id,period.weekday,period.start,period.end]);
  }
  await execute(transaction,`INSERT INTO scheduling.audit_events(organization_id,actor_user_id,event_type,metadata) VALUES ($1,$2,'scheduling.settings_updated',$3::jsonb)`,[workspace.id,userId,JSON.stringify({previousRevision:current.revision,revision:current.revision+1,changedFields:Object.keys(input).filter(k=>k!=='revision')})]);
  return getSchedulingSettings(transaction,workspace);
}
