import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { getInterviewCost } from "@/utils/credits"

export async function POST(request: Request) {
  try {
    const { interviewType: rawInterviewType, userId, userEmail, userName, duration, difficulty, customScenario } = await request.json()

    // Infer interview type from referer if needed
    let interviewType = rawInterviewType || 'technical'
    try {
      const referer = request.headers.get('referer') || ''
      if (referer && !interviewType.includes('-')) {
        const match = referer.match(/\/interview\/course\/([^\/]+)\/([^\/?#]+)/i)
        if (match) {
          interviewType = `${match[1]}-${match[2]}`
        }
      }
    } catch {
      // Ignore referer parsing errors
    }

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 })
    }

    // Calculate question count based on duration
    let questionCount: number
    if (duration <= 15) questionCount = 6
    else if (duration <= 30) questionCount = 14
    else if (duration <= 60) questionCount = 25
    else questionCount = Math.ceil((duration / 60) * 25)

    const cost = getInterviewCost(duration || 15)
    const supabase = await createAdminClient()

    // OPTIMIZATION: Run user upsert and credit check in PARALLEL
    const [userResult, creditResult] = await Promise.all([
      // User upsert (fire and forget style - we don't block on errors)
      supabase.from("users").upsert(
        { id: userId, email: userEmail || `user_${userId}@mockzen.app`, name: userName || "User" },
        { onConflict: "id", ignoreDuplicates: false }
      ).then(res => res).catch(() => ({ error: null })),
      
      // Credit check
      supabase.from("user_credits").select("balance").eq("user_id", userId).maybeSingle()
    ])

    // Handle credit check result
    if (creditResult.error) {
      return NextResponse.json({ error: "Could not verify credits" }, { status: 500 })
    }

    const balance = creditResult.data?.balance ?? 0
    if (balance < cost) {
      return NextResponse.json({ error: "Not enough credits" }, { status: 402 })
    }

    // OPTIMIZATION: Deduct credits and create interview in PARALLEL
    const [deductResult, interviewResult] = await Promise.all([
      // Deduct credits
      supabase.from("user_credits").update({ balance: balance - cost }).eq("user_id", userId),
      
      // Create interview
      supabase.from("interviews").insert({
        user_id: userId,
        interview_type: interviewType,
        status: "in_progress",
        started_at: new Date().toISOString(),
        difficulty: difficulty || "intermediate",
        question_count: questionCount,
      }).select().single()
    ])

    if (deductResult.error) {
      return NextResponse.json({ error: "Could not deduct credits" }, { status: 500 })
    }

    if (interviewResult.error) {
      return NextResponse.json({ error: interviewResult.error.message }, { status: 500 })
    }

    // OPTIMIZATION: Fire-and-forget transaction log (don't await)
    supabase.from("credit_transactions").insert({
      user_id: userId,
      delta: -cost,
      reason: "interview_start",
      metadata: { interviewType, duration, difficulty, customScenario },
    }).then(() => {}).catch(() => {})

    return NextResponse.json({ 
      interview: { ...interviewResult.data, question_count: questionCount } 
    })
  } catch (error) {
    console.error("[interview/start] Error:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
