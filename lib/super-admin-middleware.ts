import { NextResponse } from "next/server"
import { cookies } from "next/headers"

// Rate limiting for super admin API actions
const actionAttempts = new Map<string, { count: number; resetAt: number }>()

const MAX_ACTIONS_PER_MINUTE = 30
const WINDOW_MS = 60 * 1000 // 1 minute

function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown"
  }
  return request.headers.get("x-real-ip") || "unknown"
}

export function rateLimitSuperAdminAction(request: Request): { allowed: boolean; error?: NextResponse } {
  const ip = getClientIP(request)
  const now = Date.now()
  const record = actionAttempts.get(ip)

  if (!record || record.resetAt < now) {
    actionAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (record.count >= MAX_ACTIONS_PER_MINUTE) {
    return {
      allowed: false,
      error: NextResponse.json(
        { error: "Too many requests. Please wait a minute." },
        { status: 429 }
      )
    }
  }

  record.count += 1
  actionAttempts.set(ip, record)
  return { allowed: true }
}

export async function verifySuperAdminRequest(request: Request): Promise<{ 
  authorized: boolean
  error?: NextResponse 
}> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get("super_admin_session")?.value

    if (!sessionToken || sessionToken.length !== 64) {
      return {
        authorized: false,
        error: NextResponse.json({ error: "Unauthorized - Please login as super admin" }, { status: 401 })
      }
    }

    // Check if credentials are configured
    const hasCredentials = !!(
      process.env.SUPERADMIN_CREDENTIALS ||
      (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD)
    )

    if (!hasCredentials) {
      return {
        authorized: false,
        error: NextResponse.json({ error: "Super admin not configured" }, { status: 403 })
      }
    }

    // Check rate limit
    const rateLimit = rateLimitSuperAdminAction(request)
    if (!rateLimit.allowed) {
      return { authorized: false, error: rateLimit.error }
    }

    return { authorized: true }
  } catch (error) {
    console.error("Error verifying super admin request:", error)
    return {
      authorized: false,
      error: NextResponse.json({ error: "Authentication error" }, { status: 500 })
    }
  }
}

