"use client"

import { useRouter } from "next/navigation"
import DashboardNavbar from "@/components/dashboard-navbar"
import { Card } from "@/components/ui/card"

import streams from "@/lib/courses"

export default function CoursesPage() {
  const router = useRouter()

  return (
    <main className="min-h-screen bg-white">
      <DashboardNavbar />

      <div className="pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12 animate-fade-in">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-2">Interview Courses</h1>
          <p className="text-lg text-gray-600">Choose your career path and specialize in your field</p>
        </div>

        {/* Streams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {streams.map((stream) => (
            <Card
              key={stream.id}
              className="p-6 border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => router.push(`/courses/${stream.id}`)}
            >
              <div
                className={`bg-gradient-to-br ${stream.color} p-4 rounded-lg mb-4 group-hover:scale-105 transition-transform`}
              >
                <span className="text-4xl">{stream.icon}</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{stream.title}</h3>
              <p className="text-sm text-gray-600 mb-4">{stream.description}</p>
              <p className="text-xs text-blue-600 font-medium">{stream.subcourses.length} courses</p>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
