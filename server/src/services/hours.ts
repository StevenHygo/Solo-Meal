import type { RestaurantHours } from '../domain/repository.js';

interface ZonedClock {
  date: string;
  dayOfWeek: number;
  minutes: number;
}

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedClock(at: Date, timezone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const dayOfWeek = weekdayIndex[values.weekday ?? ''];
  if (dayOfWeek === undefined) throw new Error(`Unable to resolve weekday for ${timezone}`);
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    dayOfWeek,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (hours === undefined || minutes === undefined) throw new Error(`Invalid time ${value}`);
  return hours * 60 + minutes;
}

function intervalOpen(interval: RestaurantHours, minutes: number, fromPreviousDay: boolean): boolean {
  if (interval.isClosed) return false;
  const opens = timeMinutes(interval.opensAt);
  const closes = timeMinutes(interval.closesAt);
  const crossesMidnight = closes <= opens;
  if (fromPreviousDay) return crossesMidnight && minutes < closes;
  if (crossesMidnight) return minutes >= opens;
  return minutes >= opens && minutes < closes;
}

export function isRestaurantOpen(hours: RestaurantHours[], at: Date, timezone: string): boolean {
  const clock = zonedClock(at, timezone);
  const special = hours.filter(interval => interval.specialDate === clock.date);
  if (special.length) return special.some(interval => intervalOpen(interval, clock.minutes, false));

  const today = hours.filter(interval => interval.specialDate === null && interval.dayOfWeek === clock.dayOfWeek);
  const previousDay = (clock.dayOfWeek + 6) % 7;
  const previous = hours.filter(interval => interval.specialDate === null && interval.dayOfWeek === previousDay);
  return today.some(interval => intervalOpen(interval, clock.minutes, false))
    || previous.some(interval => intervalOpen(interval, clock.minutes, true));
}

export function formatHours(hours: RestaurantHours[]): string {
  const firstWeeklyDay = hours.find(interval => interval.specialDate === null)?.dayOfWeek;
  const representative = hours.filter(interval => interval.specialDate === null && interval.dayOfWeek === firstWeeklyDay && !interval.isClosed);
  if (!representative.length) return '营业时间待确认';
  return representative.map(interval => `${interval.opensAt.slice(0, 5)} - ${interval.closesAt.slice(0, 5)}`).join(' / ');
}
