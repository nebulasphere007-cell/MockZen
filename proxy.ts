import { updateSession } from "@/lib/supabase/proxy"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

export async function proxy(request: NextRequest) {
  // Honeypot redirect logic (controlled by env vars)
  const enabled = process.env.ADMIN_HONEYPOT_ENABLED === "true"
  const realPath = process.env.REAL_ADMIN_PATH || "/hidden-admin"
  const pathname = request.nextUrl.pathname

  if (enabled) {
    // If this request was internally rewritten from REAL_ADMIN_PATH to /super-admin, skip the honeypot redirect
    if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) {
      const hasSecret = request.nextUrl.searchParams.get("_secret_rewrite") === "1"
      console.log(`[honeypot proxy] path=${pathname} hasSecret=${hasSecret}`)
      if (!hasSecret) {
        console.log(`[honeypot proxy] redirecting ${pathname} -> /admin`)
        return NextResponse.redirect(new URL("/admin", request.url))
      }
    }

    // If a request comes to the secret REAL_ADMIN_PATH, rewrite it internally to /super-admin and add a query flag so subsequent proxy/middleware allows it
    if (pathname === realPath || pathname.startsWith(realPath + "/")) {
      console.log(`[honeypot proxy] rewriting ${pathname} -> /super-admin with secret flag`)
      const url = request.nextUrl.clone()
      url.pathname = "/super-admin"
      url.searchParams.set("_secret_rewrite", "1")
      const res = NextResponse.rewrite(url)
      return res
    }
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
