// In-memory limiter: a per-visitor sliding window plus a global daily cap, so a free model
// quota cannot be drained by one visitor or a bot. State lives in one server instance:
// serverless platforms run several instances, so the real limits are looser than configured.
// A shared store (Redis, a DB table) is the production answer; the README says so.

export type LimitResult = { ok: true } | { ok: false; reason: 'visitor' | 'daily'; retryAfterSec: number };

export interface LimiterOptions {
  windowMs: number;
  maxPerWindow: number;
  maxPerDay: number;
}

export function createLimiter({ windowMs, maxPerWindow, maxPerDay }: LimiterOptions) {
  const hits = new Map<string, number[]>();
  let day = '';
  let dayCount = 0;

  return {
    check(key: string, now = Date.now()): LimitResult {
      const today = new Date(now).toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        dayCount = 0;
      }
      if (dayCount >= maxPerDay) {
        const tomorrow = Date.parse(`${today}T00:00:00Z`) + 24 * 3600 * 1000;
        return { ok: false, reason: 'daily', retryAfterSec: Math.ceil((tomorrow - now) / 1000) };
      }

      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= maxPerWindow) {
        hits.set(key, recent);
        return { ok: false, reason: 'visitor', retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
      }
      recent.push(now);
      hits.set(key, recent);
      dayCount++;

      // Keep the map from growing without bound.
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      }
      return { ok: true };
    },
    reset() {
      hits.clear();
      day = '';
      dayCount = 0;
    },
  };
}

export type Limiter = ReturnType<typeof createLimiter>;

export function defaultLimiter(): Limiter {
  return createLimiter({
    windowMs: 10 * 60 * 1000,
    maxPerWindow: Number(process.env.EXTRACT_MAX_PER_10_MIN ?? 6),
    maxPerDay: Number(process.env.EXTRACT_MAX_PER_DAY ?? 100),
  });
}
