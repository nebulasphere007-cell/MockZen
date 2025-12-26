import { cookies } from "next/headers"
import crypto from "crypto"

// NO DEFAULT CREDENTIALS - must be set in environment variables
function getSuperAdminCredentials() {
  const credentials: Record<string, string> = {}
  
  if (process.env.SUPERADMIN_CREDENTIALS) {
    const pairs = process.env.SUPERADMIN_CREDENTIALS.split(",")
    for (const pair of pairs) {
      const [email, password] = pair.split(":")
      if (email && password) {
        credentials[email.trim().toLowerCase()] = password.trim()
      }
    }
  }
  
  if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
    credentials[process.env.SUPERADMIN_EMAIL.toLowerCase()] = process.env.SUPERADMIN_PASSWORD
  }
  
  return credentials
}

export async function verifySuperAdminSession(): Promise<{ authenticated: boolean; email?: string }> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get("super_admin_session")?.value

    if (!sessionToken) {
      return { authenticated: false }
    }

    // Verify token format (SHA256 hash is 64 characters)
    if (sessionToken.length === 64) {
      const credentials = getSuperAdminCredentials()
      // Only authenticate if credentials are properly configured in env
      if (Object.keys(credentials).length > 0) {
        return { authenticated: true, email: Object.keys(credentials)[0] }
      }
    }

    return { authenticated: false }
  } catch (error) {
    console.error("Error verifying super admin session:", error)
    return { authenticated: false }
  }
}
