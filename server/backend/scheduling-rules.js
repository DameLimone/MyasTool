// Date-only calendar arithmetic; a three-month horizon is not a fixed 90 days.
export function addCalendarMonths(date, months) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(months) || months < 1 || months > 12) throw new RangeError('Invalid calendar horizon.');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new RangeError('Invalid calendar date.');
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function lastBookableDate(now, timeZone, months) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return addCalendarMonths(`${parts.year}-${parts.month}-${parts.day}`, months);
}
