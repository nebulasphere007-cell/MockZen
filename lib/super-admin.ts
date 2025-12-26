import { createClient } from "@/lib/supabase/server"
import { verifySuperAdminSession } from "@/lib/super-admin-auth"
import { cookies } from "next/headers"

export async function checkSuperAdminAccess() {
  const cookieStore = cookies()

  // 1) NEW SUPER ADMIN LOGIN SYSTEM
  const session = await verifySuperAdminSession(cookieStore)
  if (session?.authenticated) {
    return {
      authorized: true,
      user: null, // because new system does not use Supabase user object
    }
  }

  // 2) FALLBACK → SUPABASE AUTH (Legacy)
  const supabase = await createClient(cookieStore)

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { authorized: false, user: null }
  }

  const role = user.user_metadata?.role
  const email = user.email?.toLowerCase()

  const allowlist = (process.env.SUPERADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  const authorizedByUser =
    role === "super_admin" ||
    (email && allowlist.includes(email))

  return {
    authorized: authorizedByUser,
    user,
  }
}
