"use client"

import InterviewNavbar from "@/components/interview-navbar"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import "../interview-mobile-landscape.css"

export default function CustomInterviewPage() {
  return (
    <div className="min-h-screen bg-white interview-mobile-landscape">
      <InterviewNavbar />

      <div className="pt-16 md:pt-20 pb-4 md:pb-8 px-3 md:px-4 sm:px-6 lg:px-8 interview-mobile-optimized">
        <div className="max-w-3xl mx-auto">
          <Card className="p-6 md:p-10 text-center space-y-4 md:space-y-6">
            <div className="text-sm font-semibold text-blue-600 uppercase tracking-wide">Coming Soon</div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Custom Scenario Interviews</h1>
            <p className="text-sm md:text-base text-gray-600 leading-relaxed">
              We’re building a powerful custom scenario interview mode so you can tailor interviews to your exact
              needs. Stay tuned — it’s on the way!
            </p>
            <div className="flex justify-center">
              <Button onClick={() => (window.location.href = "/dashboard")}>Back to Dashboard</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
