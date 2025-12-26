'use server'

import { Suspense } from 'react';
import { InterviewRoom } from '@/components/interview-room'

export default async function CourseInterviewPage({
  params,
}: {
  params: Promise<{ stream: string; subcourse: string }>
}) {
  const { stream, subcourse } = await params

  const interviewType = `${stream}-${subcourse}`
  const title = `${stream.charAt(0).toUpperCase() + stream.slice(1)} - ${subcourse.charAt(0).toUpperCase() + subcourse.slice(1)}`

  return (
    <Suspense fallback={<div>Loading Interview...</div>}>
      <InterviewRoom interviewType={interviewType} title={title} />
    </Suspense>
  )
}
