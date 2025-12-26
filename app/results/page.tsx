"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import DashboardNavbar from "@/components/dashboard-navbar"
import ResultsOverview from "@/components/results-overview"
import AIFeedback from "@/components/ai-feedback"
import DetailedInsights from "@/components/detailed-insights"
import PerformanceMetrics from "@/components/performance-metrics"
import InterviewConversation from "@/components/interview-conversation"
import DSAAptitudeResultsUI from "@/components/dsa-aptitude-results-ui"
import AptitudeQuantitativeResultsUI from "@/components/aptitude-quantitative-results-ui"
import { generateAnalysis } from "@/app/actions/generate-analysis"

interface AnalysisData {
  overall_score: number
  communication_score: number
  technical_score: number
  dsa_score?: number // Added for DSA interviews
  logical_reasoning_score?: number // Added for Aptitude interviews
  problem_solving_score: number
  confidence_score: number
  eye_contact_score?: number
  smile_score?: number
  stillness_score?: number
  face_confidence_score?: number
  strengths: string[]
  improvements: string[]
  detailed_feedback: string
  total_questions?: number
  answered_questions?: number
  correct_answers_count?: string // e.g., "3/5"
  wrong_answers_count?: number
  not_answered_questions_count?: number // Added
}

interface ConversationItem {
  questionNumber: number
  question: string
  userAnswer: string
  skipped: boolean
}

interface ProbableAnswer {
  questionNumber: number
  probableAnswer: string
}

export default function ResultsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const interviewId = searchParams.get("interviewId")
  const forceType = searchParams.get("forceType")
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [probableAnswers, setProbableAnswers] = useState<ProbableAnswer[]>([])
  const [currentInterviewType, setCurrentInterviewType] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [backRedirected, setBackRedirected] = useState<boolean>(false)

  useEffect(() => {
    console.log("[v0] Results page mounted with interviewId:", interviewId)

    const fetchAnalysis = async () => {
      if (!interviewId) {
        console.log("[v0] No interview ID in search params")
        setError("No interview ID provided")
        setIsLoading(false)
        return
      }

      let analysisTriggered = false
      
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          console.log(`[v0] Fetching analysis for interview (attempt ${attempt + 1}):`, interviewId)
          const response = await fetch(`/api/interview/results?interviewId=${interviewId}`)
          console.log("[v0] Results API response status:", response.status)

          if (response.ok) {
            const data = await response.json()
            console.log("[v0] Analysis data received successfully")
            setAnalysis(data.analysis)
            setBatchId(data.batchId || null)
            setCurrentInterviewType(data.analysis.interviewType || "technical")
            console.log("[v0] currentInterviewType after fetch:", data.analysis.interviewType)
            console.log("[v0] Analysis data (including interviewType) received from API:", data)

            const formattedConversation = (data.responses || []).map((r: any) => ({
              questionNumber: r.question_number,
              question: r.question,
              userAnswer: r.answer || "[No response provided]",
              skipped: r.skipped || false,
            }))
            setConversation(formattedConversation)

            try {
              console.log("[v0] Fetching probable answers for interview:", interviewId)
              const conversationResponse = await fetch(`/api/interview/conversation?interviewId=${interviewId}`)
              if (conversationResponse.ok) {
                const conversationData = await conversationResponse.json()
                setProbableAnswers(conversationData.probableAnswers || [])
              }
            } catch (err) {
              console.error("[v0] Error fetching probable answers:", err)
            }

            setIsLoading(false)
            console.log("[v0] Results page ready to display")
            return
          } else if (response.status === 404) {
            // Fetch interview type
            const interviewTypeRes = await fetch(`/api/interview/type?interviewId=${interviewId}`);
            let interviewType = "technical"; // Default to technical
            if (interviewTypeRes.ok) {
              const typeData = await interviewTypeRes.json();
              interviewType = typeData.interviewType || "technical";
            }
            // Trigger analysis generation only once
            if (!analysisTriggered) {
              analysisTriggered = true
              console.log("[v0] Analysis not found, generating via server action...")
              try {
                const result = await generateAnalysis(interviewId, interviewType, 0)
                
                if (result.success) {
                  console.log("[v0] Analysis generation completed successfully")
                  // Continue to next iteration to fetch the generated analysis
                } else {
                  console.error("[v0] Analysis generation failed:", result.error)
                }
              } catch (actionError) {
                console.error("[v0] Server action error:", actionError)
              }
            }
            
            console.log("[v0] Waiting for analysis to be ready...")
            await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 2000 : 3000))
          } else {
            throw new Error("Failed to fetch analysis")
          }
        } catch (err) {
          console.error("[v0] Error in fetch attempt", attempt + 1 + ":", err)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }

      console.error("[v0] Failed to fetch analysis after all attempts")
      setError("Unable to load your interview results. The analysis may still be processing. Please try refreshing the page in a moment.")
      setIsLoading(false)
    }

    fetchAnalysis()
  }, [interviewId])

  // Redirect user to batches immediately when BACK is pressed from Results.
  // Also rewrite the previous history entry (interview URL) to /dashboard so that
  // pressing Back again goes to the dashboard.
  useEffect(() => {
    if (!analysis) return

    // Stop any active TTS/voice when results are ready
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        console.log('[v0] Results page: cancelling speech synthesis')
        window.speechSynthesis.cancel()
      }

      // Notify in-page voice agents to stop
      try {
        window.dispatchEvent(new CustomEvent('app:stop-voice-agent'))
      } catch (evErr) {
        console.warn('[v0] Results page: failed to dispatch stop event', evErr)
      }
    } catch (err) {
      console.warn('[v0] Error stopping voice/TTS on results load:', err)
    }

    const onPopState = (ev: PopStateEvent) => {
      if (backRedirected) return
      console.log('[v0] Results page: popstate detected — redirecting to My Institute and rewriting previous entry to /dashboard')

      try {
        // Replace the current history entry (which will be the interview URL after the back) with /dashboard
        // Add a small state flag `exitOnNextBack` so the dashboard can detect and navigate back out of the site
        history.replaceState({ exitOnNextBack: true }, '', '/dashboard')
      } catch (err) {
        console.warn('[v0] Failed to replace history state while redirecting back:', err)
      }

      const dest = '/my-institute'
      setBackRedirected(true)
      router.push(dest)
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [analysis, batchId, backRedirected])

  const isSkillOnly = currentInterviewType && (currentInterviewType.startsWith('dsa') || currentInterviewType.startsWith('aptitude') || currentInterviewType === 'problem_solving' || currentInterviewType === 'problem-solving')

  // Detect aptitude-quantitative even if the interview_type in the DB was not recorded as the subtype.
  // Fallback heuristics: if the analysis includes a logical_reasoning_score, treat as aptitude-quantitative
  const isAptitudeQuant = (forceType === 'aptitude-quantitative') || (analysis && (analysis.interviewType === 'aptitude-quantitative' || typeof (analysis as any).logical_reasoning_score !== 'undefined')) || currentInterviewType === 'aptitude-quantitative'

  return (
    <main className="min-h-screen bg-white">
      <DashboardNavbar />

      {/* Main Content */}
      <div className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => (batchId ? router.push(`/my-batches/${batchId}`) : router.push("/dashboard"))}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {batchId ? "Back to Batch" : "Back to Dashboard"}
          </button>
        </div>

        {/* Page Title Section */}
        <div className="mb-12 animate-fade-in">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-2">Your Interview Performance</h1>
          <p className="text-lg text-gray-600">Here's how you performed in your last mock interview.</p>

          {process.env.NODE_ENV === 'development' && currentInterviewType && (
            <div className="mt-3">
              <p className="text-sm text-gray-500">Debug: interviewType = {currentInterviewType}</p>
              {analysis && (
                <p className="text-xs text-gray-400">Debug: analysis.interviewType = {analysis.interviewType} • logical_reasoning_score = {(analysis as any).logical_reasoning_score ? 'present' : 'absent'}</p>
              )}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-xl font-semibold text-gray-900 mb-2">Preparing your performance report...</p>
              <p className="text-gray-600">This may take a few moments</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-6 bg-red-50 border-2 border-red-200 rounded-lg">
            <h3 className="text-lg font-semibold text-red-900 mb-2">Error Loading Results</h3>
            <p className="text-red-700">{error}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        ) : analysis ? (
          <>
            <div className="mb-8 p-6 bg-green-50 border-2 border-green-200 rounded-lg animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white text-2xl">
                  ✓
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-green-900">Interview Complete!</h3>
                  <p className="text-green-700">Your performance has been analyzed. Review your results below.</p>
                </div>
              </div>
            </div>

            {isSkillOnly ? (
              isAptitudeQuant ? (
                <AptitudeQuantitativeResultsUI analysis={analysis} interviewType={currentInterviewType || 'aptitude-quantitative'} />
              ) : (
                <DSAAptitudeResultsUI analysis={analysis} interviewType={currentInterviewType || 'technical'} />
              )
            ) : (
              <>

                <ResultsOverview analysis={analysis} interviewType={currentInterviewType} />

                <PerformanceMetrics
                  overall_score={analysis.overall_score}
                  communication_score={analysis.communication_score}
                  technical_score={analysis.technical_score}
                  problem_solving_score={analysis.problem_solving_score}
                  confidence_score={analysis.confidence_score}
                  eye_contact_score={analysis.eye_contact_score}
                  smile_score={analysis.smile_score}
                  stillness_score={analysis.stillness_score}
                  face_confidence_score={analysis.face_confidence_score}
                  interviewType={currentInterviewType}
                />
              </>
            )}

            {/* Interview Conversation Component */}
            <InterviewConversation
              conversation={conversation}
              probableAnswers={probableAnswers}
              totalQuestions={analysis.total_questions}
              answeredQuestions={analysis.answered_questions}
            />

            {/* AI Feedback Section */}
            <AIFeedback analysis={analysis} />

            {/* Detailed Insights Section */}
            {!isSkillOnly && (
                <DetailedInsights analysis={analysis} interviewType={currentInterviewType || 'technical'} />
            )}

            <div className="mt-12 flex gap-4 justify-center">
              <button
                onClick={() => router.push("/dashboard")}
                className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          </>
        ) : null}
      </div>
    </main>
  )
}
