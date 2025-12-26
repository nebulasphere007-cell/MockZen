'use client'

import { useState, useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"; // Added
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Loader2, Send } from "lucide-react"
import { InterviewTimer } from "@/components/interview-timer"
import { getInterviewCost } from "@/utils/credits"; // Added

interface DSACodeInterviewerProps {
  interviewType: string
}

interface TranscriptMessage {
  type: "ai" | "user" | "code"
  content: string
  timestamp: Date
  questionNumber?: number
}

export default function DSACodeInterviewer({ interviewType }: DSACodeInterviewerProps) {
  const router = useRouter()
  const supabase = createClient()
  const { speak } = useTextToSpeech({ rate: 0.9 }); // Set speech rate here
  const isAptitude = interviewType.startsWith("aptitude")

  const [interviewId, setInterviewId] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState("")
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [totalQuestions, setTotalQuestions] = useState(5)
  const [userCode, setUserCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [showWelcome, setShowWelcome] = useState(true)
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([])
  const [questionHistory, setQuestionHistory] = useState<Array<{ question: string; userCode: string }>>([]); // Changed userCode to string
  const [error, setError] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [analysisData, setAnalysisData] = useState<any>(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null); // Added
  const pathname = usePathname(); // Added

  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [transcript])

  useEffect(() => {
    const fetchCredits = async () => {
      try {
        const res = await fetch("/api/user/credits")
        const data = await res.json()
        if (res.ok) {
          setBalance(data.balance ?? 0)
        }
      } catch (error) {
        console.error("Error fetching credits in DSACodeInterviewer:", error)
      }
    }
    fetchCredits();

    // Refresh credits every 30 seconds or on pathname change
    const interval = setInterval(fetchCredits, 30000)
    return () => clearInterval(interval)
  }, [pathname]); // Depend on pathname to re-fetch credits when URL changes

  // Client-side guard: when an interviewId or scheduledInterviewId is present in the URL,
  // check whether a result already exists (redirect to results) or if an in-progress interview exists
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)

      const urlInterviewId = params.get('interviewId')
      if (urlInterviewId) {
        ;(async () => {
          try {
            const res = await fetch(`/api/interview/results?interviewId=${urlInterviewId}`)
            if (res.ok) {
              router.push(`/results?interviewId=${urlInterviewId}`)
              return
            } else {
              setInterviewId(urlInterviewId)
            }
          } catch (err) {
            console.warn('[v0] Error checking DSA interview results for interviewId:', urlInterviewId, err)
          }
        })()
      }

      const schedId = params.get('scheduledInterviewId') || params.get('scheduleId')
      if (schedId) {
        ;(async () => {
          try {
            const res = await fetch(`/api/user/schedule-result?scheduleId=${schedId}`)
            if (res.ok) {
              const data = await res.json()
              if (data.scheduleStatus === 'completed' || data.interviewStatus === 'completed') {
                if (data.interviewId) {
                  router.push(`/results?interviewId=${data.interviewId}`)
                  return
                }
              }

              if (data.interviewId) {
                setInterviewId(data.interviewId)
              }
            }
          } catch (err) {
            console.warn('[v0] Error checking DSA schedule-result for scheduleId:', schedId, err)
          }
        })()
      }

      // Stop any lingering TTS if the user arrived at results
      const stopHandler = () => {
        try {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel()
          }
        } catch (err) {
          console.warn('[v0] DSA interviewer: failed to cancel TTS on stop event', err)
        }
      }

      window.addEventListener('app:stop-voice-agent', stopHandler as EventListener)
      return () => window.removeEventListener('app:stop-voice-agent', stopHandler as EventListener)
    }
  }, [])

  const startInterview = async (duration: number) => {
    if (!selectedDifficulty) {
      setError("Please select a difficulty level")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        router.push("/auth")
        return
      }

      const cost = getInterviewCost(duration);
      if (balance !== null && balance < cost) {
        setError(`Not enough credits. This interview costs ${cost} credits, but you only have ${balance}.`);
        setIsLoading(false);
        return;
      }

      const response = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewType,
          userId: user.id,
          userEmail: user.email,
          userName: user.user_metadata?.name || user.email?.split("@")[0],
          duration,
          difficulty: selectedDifficulty,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json();
        let errorMessage = errorData.error || "Failed to start interview";

        if (response.status === 402) {
          errorMessage = errorData.error || "Not enough credits to start this interview.";
        }

        throw new Error(errorMessage);
      }

      const data = await response.json()

      if (data.interview) {
        setInterviewId(data.interview.id)
        setTotalQuestions(data.interview.question_count || 5)
        setShowWelcome(false)

        await generateNextQuestion(data.interview.id, 1, [], user.id, "initial")
      }
    } catch (error) {
      console.error("Error starting interview:", error)
      setError(error instanceof Error ? error.message : "Failed to start interview")
    } finally {
      setIsLoading(false)
    }
  }

  const generateNextQuestion = async (
    interviewSessionId: string,
    questionNum: number,
    previousAnswers: Array<{ question: string; answer: string }>,
    userId: string,
    direction: "next" | "prev" | "initial" = "initial"
  ) => {
    setIsLoading(true)
    setError(null)

    // Check history first for both "next" and "prev" navigation
    if ((direction === "prev" || direction === "next") && questionHistory[questionNum - 1]) {
      const historicalEntry = questionHistory[questionNum - 1];
      setCurrentQuestion(historicalEntry.question);
      setUserCode(historicalEntry.userCode || "");
      setCurrentQuestionIndex(questionNum - 1);
      setTranscript((prev) => {
        // Filter out messages beyond the current question number when navigating
        return prev.filter(msg => (msg.questionNumber || 0) <= questionNum);
      });
      setIsLoading(false);
      return;
    }

    // If not in history or initial load, fetch new question
    try {
      const response = await fetch("/api/interview/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: interviewSessionId,
          interviewType,
          questionNumber: questionNum,
          previousAnswers,
          userId: userId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to generate question")
      }

      const data = await response.json()

      if (data.question) {
        setCurrentQuestion(data.question)
        // Only add to history if moving forward or initial load (and not already in history)
        if (direction !== "prev" && !questionHistory[questionNum - 1]) {
          setQuestionHistory((prev) => {
            const newHistory = [...prev];
            newHistory[questionNum - 1] = { question: data.question, userCode: "" };
            return newHistory;
          });
        }
        setUserCode(""); // Clear user code for new question
        setTranscript((prev) => [
          ...prev,
          {
            type: "ai",
            content: data.question,
            timestamp: new Date(),
            questionNumber: questionNum,
          },
        ])
      }
    } catch (error) {
      console.error("Error generating question:", error)
      setError(error instanceof Error ? error.message : "Failed to generate question")
    } finally {
      setIsLoading(false)
    }
  }

  const submitCode = async () => {
    if (!userCode.trim() || !interviewId) return

    setIsLoading(true)

    try {
      // Update history with current user code before submitting
      setQuestionHistory((prev) => {
        const newHistory = [...prev];
        if (newHistory[currentQuestionIndex]) {
          newHistory[currentQuestionIndex].userCode = userCode;
        }
        return newHistory;
      });

      setTranscript((prev) => [
        ...prev,
        {
          type: "code",
          content: userCode,
          timestamp: new Date(),
          questionNumber: currentQuestionIndex + 1,
        },
      ])

      const saveResponse = await fetch("/api/interview/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId,
          question: currentQuestion,
          answer: userCode,
          questionNumber: currentQuestionIndex + 1,
          skipped: false,
        }),
      })

      if (!saveResponse.ok) {
        throw new Error("Failed to save response")
      }

      if (!isAptitude) {
        // Request AI analysis of the code (DSA only)
        const analysisResponse = await fetch("/api/interview/analyze-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interviewId,
            code: userCode,
            problem: currentQuestion,
            interviewType,
          }),
        })

        if (analysisResponse.ok) {
          const analysisData = await analysisResponse.json()

          setTranscript((prev) => [
            ...prev,
            {
              type: "ai",
              content: analysisData.feedback,
              timestamp: new Date(),
              questionNumber: currentQuestionIndex + 1,
            },
          ])
        }
      }

      setUserCode("")

      if (currentQuestionIndex < totalQuestions - 1) {
        const nextQuestionIndex = currentQuestionIndex + 1
        setCurrentQuestionIndex(nextQuestionIndex)

        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          await generateNextQuestion(
            interviewId,
            nextQuestionIndex + 1,
            [{ question: currentQuestion, answer: userCode }],
            user.id,
            "next"
          )
        }
      } else {
        await completeInterview()
      }
    } catch (error) {
      console.error("Error submitting code:", error)
      setError(error instanceof Error ? error.message : "Failed to submit code")
    } finally {
      setIsLoading(false)
    }
  }

  const handleNextQuestion = async () => {
    if (currentQuestionIndex < totalQuestions - 1 && interviewId) {
      // Save current question and user code to history before moving next
      setQuestionHistory((prev) => {
        const newHistory = [...prev];
        if (newHistory[currentQuestionIndex]) {
          newHistory[currentQuestionIndex].userCode = userCode;
        }
        return newHistory;
      });

      const nextQuestionIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextQuestionIndex);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // generateNextQuestion will now check history first
        await generateNextQuestion(interviewId, nextQuestionIndex + 1, [], user.id, "next");
      }
    }
  };

  const handlePreviousQuestion = async () => {
    if (currentQuestionIndex > 0 && interviewId) {
      // Save current question and user code to history before moving previous
      setQuestionHistory((prev) => {
        const newHistory = [...prev];
        if (newHistory[currentQuestionIndex]) {
          newHistory[currentQuestionIndex].userCode = userCode;
        }
        return newHistory;
      });

      const prevQuestionIndex = currentQuestionIndex - 1;
      setCurrentQuestionIndex(prevQuestionIndex);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await generateNextQuestion(interviewId, prevQuestionIndex + 1, [], user.id, "prev");
      }
    }
  };

  const completeInterview = async () => {
    console.log("[v0] completeInterview: function started.");
    setIsLoading(true)

    try {
      console.log('[v0] completeInterview: interviewId=', interviewId, 'scheduleId=', (new URLSearchParams(window.location.search).get('scheduledInterviewId') || new URLSearchParams(window.location.search).get('scheduleId')))

      if (!interviewId) {
        console.error('[v0] completeInterview: missing interviewId, aborting analysis')
        setError('Analysis failed: interview session missing (no interviewId)')
        setIsLoading(false);
        return
      }

      // Ensure any speech synthesis is cancelled before analysis
      try {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel()
        }
      } catch (ttsErr) {
        console.warn('[v0] completeInterview: Failed to cancel TTS before analysis:', ttsErr)
      }

      console.log("[v0] completeInterview: About to call /api/interview/analyze...");
      const analysisResponse = await fetch("/api/interview/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId,
          interviewType,
          questionsSkipped: 0,
          scheduleId: (new URLSearchParams(window.location.search).get('scheduledInterviewId') || new URLSearchParams(window.location.search).get('scheduleId')) || undefined,
        }),
      })
      console.log("[v0] completeInterview: /api/interview/analyze response received. Status:", analysisResponse.status, "OK:", analysisResponse.ok);

      if (analysisResponse.ok) {
        const analysisData = await analysisResponse.json()
        console.log("[v0] completeInterview: Analysis data received successfully:", analysisData);
        setAnalysisData(analysisData.analysis)
        setShowResults(true)

        // Navigate to results page when done
        try {
          const resultId = interviewId
          if (resultId) {
            console.log("[v0] completeInterview: Navigating to results page:", `/results?interviewId=${resultId}`);
            window.location.href = `/results?interviewId=${resultId}`
          } else {
            console.warn("[v0] completeInterview: No resultId for navigation, staying on current page.");
          }
        } catch (err) {
          console.error('[v0] completeInterview: Failed to navigate to results from DSA interviewer:', err)
        }
      } else {
        console.error('[v0] completeInterview: API response NOT OK. Status:', analysisResponse.status);
        const err = await analysisResponse.json().catch(() => ({ error: analysisResponse.statusText }))
        console.error('[v0] completeInterview: DSA analyze API raw error object:', err) // Added for debugging
        const msg = err?.error || analysisResponse.statusText || 'Analysis failed'
        console.error('[v0] completeInterview: DSA analyze API error message:', msg)

        if (/scheduled_interview_id|column .*does not exist/i.test(msg)) {
          setError(
            `Error analyzing interview: ${msg}. This server is missing a DB migration (scripts/011_add_scheduled_interview_id_to_interviews.sql). Please apply the migration and restart the dev server.`,
          )
        } else {
          setError(`Error analyzing interview: ${msg}`)
        }
      }
    } catch (error) {
      console.error("[v0] completeInterview: Error in main catch block:", error)
      const msg = error instanceof Error ? error.message : String(error)
      if (/scheduled_interview_id|column .*does not exist/i.test(msg)) {
        setError(
          `Error analyzing interview: ${msg}. This server is missing a DB migration (scripts/011_add_scheduled_interview_id_to_interviews.sql). Please apply the migration and restart the dev server.`,
        )
      } else {
        setError(msg)
      }
    } finally {
      setIsLoading(false)
      console.log("[v0] completeInterview: function finished (finally block).");
    }
  }

  // Handler for when timer runs out
  const handleTimeUp = () => {
    console.log("[v0] handleTimeUp called. showResults:", showResults);
    if (!showResults) {
      completeInterview()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const { selectionStart, selectionEnd, value } = e.currentTarget;
    const indentation = '  '; // Use 2 spaces for indentation

    if (e.key === 'Tab') {
      e.preventDefault();

      const newValue =
        value.substring(0, selectionStart) +
        indentation +
        value.substring(selectionEnd);

      e.currentTarget.value = newValue;
      e.currentTarget.selectionStart = e.currentTarget.selectionEnd = selectionStart + indentation.length;
      setUserCode(newValue);
    } else if (e.key === 'Enter') {
      e.preventDefault();

      const currentLineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const currentLine = value.substring(currentLineStart, selectionStart);

      const match = currentLine.match(/^(\s*)/);
      const currentIndentation = match ? match[1] : '';

      let newIndentation = currentIndentation;

      if (currentLine.trimEnd().endsWith(':')) {
        newIndentation += indentation;
      }

      const newValue =
        value.substring(0, selectionStart) +
        '\n' +
        newIndentation +
        value.substring(selectionStart);

      e.currentTarget.value = newValue;
      e.currentTarget.selectionStart = e.currentTarget.selectionEnd = selectionStart + 1 + newIndentation.length;
      setUserCode(newValue);
    }
  };

  if (showWelcome) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="p-8 max-w-2xl w-full">
          <h2 className="text-2xl font-bold mb-4">{isAptitude ? "Aptitude Coding Interview" : "DSA Coding Interview"}</h2>
          <p className="text-gray-600 mb-6">
            The AI will present coding problems. Write your solution, and the AI will analyze your code logic and
            efficiency.
          </p>

          <div className="space-y-6 mb-6">
            <div>
              <p className="font-semibold mb-3">Select Difficulty Level:</p>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  onClick={() => setSelectedDifficulty("beginner")}
                  variant={selectedDifficulty === "beginner" ? "default" : "outline"}
                  className={`h-16 ${
                    selectedDifficulty === "beginner" ? "bg-green-600 hover:bg-green-700" : "hover:bg-green-50"
                  }`}
                >
                  <div className="text-center">
                    <div className="font-bold">Beginner</div>
                    <div className="text-xs opacity-80">Basic problems</div>
                  </div>
                </Button>
                <Button
                  onClick={() => setSelectedDifficulty("pro")}
                  variant={selectedDifficulty === "pro" ? "default" : "outline"}
                  className={`h-16 ${
                    selectedDifficulty === "pro" ? "bg-yellow-600 hover:bg-yellow-700" : "hover:bg-yellow-50"
                  }`}
                >
                  <div className="text-center">
                    <div className="font-bold">Pro</div>
                    <div className="text-xs opacity-80">Intermediate</div>
                  </div>
                </Button>
                <Button
                  onClick={() => setSelectedDifficulty("expert")}
                  variant={selectedDifficulty === "expert" ? "default" : "outline"}
                  className={`h-16 ${
                    selectedDifficulty === "expert" ? "bg-red-600 hover:bg-red-700" : "hover:bg-red-50"
                  }`}
                >
                  <div className="text-center">
                    <div className="font-bold">Expert</div>
                    <div className="text-xs opacity-80">Advanced problems</div>
                  </div>
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="font-semibold">Select Interview Duration:</p>
            <div className="grid grid-cols-3 gap-4">
              {[15, 30, 45].map((duration) => (
                <Button
                  key={duration}
                  onClick={() => {
                    setSelectedDuration(duration)
                    startInterview(duration)
                  }}
                  disabled={isLoading || !selectedDifficulty}
                  className="h-20"
                >
                  {duration} minutes
                </Button>
              ))}
            </div>
            {error && <p className="text-sm text-red-600 text-center">{error}</p>}
          </div>
        </Card>
      </div>
    )
  }

  if (showResults && analysisData) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="p-8">
          <h2 className="text-3xl font-bold mb-6">Interview Complete!</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-semibold mb-2">Overall Score</h3>
              <p className="text-4xl font-bold text-blue-600">{analysisData.overall_score}/10</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold mb-2">Feedback</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{analysisData.feedback}</p>
            </div>

            <Button onClick={() => router.push("/dashboard")} className="mt-6">
              Back to Dashboard
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-12rem)] flex gap-4">
      {/* Main Interview Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Card className="flex-1 p-6 flex flex-col">
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">
                Problem {currentQuestionIndex + 1} of {totalQuestions}
              </h3>
              <div className="flex items-center gap-3">
                {selectedDuration && <InterviewTimer durationMinutes={selectedDuration} onTimeUp={handleTimeUp} />}
                {isLoading && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <p className="text-gray-900 whitespace-pre-wrap">{currentQuestion || "Loading problem..."}</p>
            </div>
          </div>

          <div className="flex-1 flex flex-col">
            <label className="font-semibold mb-2">Your Solution:</label>
            <Textarea
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              onKeyDown={handleKeyDown} // Add this prop
              placeholder="Write your code here..."
              className="flex-1 font-mono text-sm"
              disabled={isLoading}
            />
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              onClick={handlePreviousQuestion}
              disabled={isLoading || currentQuestionIndex === 0}
              variant="outline"
              className="flex-1"
            >
              Previous Question
            </Button>
            <Button onClick={submitCode} disabled={isLoading || userCode.trim() === ''} className="flex-1">
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Submit Code
                </>
              )}
            </Button>
            <Button
              onClick={handleNextQuestion}
              disabled={isLoading || currentQuestionIndex === totalQuestions - 1}
              variant="outline"
              className="flex-1"
            >
              Next Question
            </Button>
            <Button variant="outline" onClick={completeInterview} disabled={isLoading || !interviewId}>
              End Interview
            </Button>
          </div>
        </Card>
      </div>

      {/* Transcript Sidebar */}
      <div className="w-96 flex flex-col flex-shrink-0">
        <Card className="h-full p-4 flex flex-col">
          <h3 className="font-semibold text-lg mb-4 flex-shrink-0">Conversation History</h3>

          <div className="flex-1 overflow-y-auto space-y-4 scroll-smooth">
            {transcript.map((message, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg ${
                  message.type === "ai"
                    ? "bg-blue-50 border border-blue-200"
                    : message.type === "code"
                      ? "bg-gray-50 border border-gray-200"
                      : "bg-green-50 border border-green-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">
                    {message.type === "ai" ? "AI" : message.type === "code" ? "Your Code" : "You"}
                  </span>
                  {message.questionNumber && (
                    <span className="text-xs text-gray-500">Problem {message.questionNumber}</span>
                  )}
                </div>
                <p className={`text-sm ${message.type === "code" ? "font-mono" : ""} whitespace-pre-wrap`}>
                  {message.content}
                </p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </Card>
      </div>
    </div>
  )
}
