import { type NextRequest, NextResponse } from "next/server"
import { createGroq } from "@ai-sdk/groq"
import { generateText } from "ai"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { isRateLimited, rateLimitKeyFromRequest } from "@/lib/api/rate-limit"

const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const requestSchema = z.object({
  transcript: z.string().min(1, "Transcript is required").max(4000),
  context: z
    .object({
      question: z.string().optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = await request.json().then((body) => requestSchema.safeParse(body))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { transcript, context } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rateKey = rateLimitKeyFromRequest(request, user.id)
    if (isRateLimited(rateKey, 30, 60_000)) {
      return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 })
    }

    const { text } = await generateText({
      model: groqClient("llama-3.3-70b-versatile"),
      prompt: `You are an expert at detecting when someone has finished speaking in an interview conversation.

Context: This is an interview. The user is answering a question: "${context?.question || "a question"}"

Current transcript of what the user has said so far:
"${transcript}"

IMPORTANT: In interviews, people often pause naturally after completing their answer. Be PROACTIVE about detecting completion - it's better to move forward than to wait too long.

Analyze this transcript and determine if the user has completed their answer:

CRITERIA FOR COMPLETION (mark as complete if ANY apply):
- The answer addresses the question with a complete thought (even if brief)
- Natural sentence endings (periods, question marks, exclamation marks)
- Phrases that signal completion: "that's all", "that's it", "I think that's everything", "hope that helps"
- The user has provided a substantive answer (3+ words) that answers the question
- Natural pauses after a complete statement

CRITERIA FOR CONTINUATION (mark as incomplete ONLY if):
- Active filler words at the very end: "um...", "uh...", "and um..."
- Mid-sentence cutoff: "I think that because..." (clearly incomplete)
- Very short responses (1-2 words) that don't answer the question

EXAMPLES OF COMPLETE ANSWERS:
- "I worked on a React project where I implemented hooks" ✓ COMPLETE
- "I have 3 years of experience in frontend development" ✓ COMPLETE  
- "I think I handled it well by communicating with the team" ✓ COMPLETE
- "Yes, I've used React hooks extensively" ✓ COMPLETE

EXAMPLES OF INCOMPLETE ANSWERS:
- "I think that because um..." ✗ INCOMPLETE
- "Well, I" ✗ INCOMPLETE

Respond in JSON format:
{
  "isComplete": boolean (true if user is done, false if still speaking),
  "confidence": number (0.0 to 1.0 confidence score),
  "reasoning": "brief explanation of your decision"
}

Be decisive - if the answer seems complete, mark it as complete with high confidence.`,
      temperature: 0.3,
    })

    // Parse the JSON response
    const cleanedText = text.replace(/```json\n?|\n?```/g, "").trim()
    const analysis = JSON.parse(cleanedText)

    console.log("[v0] LLM Turn Detection:", {
      transcript: transcript.substring(0, 50) + "...",
      isComplete: analysis.isComplete,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
    })

    return NextResponse.json(analysis)
  } catch (error) {
    console.error("[v0] Turn detection error:", error)
    return NextResponse.json(
      {
        isComplete: false,
        confidence: 0,
        reasoning: "Error analyzing transcript",
      },
      { status: 500 },
    )
  }
}
