"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export default function ManageCourseLessons() {
  const router = useRouter()
  const params = useParams() as any
  const batchId = params.id
  const courseId = params.courseId

  const [loading, setLoading] = useState(true)
  const [lessons, setLessons] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState("")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [order, setOrder] = useState<number>(1)

  useEffect(() => {
    fetchLessons()
  }, [batchId, courseId])

  const fetchLessons = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/institution/batches/${batchId}/courses/${courseId}/lessons`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch lessons')
      setLessons(data.lessons || [])
    } catch (err: any) {
      setError(err.message || 'Failed to fetch lessons')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    setError(null)
    try {
      if (!slug || !title || !content) {
        setError('Please fill all fields')
        return
      }
      const res = await fetch(`/api/institution/batches/${batchId}/courses/${courseId}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonSlug: slug, title, content, order })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create lesson')
      setSlug('')
      setTitle('')
      setContent('')
      setOrder(1)
      fetchLessons()
    } catch (err: any) {
      setError(err.message || 'Failed to create lesson')
    }
  }

  const handleDelete = async (lessonSlug: string) => {
    if (!confirm('Delete this lesson?')) return
    try {
      const res = await fetch(`/api/institution/batches/${batchId}/courses/${courseId}/lessons`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonSlug })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete lesson')
      fetchLessons()
    } catch (err: any) {
      setError(err.message || 'Failed to delete lesson')
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="pt-20 px-4 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Manage Lessons</h1>
            <p className="text-gray-600 mt-1">Course: <strong>{courseId}</strong></p>
          </div>
          <div>
            <Button variant="ghost" onClick={() => router.push(`/institution-dashboard/batches/${batchId}`)}>Back to Batch</Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Create Lesson</CardTitle>
            <CardDescription>Admin only — add lessons for this course</CardDescription>
          </CardHeader>
          <CardContent>
            {error && <div className="mb-4 text-red-600">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input placeholder="lesson-slug" value={slug} onChange={(e: any) => setSlug(e.target.value)} />
              <Input placeholder="Title" value={title} onChange={(e: any) => setTitle(e.target.value)} />
              <Input placeholder="Order" type="number" value={order} onChange={(e: any) => setOrder(Number(e.target.value))} />
            </div>
            <div className="mt-3">
              <Textarea placeholder="Content (markdown or plain text)" value={content} onChange={(e: any) => setContent(e.target.value)} />
            </div>
            <div className="mt-3">
              <Button onClick={handleCreate} className="bg-blue-600">Create Lesson</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lessons</CardTitle>
            <CardDescription>Existing lessons for this course</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-gray-500">Loading...</div>
            ) : lessons.length === 0 ? (
              <div className="text-gray-500">No lessons yet</div>
            ) : (
              <div className="space-y-3">
                {lessons.map((l: any) => (
                  <div key={l.lesson_slug} className="p-3 border rounded flex items-center justify-between">
                    <div>
                      <div className="font-medium">{l.title}</div>
                      <div className="text-sm text-gray-500">Slug: {l.lesson_slug}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(l.lesson_slug)}>Copy Slug</Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(l.lesson_slug)} className="text-red-600">Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}