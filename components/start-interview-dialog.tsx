"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Coins, Clock, BarChart3, CheckCircle2 } from "lucide-react"

interface StartInterviewDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  creditCost: number
  currentBalance: number
  duration: number
  difficulty: string
  interviewType: string
  questionCount?: number
}

export function StartInterviewDialog({
  isOpen,
  onClose,
  onConfirm,
  creditCost,
  currentBalance,
  duration,
  difficulty,
  interviewType,
  questionCount,
}: StartInterviewDialogProps) {
  const hasEnoughCredits = currentBalance >= creditCost
  const remainingBalance = currentBalance - creditCost

  // Calculate estimated questions based on duration
  const estimatedQuestions = questionCount || (
    duration <= 15 ? 6 :
    duration <= 30 ? 14 :
    duration <= 60 ? 25 :
    Math.ceil((duration / 60) * 25)
  )

  const formatInterviewType = (type: string) => {
    if (type.includes("-")) {
      const parts = type.split("-")
      return `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} - ${parts.slice(1).join(" ").charAt(0).toUpperCase() + parts.slice(1).join(" ").slice(1)}`
    }
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  const getDifficultyColor = (diff: string) => {
    switch (diff.toLowerCase()) {
      case "beginner": return "text-green-600 bg-green-50"
      case "intermediate": return "text-yellow-600 bg-yellow-50"
      case "pro": return "text-orange-600 bg-orange-50"
      case "advanced": return "text-red-600 bg-red-50"
      default: return "text-gray-600 bg-gray-50"
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-blue-600" />
            Confirm Interview Start
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-left mt-4">
              {/* Interview Details */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <h4 className="font-semibold text-gray-900 text-sm">Interview Details</h4>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600">Duration:</span>
                  </div>
                  <span className="font-medium text-gray-900">{duration} minutes</span>

                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600">Difficulty:</span>
                  </div>
                  <span className={`font-medium px-2 py-0.5 rounded text-xs ${getDifficultyColor(difficulty)}`}>
                    {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Type:</span>
                  </div>
                  <span className="font-medium text-gray-900 text-xs">
                    {formatInterviewType(interviewType)}
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Questions:</span>
                  </div>
                  <span className="font-medium text-gray-900">~{estimatedQuestions} questions</span>
                </div>
              </div>

              {/* Credit Information */}
              <div className={`rounded-lg p-4 border-2 ${hasEnoughCredits ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Coins className={`w-5 h-5 ${hasEnoughCredits ? 'text-blue-600' : 'text-red-600'}`} />
                    <span className={`font-semibold ${hasEnoughCredits ? 'text-blue-900' : 'text-red-900'}`}>
                      Credit Summary
                    </span>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Your Balance:</span>
                    <span className="font-medium text-gray-900">{currentBalance} credits</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Interview Cost:</span>
                    <span className={`font-bold ${hasEnoughCredits ? 'text-blue-600' : 'text-red-600'}`}>
                      -{creditCost} credits
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">After Interview:</span>
                      <span className={`font-bold ${hasEnoughCredits ? 'text-green-600' : 'text-red-600'}`}>
                        {hasEnoughCredits ? remainingBalance : 'Insufficient'} {hasEnoughCredits ? 'credits' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {!hasEnoughCredits && (
                <div className="bg-red-100 border border-red-300 rounded-lg p-3">
                  <p className="text-sm text-red-800 font-medium">
                    ⚠️ You don't have enough credits for this interview. Please purchase more credits or select a shorter duration.
                  </p>
                </div>
              )}

              {hasEnoughCredits && (
                <p className="text-xs text-gray-500 text-center">
                  Credits will be deducted immediately when you start the interview.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0 mt-4">
          <AlertDialogCancel className="mt-0">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!hasEnoughCredits}
            className={`${hasEnoughCredits 
              ? 'bg-blue-600 hover:bg-blue-700 text-white' 
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {hasEnoughCredits ? `Start Interview (-${creditCost} credits)` : 'Insufficient Credits'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

