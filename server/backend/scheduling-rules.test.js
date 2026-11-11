import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths, lastBookableDate } from './scheduling-rules.js';

test('three calendar months clamp month ends and preserve leap days', () => {
  assert.equal(addCalendarMonths('2026-11-11', 3), '2027-02-11');
  assert.equal(addCalendarMonths('2026-01-31', 3), '2026-04-30');
  assert.equal(addCalendarMonths('2027-11-30', 3), '2028-02-29');
  assert.throws(() => addCalendarMonths('2026-02-30', 3), RangeError);
});

test('horizon uses the Central calendar date at UTC midnight and across DST', () => {
  assert.equal(lastBookableDate(new Date('2026-11-12T02:00:00Z'), 'America/Chicago', 3), '2027-02-11');
  assert.equal(lastBookableDate(new Date('2026-03-09T04:30:00Z'), 'America/Chicago', 3), '2026-06-08');
});
