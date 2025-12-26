import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { Card } from "@/components/ui/card"
import { SuperAdminDashboard } from "@/components/super-admin-dashboard"
import { verifySuperAdminSession } from "@/lib/super-admin-auth"
import { redirect } from "next/navigation"
import { SuperAdminLogout } from "@/components/super-admin-logout"

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function SuperAdminPage({
  searchParams,
}: { searchParams?: { code?: string } }) {
  // Check super admin session first
  const session = await verifySuperAdminSession()
  
  // Also check legacy methods for backward compatibility
  const supabase = await createClient()
  const {
    data: { session: newSession },
  } = await supabase.auth.getSession()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const role = user?.user_metadata?.role
  const email = user?.email?.toLowerCase()
  const allowlist =
    process.env.SUPERADMIN_EMAILS?.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean) || []
  const passcode = process.env.SUPERADMIN_PASSCODE?.trim()
  const resolvedSearchParams = await searchParams; // Await the searchParams Promise
  const codeFromQuery = typeof resolvedSearchParams?.code === "string" ? resolvedSearchParams.code : undefined

  const authorizedBySession = session.authenticated
  const authorizedByUser = !!user && (role === "super_admin" || (email && allowlist.includes(email)))
  const authorizedByCode = passcode && codeFromQuery === passcode
  const authorized = authorizedBySession || authorizedByUser || authorizedByCode

  // If not authorized, redirect to login (preserve secret path via query)
  if (!authorized) {
    const isSecret = (resolvedSearchParams as any)?._secret_rewrite === "1"
    if (isSecret) {
      const secretPath = process.env.REAL_ADMIN_PATH || "/hidden-admin"
      const redirectUrl = `/super-admin/login?redirect=${encodeURIComponent(secretPath)}&_secret_rewrite=1`
      redirect(redirectUrl)
    } else {
      redirect("/super-admin/login")
    }
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <Card className="p-6 text-center space-y-4 max-w-md">
          <div className="text-lg font-semibold text-gray-900">Access denied</div>
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              Your account is not authorized for super admin access. To gain access, you need one of the following:
            </p>
            <ul className="text-left list-disc list-inside space-y-1 ml-2 text-xs">
              <li>Your email ({email || "unknown"}) must be in the SUPERADMIN_EMAILS environment variable</li>
              <li>Your user role must be set to "super_admin" in user metadata</li>
              {passcode && <li>Enter the correct passcode below</li>}
            </ul>
          </div>
          
          <div className="text-xs text-gray-500 space-y-1 border-t pt-3">
            <div><strong>Debug Info:</strong></div>
            <div>Email: {email || "unknown"}</div>
            <div>Role: {role || "not set"}</div>
            <div>Allowlist configured: {allowlist.length > 0 ? "Yes" : "No"}</div>
            {allowlist.length > 0 && (
              <div className="text-xs">Allowlist emails: {allowlist.join(", ")}</div>
            )}
            <div>Passcode configured: {passcode ? "Yes" : "No"}</div>
          </div>

          {passcode ? (
            <form className="space-y-2" method="GET">
              <div className="text-xs text-gray-500">Enter passcode:</div>
              <input
                type="password"
                name="code"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="Enter passcode"
              />
              <button
                type="submit"
                className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Submit
              </button>
            </form>
          ) : null}
          
          <div className="flex flex-col gap-2 pt-2">
            <Link
              href="/auth"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Switch account
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </div>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Super Admin</h1>
            <p className="text-gray-600">Manage credits, institutions, members, and usage.</p>
          </div>
          <SuperAdminLogout />
        </div>

        <SuperAdminDashboard />
      </div>
    </main>
  )
}

