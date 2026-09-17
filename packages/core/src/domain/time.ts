/** Desfase (minutos) de una zona horaria respecto a UTC en un instante dado. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convierte una fecha-hora local ("2026-09-20T09:30") de la zona de la marca a un instante UTC.
 * Recalcula el desfase en el instante resultante para respetar cambios de horario.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Fecha local inválida: ${local}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const first = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  return new Date(naive - offsetMinutes(first, timeZone) * 60_000);
}

/** "YYYY-MM-DDTHH:MM" de un instante en una zona horaria (para inputs datetime-local). */
export function utcToZonedLocal(instant: Date, timeZone: string): string {
  const shifted = new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Minutos desde medianoche en una zona horaria. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const local = utcToZonedLocal(instant, timeZone);
  return Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Si `instant` cae dentro del horario silencioso, devuelve cuándo termina; si no, null.
 * Soporta ventanas que cruzan medianoche (22:00–07:00).
 */
export function quietHoursEnd(
  instant: Date,
  timeZone: string,
  start?: string | null,
  end?: string | null,
): Date | null {
  if (!start || !end || start === end) return null;
  const now = minutesOfDay(instant, timeZone);
  const s = toMin(start);
  const e = toMin(end);
  const inside = s < e ? now >= s && now < e : now >= s || now < e;
  if (!inside) return null;
  const wait = (e - now + 24 * 60) % (24 * 60);
  const result = new Date(instant.getTime() + wait * 60_000);
  result.setUTCSeconds(0, 0);
  return result;
}

/** Inicio del día (00:00) en la zona horaria, como instante UTC. */
export function startOfDayInZone(instant: Date, timeZone: string): Date {
  return zonedLocalToUtc(`${utcToZonedLocal(instant, timeZone).slice(0, 10)}T00:00`, timeZone);
}

export function formatInZone(instant: Date, timeZone: string, locale = 'es-PE'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(instant);
}
