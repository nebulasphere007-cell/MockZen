"use client";

import { Suspense } from "react";
import InterviewRoom from "@/components/interview-room";
import { useParams } from "next/navigation";

export default function InterviewPage() {
  const params = useParams();
  const interviewType = params.type as string;

  return (
    <Suspense fallback={<div>Loading Interview...</div>}>
      <InterviewRoom interviewType={interviewType} />
    </Suspense>
  );
}
