const rateLimits = new Map<string, number>();

// The window is stored by setRateLimit (Date.now() + ttlMs) and re-read here as
// an absolute expiry, so this function needs no ttl of its own.
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const existing = rateLimits.get(key);
  if (existing && existing > now) return true;
  if (existing) rateLimits.delete(key);
  return false;
}

export function setRateLimit(key: string, ttlMs: number): void {
  rateLimits.set(key, Date.now() + ttlMs);
}

export function clearRateLimit(key: string): void {
  rateLimits.delete(key);
}
