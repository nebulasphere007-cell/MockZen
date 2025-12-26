import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import DashboardNavbar from "@/components/dashboard-navbar"
import InterviewCards from "@/components/interview-cards"
import FeaturedCourses from "@/components/featured-courses"
import { DashboardStats } from "@/components/dashboard-stats"
import { ScheduledInterviewsSection } from "@/components/scheduled-interviews-section"
import { Card } from "@/components/ui/card"
import Link from "next/link"

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth")
  }

  const { data: userProfile, error } = await supabase
    .from("users")
    .select("preferences, user_type")
    .eq("id", user.id)
    .maybeSingle()

  // If user doesn't exist in the database, create their profile
  if (!userProfile) {
    const { error: insertError } = await supabase.from("users").insert({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name || user.email?.split("@")[0],
      created_at: new Date().toISOString(),
      preferences: { onboarding_completed: false },
    })

    if (!insertError) {
      // Redirect to onboarding for new users
      redirect("/onboarding")
    }
  }

  // Check if onboarding is completed
  const preferences = userProfile?.preferences as any
  const userType = userProfile?.user_type as string;

  const userName = user.user_metadata?.name || user.email?.split("@")[0] || "User"

  // Bypass onboarding for institution users
  if (userType === "institution") {
    return (
      <main className="min-h-screen bg-white">
        <DashboardNavbar />
        <div className="pt-20 md:pt-24 pb-8 md:pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-2">Welcome back, {userName}</h1>
          <p className="text-base md:text-lg text-gray-600">You are logged in as an institution user.</p>
          <p className="text-base md:text-lg text-gray-600"><Link href="/institution-dashboard">Go to Institution Dashboard</Link></p>
        </div>
      </main>
    )
  }

  if (!preferences?.onboarding_completed) {
    redirect("/onboarding")
  }

  return (
    <main className="min-h-screen bg-white">
      <DashboardNavbar />

      {/* Main Content */}
      <div className="pt-20 md:pt-24 pb-8 md:pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {/* Greeting Section */}
        <div className="mb-6 md:mb-12 animate-fade-in">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-2">Welcome back, {userName}</h1>
          <p className="text-base md:text-lg text-gray-600">
            Choose your interview type to begin or review your progress.
          </p>
        </div>

        <DashboardStats />

        {/* Scheduled Interviews Section */}
        <ScheduledInterviewsSection />

        {/* Featured Courses */}
        <FeaturedCourses />

        {/* Quick Actions */}
        <div className="mb-6 md:mb-12 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <Link href="/history">
            <Card className="p-4 md:p-6 border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <p className="text-base md:text-lg font-semibold text-gray-900 mb-1 md:mb-2">📋 View History</p>
              <p className="text-xs md:text-sm text-gray-600">Review all your past interviews</p>
            </Card>
          </Link>
          <Link href="/performance">
            <Card className="p-4 md:p-6 border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <p className="text-base md:text-lg font-semibold text-gray-900 mb-1 md:mb-2">📊 Performance</p>
              <p className="text-xs md:text-sm text-gray-600">Track your progress and metrics</p>
            </Card>
          </Link>
          <Link href="/leaderboard">
            <Card className="p-4 md:p-6 border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <p className="text-base md:text-lg font-semibold text-gray-900 mb-1 md:mb-2">🏆 Leaderboard</p>
              <p className="text-xs md:text-sm text-gray-600">Compare your performance</p>
            </Card>
          </Link>
          <Link href="/my-institute">
            <Card className="p-4 md:p-6 border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
              <p className="text-base md:text-lg font-semibold text-gray-900 mb-1 md:mb-2">🏫 My Institute</p>
              <p className="text-xs md:text-sm text-gray-600">View your joined institute</p>
            </Card>
          </Link>
        </div>

        {/* Interview Cards */}
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 md:mb-6">Start New Interview</h2>
          <InterviewCards isAuthenticated={true} />
        </div>
      </div>
    </main>
  )
}
