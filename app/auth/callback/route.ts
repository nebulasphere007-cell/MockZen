import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")

  if (code) {
    const supabase = await createClient();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7b85b57d-d53d-4000-9ec2-d7db075b5f8a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/auth/callback/route.ts:15',message:'Attempting to exchange code for session',data:{code: code},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'Bug1Fix'})}).catch(()=>{});
    // #endregion
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7b85b57d-d53d-4000-9ec2-d7db075b5f8a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/auth/callback/route.ts:20',message:'Code exchange successful',timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7b85b57d-d53d-4000-9ec2-d7db075b5f8a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'app/auth/callback/route.ts:25',message:'Code exchange failed',data:{error: error.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  }

  // URL to redirect to if there's no code or an error
  return NextResponse.redirect(new URL("/auth", request.url))
}
