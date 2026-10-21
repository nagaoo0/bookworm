// Session time zone for the pg pool. Date-only inputs ('2024-05-01') are
// interpreted in this zone, so pinning it keeps results independent of the
// database server's default. UTC unless PG_TIMEZONE says otherwise (an IANA
// name such as Europe/Berlin). Only [A-Za-z0-9_+-/:] is accepted because the
// value is spliced into a libpq `options` string.
export function sessionTimezone(env = process.env) {
  const tz = (env.PG_TIMEZONE ?? '').trim();
  if (!tz) return 'UTC';
  if (!/^[A-Za-z0-9_+\-/:]+$/.test(tz)) {
    console.warn(`Ignoring invalid PG_TIMEZONE "${tz}" — using UTC`);
    return 'UTC';
  }
  return tz;
}

export const pgOptions = (env = process.env) => `-c timezone=${sessionTimezone(env)}`;
