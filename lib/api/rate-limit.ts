const store = new Map<string, { count: number; expiresAt: number }>()

export function isRateLimited(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now()
  const current = store.get(key)

  if (!current || current.expiresAt < now) {
    store.set(key, { count: 1, expiresAt: now + windowMs })
    return false
  }

  if (current.count >= limit) return true

  current.count += 1
  store.set(key, current)
  return false
}

export function rateLimitKeyFromRequest(request: Request, fallback = "anon"): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp
  return fallback
}

