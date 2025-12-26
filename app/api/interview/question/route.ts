import { generateText } from "ai"
import { createGroq } from "@ai-sdk/groq"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isRateLimited, rateLimitKeyFromRequest } from "@/lib/api/rate-limit"

const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
})

function generateQuestionHash(question: string): string {
  let hash = 0
  const str = question.toLowerCase().trim()
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16)
}

function isDuplicateQuestion(question: string, previousAnswers: any[]): boolean {
  const candidateHash = generateQuestionHash(question)
  const previousHashes = new Set(previousAnswers.map((qa: any) => generateQuestionHash(qa.question || "")))
  return previousHashes.has(candidateHash)
}

async function generateTextWithRetry(model: any, prompt: string, maxRetries = 5, initialDelayMs = 2000) {
  let lastError: any = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[v0] Groq API attempt ${attempt + 1}/${maxRetries}`)
      const result = await generateText({
        model,
        prompt,
        temperature: 0.8,
      })
      return result
    } catch (error) {
      lastError = error
      const delayMs = initialDelayMs * Math.pow(2, attempt)

      if (error instanceof Error) {
        console.error(`[v0] Groq API error (attempt ${attempt + 1}): ${error.message}`)

        // Don't retry on auth errors or validation errors
        if (error.message.includes("401") || error.message.includes("403") || error.message.includes("validation")) {
          throw error
        }
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw error
      }

      console.log(`[v0] Retrying in ${delayMs}ms (${(delayMs / 1000).toFixed(1)}s)...`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}

export async function POST(request: Request) {
  try {
    const { interviewId, interviewType, questionNumber, previousAnswers, userId, customScenario, questionCount } =
      await request.json()

    console.log("[v0] Generating question for interview:", interviewId)
    console.log("[v0] Interview type:", interviewType, "Question number:", questionNumber)

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error("[v0] Authentication error:", authError)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rateKey = rateLimitKeyFromRequest(request, user.id)
    if (isRateLimited(rateKey, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests, slow down." }, { status: 429 })
    }

    console.log("[v0] Authenticated user:", user.id)

    let courseName = ""
    let courseSubject = ""

    const isAptitudeType = interviewType?.startsWith("aptitude")

    if (isAptitudeType && (!interviewType?.includes("-") || interviewType === "aptitude")) {
      // Handle plain "aptitude" type without sub-course
      courseName = "aptitude"
      courseSubject = "general"
    } else if (interviewType && interviewType.includes("-")) {
      const parts = interviewType.split("-")
      courseName = parts[0] // e.g., "dsa", "frontend", "backend"
      courseSubject = parts.slice(1).join("-") // e.g., "arrays", "react", "node"
      console.log("[v0] Course detected:", courseName, "/", courseSubject)
    }

    let difficulty = "intermediate"
    try {
      const { data: interview } = await supabase.from("interviews").select("difficulty").eq("id", interviewId).single()

      if (interview?.difficulty) {
        difficulty = interview.difficulty
      }
    } catch (difficultyError) {
      console.log("[v0] Could not fetch difficulty (column may not exist yet), using default:", difficulty)
    }

    console.log("[v0] Interview difficulty:", difficulty)

    const { data: userProfile } = await supabase
      .from("users")
      .select("name, preferences, experience, education, skills, resume_data")
      .eq("id", user.id)
      .single()

    console.log("[v0] User profile loaded for personalization")

    let userQuestion: string | null = null
    let attempts = 0
    const maxAttempts = 6
    let lastError: any = null

    while (attempts < maxAttempts && !userQuestion) {
      try {
        let interviewContext = ""

        const isAptitude = courseName === "aptitude" || isAptitudeType
        const isDSAInterview = courseName === "dsa"

        // First question should be an introduction (skip for aptitude and DSA problems)
        if (questionNumber === 1 && !isAptitude && !isDSAInterview) {
          interviewContext = `You are an experienced ${interviewType === "technical" ? "technical" : interviewType === "hr" ? "HR" : ""} interviewer conducting a professional interview.\n\nSTART THE INTERVIEW NATURALLY:\n1. Briefly introduce yourself (e.g., "Hi, I'm your AI interviewer today. Thanks for joining me.")\n2. Then ask the candidate to introduce themselves\n\nKeep it warm, professional, and conversational. This is the opening of a real interview.\n\nExample opening: "Hi! Thanks for taking the time to interview with us today. I'm excited to learn more about you. To start, could you please introduce yourself and tell me a bit about your background?"`
        } else {
          let courseContext = ""

          if (isDSAInterview) {
            const dsaTopics: Record<string, string> = {
              arrays:
                "Arrays and Strings - two pointers, sliding window, prefix sums, array manipulation, string algorithms",
              linked: "Linked Lists - reversal, cycle detection, merging, fast-slow pointers, dummy nodes",
              trees:
                "Trees and Graphs - traversals (DFS, BFS), binary search trees, graph algorithms, topological sort",
              sorting: "Sorting and Searching - quicksort, mergesort, binary search, two pointers, divide and conquer",
              dynamic:
                "Dynamic Programming - memoization, tabulation, classic DP patterns (knapsack, LCS, LIS), optimization",
              advanced:
                "Advanced Algorithms - backtracking, greedy algorithms, bit manipulation, math problems, complex optimizations",
            }

            const topicDescription = dsaTopics[courseSubject] || "Data Structures and Algorithms"

            courseContext = `\n\n🎯 DSA CODING PROBLEM - ${courseSubject.toUpperCase()}\n\nYOU ARE GENERATING A CODING PROBLEM, NOT AN INTERVIEW QUESTION.\n\nPROBLEM REQUIREMENTS:\n1. Present a clear, specific coding problem related to: ${topicDescription}\n2. Include input/output examples\n3. State any constraints (time/space complexity expectations)\n4. Make it solvable in 5-10 minutes\n5. Focus on ${courseSubject} concepts specifically\nCRITICAL: The problem MUST be ONLY about ${topicDescription}. Do not introduce other topics.\n\nPROBLEM FORMAT:\n[Problem Title]\n\nProblem: [Clear description of what needs to be solved]\n\nExample:\nInput: [sample input]\nOutput: [expected output]\nExplanation: [why this output is correct]\n\nConstraints:\n- [Time complexity expectation]\n- [Space complexity expectation]\n- [Any input constraints]\n\nDIFFICULTY LEVEL: ${difficulty}\n- Beginner: Simple iteration, basic array/string operations\n- Intermediate: Requires one key algorithm or data structure concept\n- Pro: Requires optimization or multiple concepts combined\n- Advanced: Complex optimization, multiple algorithms, edge cases\n\nDO NOT ASK THE CANDIDATE TO EXPLAIN - GIVE THEM A PROBLEM TO SOLVE.\nDO NOT USE CONVERSATIONAL LANGUAGE - BE DIRECT AND PROBLEM-FOCUSED.\nGENERATE A UNIQUE PROBLEM - AVOID REPEATING THE SAME PROBLEM STRUCTURE.\n\nPrevious problems asked: ${previousAnswers.map((qa: any) => qa.question.substring(0, 100)).join(" | ")}\n\nMAKE SURE THIS PROBLEM IS DIFFERENT FROM PREVIOUS ONES.`
          } else if (isAptitude) {
            const aptitudeTopics: Record<string, string> = {
              quantitative: "Quantitative Aptitude - arithmetic, percentages, ratios, averages, profit & loss, time/speed/distance",
              quant: "Quantitative Aptitude - arithmetic, percentages, ratios, averages, profit & loss, time/speed/distance",
              logical: "Logical Reasoning - patterns, sequences, deductions, syllogisms, arrangements, puzzles",
              "logical-reasoning": "Logical Reasoning - patterns, sequences, deductions, syllogisms, arrangements, puzzles",
              verbal: "Verbal Ability - reading comprehension, sentence correction, synonyms/antonyms, para jumbles",
              "verbal-reasoning": "Verbal Ability - reading comprehension, sentence correction, synonyms/antonyms, para jumbles",
              "data-interpretation": "Data Interpretation - charts, tables, graphs, data sufficiency",
              di: "Data Interpretation - charts, tables, graphs, data sufficiency",
              analytical: "Analytical Reasoning - complex logic problems, critical thinking, deductions",
              "analytical-reasoning": "Analytical Reasoning - complex logic problems, critical thinking, deductions",
              "speed-accuracy": "Speed & Accuracy - time-bound calculations, quick problem-solving under pressure",
            }

            const topicDescription = aptitudeTopics[courseSubject] || "Aptitude"

            courseContext = `\n\n🎯 APTITUDE PROBLEM - ${courseSubject.toUpperCase()}\n\nYOU ARE GENERATING AN APTITUDE QUESTION, NOT A CONVERSATIONAL INTERVIEW QUESTION.\n\nREQUIREMENTS:\n1. Provide ONE clear, concise aptitude problem related to: ${topicDescription}\nCRITICAL: The problem MUST be ONLY about ${topicDescription}. Do not introduce other topics.\n2. Keep it self-contained with necessary data (no external context)\n3. No solution, no hints, no multi-part subquestions\n4. Target difficulty: ${difficulty.toUpperCase()}\n\nFORMAT:\n[Problem Statement]\n(Include any numbers, tables, or conditions needed)\n\nPrevious problems asked: ${previousAnswers.map((qa: any) => qa.question.substring(0, 100)).join(" | ")}\n\nMAKE SURE THIS PROBLEM IS DIFFERENT FROM PREVIOUS ONES. Keep it brief (1-3 sentences).`
          } else if (courseName && courseSubject) {
            const courseMap: Record<string, Record<string, string>> = {
              frontend: {
                react:
                  "React.js framework - components, hooks, state management, context API, performance optimization, virtual DOM, JSX, lifecycle methods",
                vue: "Vue.js framework - components, directives, Vuex, composition API, reactivity system, Vue Router",
                angular:
                  "Angular framework - components, services, dependency injection, RxJS, TypeScript, modules, directives",
                javascript:
                  "Core JavaScript - ES6+, closures, promises, async/await, prototypes, event loop, DOM manipulation",
                html: "HTML5 - semantic elements, forms, accessibility, SEO best practices",
                css: "CSS3 - flexbox, grid, animations, responsive design, preprocessors, CSS-in-JS",
              },
              backend: {
                node: "Node.js - Express, middleware, RESTful APIs, authentication, database integration, async patterns",
                python: "Python backend - Django/Flask, APIs, database ORMs, authentication, deployment",
                java: "Java backend - Spring Boot, REST APIs, JPA/Hibernate, microservices, security",
                php: "PHP backend - Laravel/Symfony, MVC, databases, authentication, web services",
                ruby: "Ruby on Rails - MVC, ActiveRecord, routing, authentication, testing",
                go: "Go backend - Goroutines, HTTP servers, concurrency, database access, microservices",
              },
              database: {
                sql: "SQL databases - PostgreSQL/MySQL, queries, joins, indexes, normalization, transactions",
                mongodb: "MongoDB - NoSQL, documents, collections, aggregation, indexes, replication",
                redis: "Redis - caching, data structures, pub/sub, performance optimization",
              },
              devops: {
                docker: "Docker - containers, images, Docker Compose, networking, volumes",
                kubernetes: "Kubernetes - pods, services, deployments, scaling, orchestration",
                aws: "AWS - EC2, S3, Lambda, RDS, CloudFormation, architecture design",
                cicd: "CI/CD - pipelines, automated testing, deployment strategies, GitOps",
              },
              mobile: {
                react: "React Native - mobile components, navigation, state management, native modules",
                flutter: "Flutter - widgets, state management, Dart, animations, platform integration",
                ios: "iOS development - Swift, UIKit, SwiftUI, Core Data, networking",
                android: "Android development - Kotlin, Activities, Fragments, Room, MVVM",
              },
            }

            const topicDescription =
              courseMap[courseName]?.[courseSubject] || `${courseName} ${courseSubject} development`

            courseContext = `\n\n🎯 COURSE FOCUS: ${courseName.toUpperCase()} - ${courseSubject.toUpperCase()}\nThis is a specialized ${courseName} interview focusing on ${courseSubject}.\n\nTECHNICAL TOPICS TO COVER:\n${topicDescription}\n\nYOUR QUESTIONS MUST:\n1. Be directly related to ${courseSubject} ${courseName} development\n2. Cover practical, real-world scenarios specific to ${courseSubject}\n3. Test understanding of ${courseSubject} concepts, not generic programming\n4. Ask about best practices, common challenges, and optimization in ${courseSubject}\n5. Reference ${courseSubject}-specific tools, libraries, and patterns\n\nEXAMPLES OF GOOD ${courseSubject.toUpperCase()} QUESTIONS:\n- "How would you optimize performance in a ${courseSubject} application?"\n- "Explain how [specific ${courseSubject} concept] works and when you\'d use it"\n- "Walk me through debugging a common ${courseSubject} issue you\'ve encountered"\n- "What are the trade-offs between [approach A] and [approach B] in ${courseSubject}?"\n\nDO NOT ask generic programming questions. Keep it focused on ${courseSubject} ${courseName}.\nDIFFICULTY: ${difficulty}\nPrevious questions (avoid any overlap or paraphrase):\n${previousAnswers.map((qa: any, idx: number) => `${idx + 1}. ${qa.question}`).join("\n")}`
          }

          if (interviewType === "custom" && customScenario) {
            interviewContext = `You are conducting a highly personalized custom interview scenario.\n\nSCENARIO DESCRIPTION: ${customScenario.description}\n\nINTERVIEW CONTEXT: ${customScenario.context || "Standard interview setting"}\n\nCANDIDATE\'S GOALS TO DEMONSTRATE:\n${customScenario.goals.map((goal: string, i: number) => `${i + 1}. ${goal}`).join("\n")}\n\nFOCUS AREAS TO ASSESS:\n${customScenario.focusAreas.map((area: string, i: number) => `${i + 1}. ${area}`).join("\n")}\n\nYOUR JOB AS INTERVIEWER:\n1. Ask questions that directly evaluate the focus areas listed above\n2. Create realistic scenarios aligned with the candidate\'s goals\n3. Vary question types: situational, behavioral, technical (if relevant), problem-solving\n4. Build naturally on previous responses\n5. Keep questions aligned with the scenario description throughout\n\nThis is a REAL interview tailored to their specific needs. Make it count.`
          } else if (!isAptitude && !isDSAInterview) {
            const contextMap = {
              technical:
                "You are conducting a natural, conversational technical interview. This is a REAL interview, so:\n\n" +
                "QUESTION TYPE MIX:\n" +
                "- TECHNICAL/CONCEPTUAL (40%): Core knowledge, algorithms, system design, best practices\n" +
                "- PROBLEM-SOLVING (25%): Approach to problems, debugging, real-world scenarios\n" +
                "- BEHAVIORAL (20%): Past experiences, teamwork, handling challenges\n" +
                "- COMMUNICATION (15%): Explaining concepts, teaching, documentation\n\n" +
                "INTERVIEW STYLE:\n" +
                "- Ask questions like a real interviewer would\n" +
                "- Build on previous answers naturally\n" +
                "- Mix technical depth with behavioral insights\n" +
                "- Be conversational, not robotic\n" +
                "- Show genuine interest in their responses",
              hr:
                "You are conducting a natural, conversational HR interview. This is a REAL interview, so:\n\n" +
                "QUESTION TYPE MIX:\n" +
                "- BEHAVIORAL (40%): Past experiences, conflict resolution, teamwork, leadership (use STAR method)\n" +
                "- MOTIVATIONAL (25%): Career goals, what drives them, why this role\n" +
                "- SITUATIONAL (20%): How they\'d handle workplace scenarios\n" +
                "- CULTURAL FIT (15%): Work style, values, communication preferences\n\n" +
                "INTERVIEW STYLE:\n" +
                "- Create a warm, engaging conversation\n" +
                "- Ask follow-up questions based on their answers\n" +
                "- Understand them as a person, not just a resume\n" +
                "- Be empathetic and professional",
              custom:
                "You are conducting a comprehensive interview. This is a REAL interview, so:\n\n" +
                "QUESTION TYPE MIX:\n" +
                "- EXPERIENCE-BASED (35%): Past projects, achievements, challenges\n" +
                "- SKILLS ASSESSMENT (30%): Technical abilities, soft skills, problem-solving\n" +
                "- BEHAVIORAL (20%): Teamwork, handling pressure, learning and growth\n" +
                "- FORWARD-LOOKING (15%): Goals, aspirations, what they\'re seeking\n\n" +
                "INTERVIEW STYLE:\n" +
                "- Keep it conversational and natural\n" +
                "- Build on previous responses\n" +
                "- Mix different question types\n" +
                "- Show genuine interest",
            }

            interviewContext = contextMap[interviewType as keyof typeof contextMap] || contextMap.custom
            interviewContext += courseContext
          }
        }

        let difficultyContext = ""

        switch (difficulty) {
          case "beginner":
            difficultyContext =
              "\n\nDIFFICULTY LEVEL: BEGINNER - Ask fundamental questions about basic concepts, definitions, and simple applications. Focus on understanding core principles and basic usage. Avoid complex scenarios or advanced topics. Keep questions encouraging and supportive."
            break
          case "intermediate":
            difficultyContext =
              "\n\nDIFFICULTY LEVEL: INTERMEDIATE - Ask practical questions about real-world applications, problem-solving, and best practices. Include scenario-based questions that require applying knowledge to solve common challenges. Balance technical depth with accessibility."
            break
          case "pro":
            difficultyContext =
              "\n\nDIFFICULTY LEVEL: PRO - Ask advanced questions about optimization, performance, scalability, and complex problem-solving. Include questions about trade-offs, design patterns, and advanced techniques. Challenge them to think critically."
            break
          case "advanced":
            difficultyContext =
              "\n\nDIFFICULTY LEVEL: ADVANCED - Ask expert-level questions about system architecture, complex design decisions, cutting-edge technologies, and deep technical knowledge. Challenge the candidate with sophisticated scenarios requiring comprehensive understanding and strategic thinking."
            break
          default:
            difficultyContext =
              "\n\nDIFFICULTY LEVEL: INTERMEDIATE - Ask practical questions about real-world applications and problem-solving."
        }

        let personalizationContext = ""

        if (userProfile?.preferences) {
          const prefs = userProfile.preferences as any
          const careerStage = prefs.career_stage

          if (careerStage === "student") {
            personalizationContext =
              "\n\nIMPORTANT: The candidate is a STUDENT who is currently pursuing their degree. They have NO professional work experience yet. Ask questions appropriate for someone seeking their FIRST job or internship. Focus on:\n" +
              "- Academic projects and coursework\n" +
              "- Learning experiences and how they overcome challenges\n" +
              "- Theoretical knowledge and eagerness to apply it\n" +
              "- Teamwork in group projects\n" +
              "- Their potential and growth mindset\n" +
              "NEVER ask about previous jobs, professional experience, or workplace scenarios."
          } else if (careerStage === "recent_graduate") {
            personalizationContext =
              "\n\nIMPORTANT: The candidate is a RECENT GRADUATE who graduated within the last 2 years. They may have limited professional experience. Ask questions appropriate for entry-level positions:\n" +
              "- Academic projects and any internships\n" +
              "- How they\'re transitioning from academic to professional life\n" +
              "- Their eagerness to learn and grow\n" +
              "- Fresh perspectives and modern knowledge"
          } else if (careerStage === "professional") {
            const yearsExp = prefs.years_of_experience || 0
            const currentRole = prefs.current_role || "professional"
            personalizationContext = `\n\nThe candidate is a ${currentRole} with ${yearsExp} years of professional experience. Ask questions appropriate for their experience level, including past projects, leadership, and professional growth.`
          } else if (careerStage === "career_changer") {
            personalizationContext =
              "\n\nThe candidate is transitioning to a new field. Ask questions that:\n" +
              "- Acknowledge their transferable skills from previous career\n" +
              "- Explore their motivation for the career change\n" +
              "- Assess how they\'re preparing for the transition\n" +
              "- Assess how they\'re preparing for the transition\n" +
              "- Value their unique perspective from different background"
          }

          if (prefs.target_role) {
            personalizationContext += ` They are targeting a ${prefs.target_role} position.`
          }
        }

        if (userProfile?.skills && Array.isArray(userProfile.skills) && userProfile.skills.length > 0) {
          personalizationContext += `\n\nCandidate\'s skills: ${userProfile.skills.join(", ")}`
        }

        if (userProfile?.education && Array.isArray(userProfile.education) && userProfile.education.length > 0) {
          const edu = userProfile.education[0] as any
          personalizationContext += `\n\nEducation: ${edu.degree} from ${edu.school}`
        }

        if (userProfile?.resume_data) {
          const resumeData = userProfile.resume_data as any
          personalizationContext += "\n\nRESUME INSIGHTS:"

          if (resumeData.experience && Array.isArray(resumeData.experience) && resumeData.experience.length > 0) {
            personalizationContext += "\nWork Experience:"
            resumeData.experience.slice(0, 3).forEach((exp: any) => {
              personalizationContext += `\n- ${exp.role || exp.title} at ${exp.company}${exp.duration ? ` (${exp.duration})` : ""}`
              if (exp.description) {
                personalizationContext += `\n  ${exp.description.substring(0, 150)}`
              }
            })
          }

          if (resumeData.projects && Array.isArray(resumeData.projects) && resumeData.projects.length > 0) {
            personalizationContext += "\n\nProjects:"
            resumeData.projects.slice(0, 2).forEach((proj: any) => {
              personalizationContext += `\n- ${proj.name}: ${proj.description?.substring(0, 100) || ""}`
              if (proj.technologies) {
                personalizationContext += `\n  Technologies: ${Array.isArray(proj.technologies) ? proj.technologies.join(", ") : proj.technologies}`
              }
            })
          }

          if (resumeData.summary) {
            personalizationContext += `\n\nProfessional Summary: ${resumeData.summary}`
          }

          personalizationContext +=
            "\n\nUSE THIS RESUME DATA to ask specific questions about their actual experience, projects, and skills. Reference their real work when appropriate."
        }

        const previousContext =
          previousAnswers && previousAnswers.length > 0
            ? `\n\nPREVIOUS CONVERSATION:\n${previousAnswers.map((qa: any, i: number) => `\nQ${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join("\n")}\n\nBased on their previous answers, you can ask follow-up questions or explore new areas. Make the conversation flow naturally like a real interview.`
            : ""

        const contextUsageInstruction =
          previousAnswers && previousAnswers.length > 0
            ? `\n\nIMPORTANT: Review the previous conversation above. Your next question MUST:\n1. Either ask a follow-up based on what they said (reference their answer naturally)\n2. OR explore a different aspect of the role/topic\n3. NEVER ask the same type of question twice\n4. Build on their responses to create a flowing conversation\n5. If they mentioned something interesting, dig deeper into it\n\nMake this feel like a REAL conversation, not a scripted questionnaire.`
            : ""

        console.log("[v0] Calling generateText with personalized context and difficulty...")

        const { text } = await generateTextWithRetry(
          groqClient("llama-3.3-70b-versatile"),
          (isDSAInterview || isAptitude)
            ? `${interviewContext}${difficultyContext}

This is coding problem number ${questionNumber} out of ${questionCount}.
${isDSAInterview ? previousContext : ''}

CRITICAL: You are generating a CODING PROBLEM, not a conversational question.

REQUIRED FORMAT:
**Problem:** [Clear problem statement]

**Example:**
Input: [example input]
Output: [example output]

**Constraints:**
- [time/space complexity requirements]
- [input size/range]

Generate ONE unique coding problem. Make it different from any previous problems in this interview.`
            : `${interviewContext}${questionNumber === 1 ? "" : difficultyContext}${questionNumber === 1 ? "" : personalizationContext}
      
This is question number ${questionNumber}.
${previousContext}${isAptitude ? "" : contextUsageInstruction}

${
  questionNumber === 1
    ? "Generate a warm, professional opening that introduces yourself and asks the candidate to introduce themselves. Keep it natural and conversational."
    : `IMPORTANT GUIDELINES:\n1. Generate a NORMAL-LENGTH interview question (typically 1-3 sentences) - clear, direct, and conversational like real interviewers ask\n2. Keep it conversational and natural, like a real interviewer would ask\n3. Generate a UNIQUE question that hasn\'t been asked in this interview\n4. Vary the question type - mix technical, behavioral, problem-solving, and situational questions\n5. If this is a follow-up (based on previous answers), reference their response naturally\n6. Keep questions clear, specific, and appropriate for their background\n7. For students: Focus on learning, projects, and potential - NOT work experience\n8. For professionals: Reference their actual experience and ask about real scenarios\n9. Make questions complete and well-formed - not too brief (avoid single-word questions) but also not overly long or verbose\n\nCRITICAL: Generate questions that sound like a real interviewer asking - natural length, clear, and engaging. Examples of normal interview questions:\n- "Can you tell me about a challenging project you worked on and how you handled it?"\n- "How do you typically approach debugging when you encounter an issue in your code?"\n- "What\'s your experience with React hooks, and can you walk me through how you\'ve used them?"\n- "Tell me about a time when you had to work under a tight deadline. How did you manage it?"\n\nGenerate ONE natural, engaging interview question. Return ONLY the question, nothing else.`
}

Generate ONE engaging interview question that fits these criteria. Return ONLY the question, nothing else.`,
          5, // maxRetries
          2000, // initialDelayMs
        )

        console.log("[v0] generateText succeeded, received response")

        let newQuestion = text.trim()
        if (newQuestion.startsWith("```")) {
          newQuestion = newQuestion.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim()
        }

        if (!newQuestion) {
          throw new Error("Empty question returned from model")
        }

        if (isDuplicateQuestion(newQuestion, previousAnswers || [])) {
          console.log("[v0] Generated duplicate question based on previousAnswers, retrying...")
          attempts++
          continue
        }

        console.log("[v0] Generated question:", newQuestion.substring(0, 100) + "...")

        try {
          const questionHash = generateQuestionHash(newQuestion)

          const { data: existingQuestion, error: checkError } = await supabase
            .from("interview_questions_asked")
            .select("id, is_important, times_asked")
            .eq("user_id", user.id)
            .eq("question_hash", questionHash)
            .maybeSingle()

          if (checkError) {
            console.log("[v0] Warning: Could not check question history:", checkError.message)
            userQuestion = newQuestion
            break
          }

          if (!existingQuestion) {
            console.log("[v0] Question is unique, using it")
            userQuestion = newQuestion

            try {
              const { error: insertError } = await supabase.from("interview_questions_asked").insert({
                user_id: user.id,
                question_hash: questionHash,
                question_text: newQuestion,
                is_important: false,
                times_asked: 1,
              })

              if (insertError) {
                console.log("[v0] Could not record question history:", insertError.message)
              } else {
                console.log("[v0] Question history recorded successfully")
              }
            } catch (insertError) {
              console.log(
                "[v0] Could not record question history:",
                insertError instanceof Error ? insertError.message : "Unknown error",
              )
            }
          } else if (existingQuestion.is_important) {
            console.log("[v0] Reusing important question")
            userQuestion = newQuestion

            // Increment times_asked for important/reused questions
            try {
              await supabase
                .from("interview_questions_asked")
                .update({ times_asked: (existingQuestion.times_asked || 0) + 1 })
                .eq("id", existingQuestion.id)
              console.log("[v0] Incremented times_asked for important question")
            } catch (incError) {
              console.log("[v0] Could not increment times_asked:", incError instanceof Error ? incError.message : String(incError))
            }
          } else {
            console.log("[v0] Question already asked, trying again (attempt", attempts + 1, "of", maxAttempts, ")")

            // Increment times_asked to record additional attempt on this question
            try {
              await supabase
                .from("interview_questions_asked")
                .update({ times_asked: (existingQuestion.times_asked || 0) + 1 })
                .eq("id", existingQuestion.id)
              console.log("[v0] Incremented times_asked for existing question")
            } catch (incError) {
              console.log("[v0] Could not increment times_asked:", incError instanceof Error ? incError.message : String(incError))
            }

            attempts++
          }
        } catch (dbError) {
          console.log(
            "[v0] Database operation failed, using question anyway:",
            dbError instanceof Error ? dbError.message : String(dbError),
          )
          userQuestion = newQuestion
          break
        }
      } catch (attemptError) {
        lastError = attemptError
        console.error("[v0] Error in attempt", attempts + 1)
        if (attemptError instanceof Error) {
          console.error("[v0] Error message:", attemptError.message)
          console.error("[v0] Error cause:", attemptError.cause)
        } else {
          console.error("[v0] Error:", attemptError)
        }
        attempts++
      }
    }

    if (!userQuestion) {
      console.log("[v0] All regeneration attempts failed, using fallback question")
      if (lastError) {
        console.error("[v0] Last error:", lastError instanceof Error ? lastError.message : String(lastError))
      }
      userQuestion = "Tell me about a challenging situation you faced and how you approached solving it."

      // Record the fallback question so it is not repeatedly returned in subsequent attempts
      try {
        const questionHash = generateQuestionHash(userQuestion)
        const { error: insertFallbackError } = await supabase.from("interview_questions_asked").insert({
          user_id: user.id,
          question_hash: questionHash,
          question_text: userQuestion,
          is_important: false,
          times_asked: 1,
        })

        if (insertFallbackError) {
          console.log("[v0] Could not record fallback question:", insertFallbackError.message)
        } else {
          console.log("[v0] Fallback question recorded to avoid repetition")
        }
      } catch (recordError) {
        console.log("[v0] Error recording fallback question:", recordError instanceof Error ? recordError.message : String(recordError))
      }
    }

    console.log("[v0] Returning question successfully")
    return NextResponse.json({ question: userQuestion })
  } catch (error) {
    console.error("[v0] Fatal error in question endpoint:", error)
    let errorMessage = "Failed to generate question"
    let errorDetails = ""

    if (error instanceof Error) {
      errorMessage = error.message
      errorDetails = error.stack || ""
    } else if (typeof error === "object" && error !== null) {
      errorDetails = JSON.stringify(error)
    } else {
      errorDetails = String(error)
    }

    console.error("[v0] Error message:", errorMessage)
    console.error("[v0] Error details:", errorDetails)

    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}
