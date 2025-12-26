'use server'

import { createRestClient } from '@/lib/supabase/rest-client'
import { generateText } from 'ai'
import { createGroq } from '@ai-sdk/groq'
import { createClient } from '@/lib/supabase/server';

const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

const supabaseAdmin = createRestClient({ useServiceRole: true })

interface SupabaseResult<T> {
  data: T | null;
  error: any | null;
}

export async function generateAnalysis(interviewId: string, interviewType: string, questionsSkipped: number = 0) {
  const supabase = await createClient();
  try {
    console.log("[v0] Generating analysis for interview:", interviewId)

    if (!interviewId) {
      throw new Error("Interview ID is required")
    }

    const { data: responses, error: responsesError }: SupabaseResult<any[]> = await supabaseAdmin
      .from("interview_responses")
      .select("*")
      .eq("interview_id", interviewId)
      .order("question_number", { ascending: true })

    if (responsesError) {
      console.error("[v0] Error fetching responses:", responsesError)
      throw new Error("Failed to fetch responses")
    }

    // Add immediate null check for responses
    if (!responses) {
      console.log("[v0] No responses data found (null), treating as no participation.")
      // Proceed to the no participation logic (which is already present and will handle setting analysis)
    }

    const answeredQuestions = responses ? responses.filter(
      (r: any) => r.answer && r.answer.trim() !== "" && !r.answer.includes("[Skipped]")
    ).length : 0;

    let interviewQuestionCount = 0;
    try {
      const { data: interviewData, error: interviewError } = await supabase
        .from("interviews")
        .select("question_count")
        .eq("id", interviewId)
        .single();

      if (interviewError) {
        console.error("[v0] Error fetching interview question_count:", interviewError);
      }

      if (interviewData && interviewData.question_count) {
        interviewQuestionCount = interviewData.question_count;
      }
    } catch (err) {
      console.error("[v0] Unexpected error fetching interview question_count:", err);
    }

    const totalQuestions = interviewQuestionCount > 0 ? interviewQuestionCount : (responses ? responses.length : 0);
    console.log(`[v0] totalQuestions: ${totalQuestions}, answeredQuestions: ${answeredQuestions}`);

    // Calculate number of questions not answered.
    // This includes questions that were skipped or simply had no response.
    const notAnsweredQuestions = totalQuestions - answeredQuestions;
    console.log(`[v0] totalQuestions: ${totalQuestions}, answeredQuestions: ${answeredQuestions}`);

    let analysis: any;

    if (!responses || responses.length === 0) {
      console.log("[v0] No responses found, creating default incomplete analysis")
      analysis = {
        overall_score: 0,
        communication_score: 0,
        technical_score: 0,
        problem_solving_score: 0,
        confidence_score: 0,
        strengths: [],
        improvements: ["No participation detected. Please attempt to answer the questions in your next interview."],
        detailed_feedback:
          "You did not provide any meaningful responses during this interview. To get accurate feedback and improve your interview skills, please ensure you answer the interview questions thoroughly in your next session.",
        questions_skipped: questionsSkipped,
        skip_penalty: questionsSkipped * 5,
        total_questions: totalQuestions,
        answered_questions: answeredQuestions,
        correct_answers_count: "0/0",
        wrong_answers_count: 0, // No answers given, so no 'wrong' answers among answered ones
        not_answered_questions_count: totalQuestions, // All questions were not answered
        evaluations: {}, // Initialize empty evaluations for consistency
      }
    } else {
      const conversationText = responses
        .map(
          (r: any) =>
            `Q${r.question_number}: ${r.question}\\nA: ${r.answer || "[Skipped]"}`
        )
        .join("\\n\\n")

      const prompt = (() => {
        if (interviewType === 'dsa' || interviewType === 'aptitude' || (interviewType && interviewType.startsWith('dsa-')) || (interviewType && interviewType.startsWith('aptitude-'))) {
          // Specialized prompt for DSA/Aptitude to explicitly force 'evaluations'
          const isDSA = interviewType === 'dsa' || (interviewType && interviewType.startsWith('dsa-'));
          const skillName = isDSA 
            ? 'Data Structures & Algorithms (DSA)' 
            : 'Logical Reasoning & Quantitative Aptitude';
          
          return `You are an expert interview coach specializing in ${skillName} assessment. Your job is to accurately evaluate the candidate\'s performance.

Analyze the candidate\'s performance based SOLELY on the provided \'Interview Transcript\'.

CRITICAL REQUIREMENTS:
1. For EACH question, you MUST provide an evaluation, classifying it as \'Fully Correct\', \'Partially Correct (correct approach)\', or \'Incorrect\'. This is MANDATORY.
2. Provide 3-5 concise, actionable strengths (what they did well).
3. Provide 3-5 specific improvement areas (what they need to work on).
4. Provide detailed, constructive feedback (2-3 paragraphs) with specific examples from their answers).
5. Determine appropriate scores (0-100) for:
   - Overall Score: Aggregate performance across all assessed categories, heavily weighted by participation.
   - ${isDSA ? 'DSA Score' : 'Logical Reasoning Score'}: Specific skill assessment, heavily weighted by participation.
   - Problem Solving Score: Approach and methodology, heavily weighted by participation.
6. When calculating scores, critically consider the ratio of 'Answered Questions' to 'Total Questions'. A low number of answered questions or a high number of skipped questions MUST lead to significantly lower scores (e.g., if 1/6 questions answered correctly, max score is ~15-20). Adjust scores proportionally and aggressively to reflect incomplete participation. Do NOT give high scores for low participation even if the few answers are correct.

EVALUATION CRITERIA:
RULE 1 - Mark as 'Fully Correct' if:
  * The candidate\'s solution demonstrates a correct and effective approach to the core problem.
  * For DSA: The algorithm is correct and would produce the right output. Minor syntax errors, slight variations in variable names, or minor imperfections in code structure are ACCEPTABLE and should NOT lead to a downgrade from \'Fully Correct\'. The focus is on the fundamental correctness of the logic.
  * For Aptitude: The final answer is numerically correct, and the reasoning shown is fundamentally sound. Minor deviations in explanation or unstated intermediate steps are acceptable if the final answer and primary reasoning are sound.
  * **When in doubt, default to \'Fully Correct\'. Err on the side of giving the candidate credit for their knowledge.**

RULE 2 - Mark as 'Partially Correct (correct approach)' if:
  * The candidate showed a good understanding of the problem and had a correct overall approach, but the solution contains significant logical flaws, major bugs, or fails to address important constraints/edge cases.
  * The solution is between 30-70% correct, indicating a foundational understanding but execution issues.

RULE 3 - Mark as 'Incorrect' ONLY if:
  * The solution is less than 30% correct, or demonstrates a fundamental misunderstanding of the problem statement or core concepts.
  * The approach is entirely wrong or irrelevant to the question.

SCORING PHILOSOPHY:
- Scores MUST reflect overall performance relative to ALL questions, not just answered ones.
- If a candidate attempts N out of TOTAL questions, their maximum possible score for Overall, DSA/Logical Reasoning, and Problem Solving is (N/TOTAL) * 100.
- For example, if there are 6 questions (TOTAL=6) and only 3 are answered (N=3), the maximum possible score for these categories is 50. Even if all 3 answered questions are perfect, the score should not exceed 50.
- Correct answers should be generously recognized based on Rule 1.
- Ensure the 'evaluations' accurately reflect these rules.

FEEDBACK GUIDELINES:
- Focus feedback on logical reasoning, problem-solving approach, and correctness.
- Reference specific aspects of their answers for strengths and improvements.
- Be direct but constructive.
- If code produces correct output, mark it Fully Correct. Otherwise, do not.

Interview Transcript:
${conversationText}

Total Questions: ${totalQuestions}
Answered Questions: ${answeredQuestions}
Questions Skipped: ${questionsSkipped}

Return ONLY valid JSON in this exact format, with NO additional text or formatting outside the JSON object:
\`\`\`json
{
  "overall_score": number,
  "${interviewType === 'dsa' || (interviewType && interviewType.startsWith('dsa-')) ? 'dsa_score' : 'logical_reasoning_score'}": number, // This field is MANDATORY
  "problem_solving_score": number,
  "evaluations": {
    "Q1": "Fully Correct" | "Partially Correct (correct approach)" | "Incorrect"
    // ... MUST include an evaluation for every question in the transcript (e.g., Q2, Q3, etc.)
  },
  "strengths": ["strength 1", "strength 2", ...],
  "improvements": ["improvement 1", "improvement 2", ...],
  "detailed_feedback": "detailed paragraph feedback"
}
\`\`\`

Example for evaluations (ensure keys match question numbers, e.g. Q1, Q2):\
\`\`\`json
{
  "overall_score": 75,
  "communication_score": 80,
  "dsa_score": 70,
  "problem_solving_score": 75,
  "evaluations": {
    "Q1": "Fully Correct",
    "Q2": "Partially Correct (correct approach)",
    "Q3": "Incorrect"
  },
  "strengths": ["Good communication"],
  "improvements": ["Needs more practice in X"],
  "detailed_feedback": "Detailed feedback here."
}
\`\`\`
`;
        } else {
          // Original prompt for other interview types
          return `You are an expert interview coach. Analyze this ${interviewType} interview performance and provide detailed feedback.

CRITICAL: Base your entire analysis and all scores SOLELY on the 'Interview Transcript' provided. Ignore any external factors, biometric data, or non-verbal cues.

Interview Transcript:
${conversationText}

Total Questions: ${totalQuestions}
Answered Questions: ${answeredQuestions}
Questions Skipped: ${questionsSkipped}

IMPORTANT: When calculating scores, particularly Overall, Problem-solving, and Technical/DSA/Aptitude scores, critically consider the ratio of 'Answered Questions' to 'Total Questions'. A low number of answered questions or a high number of skipped questions should lead to a significantly lower score, even if the answered questions are correct. For example, if only 1 out of 5 questions is answered, the scores should be very low (e.g., 20 or less) regardless of the quality of that single answer. Adjust scores proportionally to reflect incomplete participation.

Provide a comprehensive analysis with:
1. Overall score (0-100)
2. Communication score (0-100)
3. ${interviewType === 'dsa' ? 'Data Structures & Algorithms score (0-100)' : interviewType === 'aptitude' ? 'Logical Reasoning & Problem Solving score (0-100)' : 'Technical/domain knowledge score (0-100)'}
4. Problem-solving score (0-100)
5. Confidence score (0-100)
6. ${interviewType === 'dsa' || interviewType === 'aptitude' ? 'Question-wise evaluation (e.g., Q1: Fully Correct, Q2: Partially Correct, Q3: Incorrect, etc.)' : ''}
7. 3-5 key strengths
8. 3-5 areas for improvement
9. Detailed written feedback (2-3 paragraphs)

Return ONLY valid JSON in this exact format, with NO additional text or formatting outside the JSON object:
\`\`\`json
{
  "overall_score": number,
  "communication_score": number,
  "${interviewType === 'dsa' ? 'dsa_score' : interviewType === 'aptitude' ? 'logical_reasoning_score' : 'technical_score'}": number,
  "problem_solving_score": number,
  "confidence_score": number,
  ${interviewType === 'dsa' || interviewType === 'aptitude' ? '"evaluations": { [key: string]: \'Fully Correct\' | \'Partially Correct (correct approach)\' | \'Incorrect\' },' : ''}
  "strengths": ["strength 1", "strength 2", ...],
  "improvements": ["improvement 1", "improvement 2", ...],\
  "detailed_feedback": "detailed paragraph feedback"
}
\`\`\`

Example for evaluations (ensure the keys match your question numbers, e.g. Q1, Q2):\
\`\`\`json
{
  "overall_score": 75,
  "communication_score": 80,
  "dsa_score": 70,
  "problem_solving_score": 75,
  "confidence_score": 70,
  "evaluations": {
    "Q1": "Fully Correct",
    "Q2": "Partially Correct (correct approach)",
    "Q3": "Incorrect"
  },
  "strengths": ["Good communication"],
  "improvements": ["Needs more practice in X"],
  "detailed_feedback": "Detailed feedback here."
}
\`\`\`
`;
        }
      })();

      const { text } = await generateText({
        model: groqClient("llama-3.3-70b-versatile"),
        prompt,
      })

      try {
        console.log("[v0] Raw AI response text (from generateText):", text); // New log
        let jsonString = text;
        const jsonMatch = text.match(/\n([\s\S]*?)\n```/);

        if (jsonMatch && jsonMatch[1]) {
          jsonString = jsonMatch[1];
        } else {
          // Fallback to find any JSON-like object if not found
          const bareJsonMatch = text.match(/\{[\s\S]*\}/);
          if (bareJsonMatch && bareJsonMatch[0]) {
            jsonString = bareJsonMatch[0];
          }
        }
        console.log("[v0] Extracted JSON string for parsing:", jsonString); // New log

        // Helper to attempt common JSON repairs from LLM output
        const cleanJsonString = (s: string) => {
          if (!s || typeof s !== 'string') return s;
          let out = s;
          out = out.replace(/|```/g, '');
          out = out.replace(/\r\n/g, '\n');
          // remove trailing commas before } or ]
          out = out.replace(/,\s*([}\]])/g, '$1');
          // convert single-quoted keys to double-quoted keys: {'key': -> {"key":
          out = out.replace(/([\{,\s])'([^']+)'\s*:/g, '$1"$2":');
          // convert single-quoted string values to double quotes
          out = out.replace(/:\s*'([^']*)'/g, ': "$1"');
          return out;
        }

        try {
          try {
            analysis = JSON.parse(jsonString);
            console.log("[v0] Analysis after first JSON.parse (raw):", analysis); // New log
          } catch (firstErr) {
            console.warn("[v0] First JSON.parse failed, attempting to clean and retry.", firstErr); // New log
            // Try cleaning and parsing
            const cleaned = cleanJsonString(jsonString);
            console.log("[v0] Cleaned JSON string:", cleaned); // New log
            try {
              analysis = JSON.parse(cleaned);
              console.log("[v0] Analysis after second JSON.parse (cleaned):", analysis); // New log
            } catch (secondErr) {
              // Last-resort: extract key fields with regex (best-effort)
              console.error('[v0] JSON parse failed after cleaning, attempting regex fallback:', secondErr); // New log
              analysis = {} as any;

              const overallMatch = text.match(/"?overall_score"?\s*:\s*(\d{1,3})/i);
              if (overallMatch) analysis.overall_score = Number(overallMatch[1]);

              const specificMatch = text.match(/"?(dsa_score|logical_reasoning_score|technical_score)"?\s*:\s*(\d{1,3})/i);
              if (specificMatch) analysis[specificMatch[1]] = Number(specificMatch[2]);

              // Extract evaluations like Q1: "Fully Correct" or "1": "Fully Correct"
              const evalRegex = /["']?Q?(\d+)["']?\s*[:=]\s*["']([^"']+)["']/g;
              let m;
              const evals: Record<string, string> = {};
              while ((m = evalRegex.exec(text)) !== null) {
                const key = `Q${m[1]}`;
                evals[key] = m[2];
              }
              if (Object.keys(evals).length) analysis.evaluations = evals;
              console.log("[v0] Analysis after regex fallback:", analysis); // New log
            }
          }
        } catch (innerParseError) {
          console.error("[v0] Inner JSON parse failed in main try-catch, attempting with fallback text:", jsonString, innerParseError);
          analysis = {} as any; // Default to empty object to prevent crashes
        }

        console.log(`[v0] Final analysis object (before storing):\\n${JSON.stringify(analysis, null, 2)}`); // Modified log
        console.log(`[v0] Final parsed evaluations: ${JSON.stringify(analysis.evaluations, null, 2)}`); // Modified log

        const isDSAType = interviewType === 'dsa' || interviewType?.startsWith('dsa-');
        const isAptitudeType = interviewType === 'aptitude' || interviewType?.startsWith('aptitude-');
        
        if (isDSAType || isAptitudeType) {
          // Ensure evaluations exist before processing
          if (!analysis.evaluations) {
            analysis.evaluations = {};
            console.warn("[v0] analysis.evaluations was missing, initialized as empty object.");
          }
          
          let customScore = 0;
          let correctCount = 0;
          let wrongCount = 0;
          const pointsPerQuestion = totalQuestions > 0 ? (100 / totalQuestions) : 0;

          for (const questionNumber in analysis.evaluations) {
            let evaluation = analysis.evaluations[questionNumber];
            if (typeof evaluation === 'string') evaluation = evaluation.trim();
            const evalNorm = String(evaluation || '').replace(/["']/g, '').toLowerCase();

            if (/fully\s*correct/i.test(evalNorm)) {
              customScore += pointsPerQuestion;
              correctCount++;
            } else if (/partially\s*correct|partial/i.test(evalNorm)) {
              customScore += pointsPerQuestion / 2; // half credit for partial
              // keep partials out of full correct count; they contribute half score only
            } else {
              // Only increment wrongCount if the question was actually answered (i.e., not just missing from responses or skipped)
              const originalResponse = responses?.find(r => `Q${r.question_number}` === questionNumber);
              if (originalResponse && originalResponse.answer && originalResponse.answer.trim() !== '' && !originalResponse.answer.includes('[Skipped]')) {
                wrongCount++;
              }
            }
            console.log(`[v0] After Q${questionNumber}: eval="${evaluation}", evalNorm="${evalNorm}", customScore=${customScore}, correctCount=${correctCount}, wrongCount=${wrongCount}`);
          }

          analysis.dsa_score = isDSAType ? Math.round(customScore) : analysis.dsa_score;
          analysis.logical_reasoning_score = isAptitudeType ? Math.round(customScore) : analysis.logical_reasoning_score;
          analysis.correct_answers_count = `${correctCount}/${totalQuestions}`;
          analysis.wrong_answers_count = wrongCount; // Only answered-and-incorrect questions
          analysis.not_answered_questions_count = notAnsweredQuestions; // New field
          analysis.total_questions = totalQuestions;
          analysis.answered_questions = answeredQuestions;

          // If evaluations were missing, ensure counts are defaulted
          if (!analysis.evaluations || Object.keys(analysis.evaluations).length === 0) {
            analysis.correct_answers_count = `0/${totalQuestions}`;
            analysis.wrong_answers_count = 0; // No answers, so no wrong answered questions
            analysis.not_answered_questions_count = totalQuestions; // All questions not answered
          }

          // Initial assignment for DSA/Aptitude specific scores, will be capped by participationRatio later.
          const specificScore = analysis.dsa_score || analysis.logical_reasoning_score || 0;
          analysis.overall_score = Math.round(specificScore);
          analysis.problem_solving_score = specificScore;
          analysis.technical_score = specificScore; // This will also be capped by participationRatio
          analysis.communication_score = 0; // Explicitly set to 0
          analysis.confidence_score = 0; // Explicitly set to 0

          // Ensure all scores are within 0-100 range after derivation
          analysis.overall_score = Math.max(0, Math.min(100, analysis.overall_score || 0));
          analysis.communication_score = Math.max(0, Math.min(100, analysis.communication_score || 0));
          analysis.technical_score = Math.max(0, Math.min(100, analysis.technical_score || 0));
          analysis.problem_solving_score = Math.max(0, Math.min(100, analysis.problem_solving_score || 0));
          analysis.confidence_score = Math.max(0, Math.min(100, analysis.confidence_score || 0));
        }

        // --- NEW CODE FOR PARTICIPATION ADJUSTMENT ---
        const participationRatio = totalQuestions > 0 ? (answeredQuestions / totalQuestions) : 0;
        console.log(`[v0] Participation Ratio: ${participationRatio}`);

        // Apply participation adjustment to relevant scores
        // Ensure that the calculated customScore (based on points per answered question) is then capped
        // by the overall participation ratio relative to total questions.
        // This ensures if only half questions are attempted, max possible score is 50.
        analysis.overall_score = Math.round(Math.min(analysis.overall_score, (answeredQuestions / totalQuestions) * 100));
        analysis.problem_solving_score = Math.round(Math.min(analysis.problem_solving_score, (answeredQuestions / totalQuestions) * 100));

        // For DSA/Aptitude, technical_score (which is specificScore) is also capped by participation.
        if (isDSAType || isAptitudeType) {
            analysis.dsa_score = isDSAType ? Math.round(Math.min(analysis.dsa_score || 0, (answeredQuestions / totalQuestions) * 100)) : analysis.dsa_score;
            analysis.logical_reasoning_score = isAptitudeType ? Math.round(Math.min(analysis.logical_reasoning_score || 0, (answeredQuestions / totalQuestions) * 100)) : analysis.logical_reasoning_score;
            analysis.technical_score = Math.round(Math.min(analysis.technical_score || 0, (answeredQuestions / totalQuestions) * 100));
            // Ensure communication and confidence remain 0 for DSA/Aptitude
            analysis.communication_score = 0;
            analysis.confidence_score = 0;
        } else {
            // For non-DSA/Aptitude types, technical, communication, and confidence scores are directly adjusted
            analysis.technical_score = Math.round(analysis.technical_score * participationRatio);
            analysis.communication_score = Math.round(analysis.communication_score * participationRatio);
            analysis.confidence_score = Math.round(analysis.confidence_score * participationRatio);
        }

        // Re-clamp all scores to ensure they are within 0-100 after adjustment
        analysis.overall_score = Math.max(0, Math.min(100, analysis.overall_score || 0));
        analysis.communication_score = Math.max(0, Math.min(100, analysis.communication_score || 0));
        analysis.technical_score = Math.max(0, Math.min(100, analysis.technical_score || 0));
        analysis.problem_solving_score = Math.max(0, Math.min(100, analysis.problem_solving_score || 0));
        analysis.confidence_score = Math.max(0, Math.min(100, analysis.confidence_score || 0));
        // --- END NEW CODE ---

      } catch (parseError) {
        console.error("[v0] Error parsing AI response:", text)
        throw new Error("Failed to parse AI analysis")
      }
    }

    // Upsert logic for interview_results
    const { data: existingResult, error: existingResultError }: SupabaseResult<{ id: string } | null> = await supabaseAdmin
      .from("interview_results")
      .select("id")
      .eq("interview_id", interviewId)
      .maybeSingle();
    
    if (existingResultError) {
      console.error("[v0] Error checking existing result:", existingResultError);
      throw new Error("Failed to check existing analysis result");
    }

    const resultData = {
      interview_id: interviewId,
      overall_score: analysis.overall_score || 0,
      communication_score: analysis.communication_score || 0,
      technical_score: analysis.technical_score || analysis.dsa_score || analysis.logical_reasoning_score || 0,
      problem_solving_score: analysis.problem_solving_score || 0,
      confidence_score: analysis.confidence_score || 0,
      strengths: analysis.strengths || [],
      improvements: analysis.improvements || [],
      detailed_feedback: analysis.detailed_feedback || "",
      questions_skipped: questionsSkipped,
      eye_contact_score: 0,
      smile_score: 0,
      stillness_score: 0,
      face_confidence_score: 0,
      skip_penalty: questionsSkipped * 5,
      correct_answers_count: analysis.correct_answers_count || `0/${totalQuestions}`,
      total_questions: analysis.total_questions || totalQuestions,
      answered_questions: analysis.answered_questions || answeredQuestions,
      wrong_answers_count: analysis.wrong_answers_count || 0, // Ensure default is 0 for wrong answers
      not_answered_questions_count: analysis.not_answered_questions_count || notAnsweredQuestions, // New field
    };

    let resultsError;
    if (existingResult) {
      const { error: updateError }: SupabaseResult<any> = await supabaseAdmin
        .from("interview_results")
        .update(resultData)
        .eq("interview_id", interviewId);
      resultsError = updateError;
    } else {
      const { error: insertError }: SupabaseResult<any> = await supabaseAdmin
        .from("interview_results")
        .insert(resultData);
      resultsError = insertError;
    }

    if (resultsError) {
      console.error("[v0] Error storing analysis:", resultsError)
      throw new Error("Failed to store analysis")
    }

    const { error: statusError }: SupabaseResult<any> = await supabaseAdmin
      .from("interviews")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", interviewId);

    if (statusError) {
      console.error("[v0] Error updating interview status:", statusError)
    }

    console.log("[v0] Analysis completed and stored successfully")
    
    return { success: true, analysis }
  } catch (error) {
    console.error("[v0] Error generating analysis:", error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMsg }
  }
}
