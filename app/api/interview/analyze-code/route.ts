import { generateText } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { isRateLimited, rateLimitKeyFromRequest } from "@/lib/api/rate-limit"

const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const requestSchema = z.object({
  code: z.string().min(1, "Code is required").max(10000),
  problem: z.string().min(1, "Problem is required").max(4000),
  interviewType: z.string().min(1, "Interview type is required"),
})

export async function POST(request: Request) {
  try {
    const parsed = await request.json().then((body) => requestSchema.safeParse(body))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const { code, problem, interviewType } = parsed.data

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rateKey = rateLimitKeyFromRequest(request, user.id)
    if (isRateLimited(rateKey, 10, 60_000)) {
      return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 })
    }

    console.log("[v0] Analyzing code submission for DSA problem")

    const analysisPrompt = `You are an expert coding interviewer analyzing a candidate's solution to a DSA problem.

PROBLEM:
${problem}

CANDIDATE'S CODE:
${code}

Analyze this code and provide:
1. **Correctness**: Does the code solve the problem correctly? Are there any bugs or edge cases missed?
2. **Time Complexity**: What is the time complexity (Big O notation)?
3. **Space Complexity**: What is the space complexity (Big O notation)?
4. **Code Quality**: Is the code clean, readable, and well-structured?
5. **Optimization**: Can the solution be optimized further?
6. **Suggestions**: Provide specific recommendations for improvement

Be constructive, specific, and educational. Keep your feedback concise (3-5 sentences per point).`

    const result = await generateText({
      model: groqClient("llama-3.3-70b-versatile"),
      prompt: analysisPrompt,
      temperature: 0.7,
      maxTokens: 500,
    })

    const feedback = result.text

    console.log("[v0] Code analysis completed")

    return NextResponse.json({ feedback })
  } catch (error) {
    console.error("[v0] Error analyzing code:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to analyze code" },
      { status: 500 },
    )
  }
}
