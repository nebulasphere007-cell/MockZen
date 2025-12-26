import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Get user's credit balance
    const { data: creditRow, error } = await supabase
      .from("user_credits")
      .select("balance")
      .eq("user_id", user.id)
      .maybeSingle()

    if (error) {
      console.error("Error fetching credits:", error)
      return NextResponse.json({ error: "Failed to fetch credits" }, { status: 500 })
    }

    const balance = creditRow?.balance ?? 0

    return NextResponse.json({ balance })
  } catch (error: any) {
    console.error("Error in credits route:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

