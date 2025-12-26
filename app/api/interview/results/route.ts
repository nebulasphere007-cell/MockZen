import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const interviewId = searchParams.get("interviewId")

    console.log("[v0] Fetching results for interview:", interviewId)

    if (!interviewId) {
      return NextResponse.json({ error: "Interview ID is required" }, { status: 400 })
    }

    const supabase = await createAdminClient()

    const { data: analysis, error: analysisError } = await supabase
      .from("interview_results")
      .select("*")
      .eq("interview_id", interviewId)
      .maybeSingle()

    console.log("[v0] Analysis query result:", { analysis, error: analysisError })

    if (analysisError) {
      console.error("[v0] Error fetching analysis:", analysisError)
      return NextResponse.json({ error: analysisError.message }, { status: 500 })
    }

    if (!analysis) {
      console.log("[v0] No analysis found for interview:", interviewId)
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
    }

    const { data: responses, error: responsesError } = await supabase
      .from("interview_responses")
      .select("*")
      .eq("interview_id", interviewId)
      .order("question_number")

    if (responsesError) {
      console.error("[v0] Error fetching responses:", responsesError)
    }

    // Try to fetch link to scheduled_interviews and batch info when possible
    let scheduleId: string | null = null
    let batchId: string | null = null
    let interviewType: string = "technical"; // Default value
    try {
      // First attempt to fetch scheduled_interview_id and interview_type from interviews table (columns may not exist)
      const { data: interviewRow, error: interviewRowError } = await supabase
        .from("interviews")
        .select("scheduled_interview_id, interview_type")
        .eq("id", interviewId)
        .maybeSingle()

      if (interviewRowError) {
        const msg = interviewRowError?.message || String(interviewRowError)
        if (/scheduled_interview_id|column .*does not exist/i.test(msg)) {
          console.warn('[v0] results: interviews.scheduled_interview_id column missing, skipping schedule lookup')
        } else {
          console.error('[v0] results: error fetching interview row for schedule lookup:', interviewRowError)
        }
      } else if (interviewRow) {
        scheduleId = (interviewRow as any).scheduled_interview_id
        const rawInterviewType = interviewRow.interview_type || "technical";
        // Preserve the full interview_type (including subtypes like "aptitude-quantitative") so the UI can render subtype-specific views
        interviewType = rawInterviewType;
        console.log("[v0] Raw interview_type from DB:", rawInterviewType);
        console.log("[v0] Interview row details:", interviewRow);
      }

      if (scheduleId) {
        const { data: scheduleRow, error: scheduleError } = await supabase
          .from("scheduled_interviews")
          .select("id,batch_id")
          .eq("id", scheduleId)
          .maybeSingle()

        if (scheduleError) {
          console.error('[v0] results: error fetching scheduled_interviews row:', scheduleError)
        } else if (scheduleRow) {
          batchId = scheduleRow.batch_id || null
        }
      }
    } catch (err) {
      console.error('[v0] results: unexpected error while looking up schedule/batch:', err)
    }

    const formattedAnalysis = {
      overall_score: analysis.overall_score,
      communication_score: analysis.communication_score,
      technical_score: analysis.technical_score,
      dsa_score: analysis.dsa_score || analysis.technical_score, // Include DSA score
      logical_reasoning_score: analysis.logical_reasoning_score || analysis.technical_score, // Include aptitude score
      problem_solving_score: analysis.problem_solving_score,
      confidence_score: analysis.confidence_score,
      strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
      improvements: Array.isArray(analysis.improvements) ? analysis.improvements : [],
      detailed_feedback: analysis.detailed_feedback || "",
      correct_answers_count: analysis.correct_answers_count, // Include correct answers
      total_questions: analysis.total_questions, // Include total questions
      answered_questions: analysis.answered_questions, // Include answered questions
      wrong_answers_count: analysis.wrong_answers_count, // Include wrong answers
      not_answered_questions_count: analysis.not_answered_questions_count, // Include not answered questions
      interviewType: interviewType, // Include interviewType in the response
    }

    console.log("[v0] Returning formatted analysis:", formattedAnalysis)
    return NextResponse.json({ analysis: formattedAnalysis, responses: responses || [], scheduleId, batchId })
  } catch (error) {
    console.error("[v0] Error in results route:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch results" },
      { status: 500 },
    )
  }
}
