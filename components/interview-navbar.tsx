"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { useState, useEffect } from "react"
import { ExitInterviewDialog } from "./exit-interview-dialog"

interface InterviewNavbarProps {
  isInterviewStarted?: boolean
  creditsUsed?: number
  questionsAnswered?: number
  totalQuestions?: number
  onExitConfirm?: () => void
}

export default function InterviewNavbar({
  isInterviewStarted = false,
  creditsUsed = 0,
  questionsAnswered = 0,
  totalQuestions = 0,
  onExitConfirm,
}: InterviewNavbarProps) {
  const router = useRouter()
  const [showExitDialog, setShowExitDialog] = useState(false)

  // Handle browser back button and page unload
  useEffect(() => {
    if (!isInterviewStarted) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = "You have an interview in progress. Are you sure you want to leave?"
      return e.returnValue
    }

    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault()
      // Push state back to prevent navigation
      window.history.pushState(null, "", window.location.href)
      setShowExitDialog(true)
    }

    // Add a history entry to intercept back button
    window.history.pushState(null, "", window.location.href)
    
    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("popstate", handlePopState)
    }
  }, [isInterviewStarted])

  const handleBackClick = () => {
    if (isInterviewStarted) {
      setShowExitDialog(true)
    } else {
      router.back()
    }
  }

  const handleExitConfirm = () => {
    setShowExitDialog(false)
    if (onExitConfirm) {
      onExitConfirm()
    } else {
      router.push("/dashboard")
    }
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-white border-b border-gray-100 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBackClick}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Link href="/dashboard" className="text-2xl font-bold text-gray-900">
              MockZen
            </Link>
            {isInterviewStarted && (
              <span className="ml-2 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                Interview in Progress
              </span>
            )}
          </div>
        </div>
      </nav>

      <ExitInterviewDialog
        isOpen={showExitDialog}
        onClose={() => setShowExitDialog(false)}
        onConfirm={handleExitConfirm}
        isInterviewStarted={isInterviewStarted}
        creditsUsed={creditsUsed}
        questionsAnswered={questionsAnswered}
        totalQuestions={totalQuestions}
      />
    </>
  )
}
