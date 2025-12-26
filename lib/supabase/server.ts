import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"

/**
 * Replaced custom REST client with official @supabase/ssr package
 * This properly handles cookies and session management on the server
 */
export async function createClient() {
  const cookieStore = await cookies()
  const headerStore = await headers()

  try {
    const all = cookieStore.getAll().map(c => ({ name: c.name, value: String(c.value).slice(0,6) + '...' }))
    console.log('[supabase.server] cookieStore contents:', all)
  } catch (e) {
    // ignore in production
  }

  // Allow passing a Bearer token via Authorization header for script/CI usage.
  const authHeader = headerStore.get('authorization')
  let accessToken: string | undefined = undefined
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    accessToken = authHeader.split(' ')[1]
  }

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken,
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The "setAll" method was called from a Server Component.
          // This can be ignored if you have proxy refreshing user sessions.
        }
      },
    },
  })
}

export async function createAdminClient() {
  const cookieStore = await cookies()

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Ignore errors in Server Components
        }
      },
    },
  })
}
