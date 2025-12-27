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
            // DSA Topics - EXACTLY matching lib/courses.ts info descriptions
            const dsaTopics: Record<string, { description: string; examples: string[] }> = {
              arrays: {
                description: "Arrays & Strings - array manipulation, string algorithms, and two-pointer techniques",
                examples: [
                  "Two-pointer problems (finding pairs, removing duplicates)",
                  "Sliding window (max sum subarray, longest substring)",
                  "Prefix sums and cumulative arrays",
                  "String manipulation (reversal, rotation, matching)",
                  "In-place array modifications",
                  "Kadane's algorithm variations"
                ]
              },
              linked: {
                description: "Linked Lists - traversal, reversal, and cycle detection",
                examples: [
                  "Reverse a linked list (iterative/recursive)",
                  "Detect cycle using Floyd's algorithm",
                  "Find middle element using fast-slow pointers",
                  "Merge two sorted linked lists",
                  "Remove nth node from end",
                  "Intersection of two linked lists"
                ]
              },
              linkedlists: {
                description: "Linked Lists - traversal, reversal, and cycle detection",
                examples: [
                  "Reverse a linked list (iterative/recursive)",
                  "Detect cycle using Floyd's algorithm",
                  "Find middle element using fast-slow pointers",
                  "Merge two sorted linked lists",
                  "Remove nth node from end",
                  "Intersection of two linked lists"
                ]
              },
              trees: {
                description: "Trees & Graphs - tree traversals, BST operations, and graph algorithms",
                examples: [
                  "Tree traversals (inorder, preorder, postorder, level-order)",
                  "BST operations (insert, delete, search, validate)",
                  "Graph BFS and DFS traversals",
                  "Lowest common ancestor",
                  "Path sum problems",
                  "Topological sort",
                  "Detect cycle in graph"
                ]
              },
              sorting: {
                description: "Sorting & Searching - quicksort, mergesort, binary search, and variations",
                examples: [
                  "Implement quicksort or mergesort",
                  "Binary search variations (first/last occurrence)",
                  "Search in rotated sorted array",
                  "Kth largest/smallest element",
                  "Merge intervals",
                  "Sort colors (Dutch National Flag)"
                ]
              },
              dynamic: {
                description: "Dynamic Programming - optimization problems with memoization and tabulation",
                examples: [
                  "Fibonacci with memoization/tabulation",
                  "Knapsack problem (0/1, unbounded)",
                  "Longest Common Subsequence (LCS)",
                  "Longest Increasing Subsequence (LIS)",
                  "Coin change problem",
                  "Edit distance",
                  "Maximum subarray (Kadane's)"
                ]
              },
              advanced: {
                description: "Advanced Algorithms - greedy algorithms, backtracking, and complex patterns",
                examples: [
                  "Backtracking (N-Queens, Sudoku solver, permutations)",
                  "Greedy algorithms (activity selection, Huffman coding)",
                  "Bit manipulation (single number, counting bits)",
                  "Trie operations",
                  "Union-Find/Disjoint Set",
                  "Segment trees basics"
                ]
              }
            }

            const topicData = dsaTopics[courseSubject] || { description: "Data Structures and Algorithms", examples: [] }
            const topicDescription = topicData.description
            const topicExamples = topicData.examples

            // SET interviewContext for DSA
            interviewContext = `🎯 DSA CODING PROBLEM - ${courseSubject.toUpperCase()}

YOU ARE GENERATING A CODING PROBLEM, NOT AN INTERVIEW QUESTION.

TOPIC: ${topicDescription}

VALID PROBLEM TYPES FOR THIS TOPIC:
${topicExamples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

⚠️ CRITICAL RESTRICTION: The problem MUST be ONLY about ${topicDescription}.
ONLY generate problems from the VALID PROBLEM TYPES listed above.

DO NOT generate problems about:
- Topics from other DSA categories
- Palindromes (unless it's specifically a string algorithm problem in arrays topic)
- Problems that don't use ${courseSubject} concepts
- Generic math or logic puzzles

PROBLEM FORMAT:
**Problem:** [Clear description - MUST be one of the valid problem types above]

**Example:**
Input: [sample input]
Output: [expected output]
Explanation: [why this output is correct]

**Constraints:**
- [Time complexity expectation]
- [Space complexity expectation]
- [Any input constraints]

DIFFICULTY LEVEL: ${difficulty}
- Beginner: Basic ${courseSubject} operations, straightforward implementation
- Intermediate: Standard ${courseSubject} algorithms, one key technique
- Pro: Optimization required, multiple techniques combined
- Advanced: Complex edge cases, optimal solutions required

Previous problems asked: ${previousAnswers.map((qa: any) => qa.question.substring(0, 100)).join(" | ")}

GENERATE A UNIQUE PROBLEM FROM THE VALID PROBLEM TYPES. Make it different from previous ones.`
          } else if (isAptitude) {
            // Aptitude Topics - EXACTLY matching lib/courses.ts info descriptions
            const aptitudeTopics: Record<string, { description: string; examples: string[] }> = {
              quantitative: {
                description: "Quantitative Aptitude - arithmetic, algebra, geometry, and number problems",
                examples: [
                  "Percentage calculations (discounts, increases, decreases)",
                  "Profit and Loss problems",
                  "Time, Speed, and Distance",
                  "Work and Time (pipes, cisterns)",
                  "Ratios and Proportions",
                  "Simple and Compound Interest",
                  "Averages and Mixtures",
                  "Algebra (equations, inequalities)",
                  "Geometry (areas, volumes, angles)",
                  "Number series and sequences"
                ]
              },
              quant: {
                description: "Quantitative Aptitude - arithmetic, algebra, geometry, and number problems",
                examples: [
                  "Percentage calculations",
                  "Profit and Loss",
                  "Time, Speed, Distance",
                  "Ratios and Proportions",
                  "Algebra and Geometry"
                ]
              },
              logical: {
                description: "Logical Reasoning - puzzles, pattern recognition, and analytical problems",
                examples: [
                  "Number series (find the next number)",
                  "Letter series (find the pattern)",
                  "Syllogisms (All A are B, Some B are C...)",
                  "Blood relations (A is B's mother's son...)",
                  "Direction sense (walked north, turned left...)",
                  "Seating arrangements (circular, linear)",
                  "Coding-decoding (if CAT = XZG, then DOG = ?)",
                  "Ranking and ordering",
                  "Puzzles (who sits where, who does what)"
                ]
              },
              "logical-reasoning": {
                description: "Logical Reasoning - puzzles, pattern recognition, and analytical problems",
                examples: [
                  "Number/letter series",
                  "Syllogisms",
                  "Blood relations",
                  "Direction sense",
                  "Seating arrangements",
                  "Coding-decoding"
                ]
              },
              verbal: {
                description: "Verbal Reasoning - comprehension, vocabulary, and language skills",
                examples: [
                  "Reading comprehension (passage + questions)",
                  "Sentence correction / Error spotting",
                  "Fill in the blanks (grammar/vocabulary)",
                  "Synonyms and Antonyms",
                  "Para jumbles (arrange sentences)",
                  "One word substitution",
                  "Idioms and phrases",
                  "Sentence completion",
                  "Cloze test passages"
                ]
              },
              "verbal-reasoning": {
                description: "Verbal Reasoning - comprehension, vocabulary, and language skills",
                examples: [
                  "Reading comprehension",
                  "Sentence correction",
                  "Synonyms/Antonyms",
                  "Para jumbles",
                  "Fill in the blanks"
                ]
              },
              "data-interpretation": {
                description: "Data Interpretation - analyzing charts, graphs, and tables for data-driven questions",
                examples: [
                  "Bar graph analysis (compare values, find percentages)",
                  "Pie chart problems (calculate sectors, ratios)",
                  "Line graph interpretation (trends, growth rates)",
                  "Table data analysis (find averages, totals)",
                  "Mixed charts (multiple data sources)",
                  "Data sufficiency (is the data enough to answer?)",
                  "Caselet-based questions (text + data)"
                ]
              },
              di: {
                description: "Data Interpretation - analyzing charts, graphs, and tables",
                examples: [
                  "Bar graphs",
                  "Pie charts",
                  "Line graphs",
                  "Tables",
                  "Data sufficiency"
                ]
              },
              analytical: {
                description: "Analytical Reasoning - complex logic problems and critical thinking questions",
                examples: [
                  "Statement and Assumptions",
                  "Statement and Conclusions",
                  "Statement and Arguments",
                  "Cause and Effect",
                  "Course of Action",
                  "Critical reasoning passages",
                  "Strengthening/Weakening arguments",
                  "Inference-based questions",
                  "Assertion and Reason"
                ]
              },
              "analytical-reasoning": {
                description: "Analytical Reasoning - complex logic problems and critical thinking",
                examples: [
                  "Statement-Assumptions",
                  "Statement-Conclusions",
                  "Cause and Effect",
                  "Critical reasoning"
                ]
              },
              "speed-accuracy": {
                description: "Speed & Accuracy - time-bound calculations and quick problem-solving",
                examples: [
                  "Quick mental math (addition, subtraction, multiplication)",
                  "Approximation problems",
                  "Simplification (BODMAS)",
                  "Number comparisons",
                  "Percentage shortcuts",
                  "Square roots and cubes",
                  "Decimal and fraction conversions",
                  "Quick calculations under time pressure"
                ]
              }
            }

            const topicData = aptitudeTopics[courseSubject] || { description: "General Aptitude", examples: [] }
            const topicDescription = topicData.description
            const topicExamples = topicData.examples

            // SET interviewContext for Aptitude
            interviewContext = `🎯 APTITUDE PROBLEM - ${courseSubject.toUpperCase()}

YOU ARE GENERATING AN APTITUDE QUESTION, NOT A CODING PROBLEM.

TOPIC: ${topicDescription}

VALID QUESTION TYPES FOR THIS TOPIC:
${topicExamples.map((ex, i) => `${i + 1}. ${ex}`).join('\n')}

⚠️ CRITICAL RESTRICTION: 
- The question MUST be from the VALID QUESTION TYPES listed above
- DO NOT generate coding/programming problems
- DO NOT generate DSA problems
- DO NOT generate questions from other aptitude categories

REQUIREMENTS:
1. Generate ONE clear aptitude problem from the valid types above
2. Include all necessary data in the problem itself
3. No hints or solutions
4. Difficulty: ${difficulty.toUpperCase()}

FORMAT:
[Problem Statement with all necessary data]

${courseSubject === 'verbal' || courseSubject === 'verbal-reasoning' ? `
REMEMBER: This is VERBAL reasoning - focus on language, grammar, vocabulary, comprehension.
Example formats:
- "Choose the correct word: The project was _____ (accepted/excepted) by the committee."
- "Find the error: 'He don't know the answer.' - identify and correct"
- Short passage followed by comprehension question
` : ''}
${courseSubject === 'logical' || courseSubject === 'logical-reasoning' ? `
REMEMBER: This is LOGICAL reasoning - focus on patterns, deductions, arrangements.
Example formats:
- "Find the next number: 2, 6, 12, 20, 30, ?"
- "If A is B's brother and C is A's mother, how is B related to C?"
- "5 people sit in a row. A sits next to B but not C..."
` : ''}
${courseSubject === 'quantitative' || courseSubject === 'quant' ? `
REMEMBER: This is QUANTITATIVE aptitude - focus on math, calculations, formulas.
Example formats:
- "A shopkeeper sells an item at 20% profit. If cost price is Rs. 500, find selling price."
- "A train travels 300km in 5 hours. Find its speed in m/s."
- "Find the area of a triangle with base 10cm and height 8cm."
` : ''}
${courseSubject === 'data-interpretation' || courseSubject === 'di' ? `
REMEMBER: This is DATA INTERPRETATION - you MUST include data (table/chart description).
Example format:
"The following table shows sales (in lakhs) for 5 products:
Product A: 120, Product B: 85, Product C: 150, Product D: 95, Product E: 110
Question: What is the percentage contribution of Product C to total sales?"
` : ''}
${courseSubject === 'analytical' || courseSubject === 'analytical-reasoning' ? `
REMEMBER: This is ANALYTICAL reasoning - focus on critical thinking, arguments, conclusions.
Example formats:
- "Statement: All successful people wake up early. Conclusion: Waking up early guarantees success. Is the conclusion valid?"
- "Statement: The company's profits have declined. Assumption: The company had profits before. Is this assumption implicit?"
` : ''}
${courseSubject === 'speed-accuracy' ? `
REMEMBER: This is SPEED & ACCURACY - focus on quick calculations.
Example formats:
- "Calculate quickly: 17 × 23 = ?"
- "Approximate: 4987 ÷ 51 ≈ ?"
- "Simplify: (25 × 16) ÷ (5 × 4) = ?"
` : ''}

Previous problems asked: ${previousAnswers.map((qa: any) => qa.question.substring(0, 100)).join(" | ")}

GENERATE A UNIQUE PROBLEM FROM THE VALID QUESTION TYPES. Keep it concise (1-4 sentences).`
          } else if (courseName && courseSubject) {
            // Course Topics - EXACTLY matching lib/courses.ts info descriptions
            const courseMap: Record<string, Record<string, { description: string; topics: string[] }>> = {
              frontend: {
                react: {
                  description: "React - Build interactive UIs with React hooks and components",
                  topics: ["Hooks (useState, useEffect, useContext, useMemo, useCallback)", "Component lifecycle", "State management", "Context API", "Virtual DOM", "JSX", "Performance optimization", "React Router"]
                },
                vue: {
                  description: "Vue.js - Create reactive applications with Vue's composition API",
                  topics: ["Composition API", "Reactivity system", "Vue Router", "Vuex/Pinia", "Components", "Directives", "Lifecycle hooks", "Computed properties"]
                },
                angular: {
                  description: "Angular - Develop enterprise apps with TypeScript and RxJS",
                  topics: ["TypeScript", "RxJS observables", "Dependency injection", "Services", "Modules", "Components", "Directives", "Angular CLI", "Forms (reactive/template)"]
                },
                nextjs: {
                  description: "Next.js - Master server-side rendering and static site generation",
                  topics: ["SSR (Server-Side Rendering)", "SSG (Static Site Generation)", "ISR (Incremental Static Regeneration)", "API routes", "App Router", "Middleware", "Image optimization", "Data fetching"]
                },
                typescript: {
                  description: "TypeScript - Write type-safe JavaScript for scalable applications",
                  topics: ["Type annotations", "Interfaces", "Generics", "Type guards", "Utility types", "Enums", "Decorators", "Type inference", "Strict mode"]
                },
                tailwind: {
                  description: "Tailwind CSS - Design modern UIs with utility-first CSS framework",
                  topics: ["Utility classes", "Responsive design", "Custom configurations", "Plugins", "JIT mode", "Component patterns", "Dark mode", "Animations"]
                }
              },
              backend: {
                nodejs: {
                  description: "Node.js - Build scalable server applications with JavaScript runtime",
                  topics: ["Express.js", "Middleware", "RESTful APIs", "Authentication (JWT, OAuth)", "Database integration", "Async patterns", "Streams", "Clustering", "Error handling"]
                },
                python: {
                  description: "Python - Create robust backends with Django and Flask frameworks",
                  topics: ["Django/Flask", "REST APIs", "ORM (SQLAlchemy, Django ORM)", "Authentication", "Middleware", "Deployment", "Celery (async tasks)", "Testing"]
                },
                java: {
                  description: "Java - Develop enterprise applications with Spring Boot",
                  topics: ["Spring Boot", "REST APIs", "JPA/Hibernate", "Dependency injection", "Microservices", "Security (Spring Security)", "Testing", "Maven/Gradle"]
                },
                go: {
                  description: "Go - Build high-performance concurrent services",
                  topics: ["Goroutines", "Channels", "HTTP servers", "Concurrency patterns", "Database access", "Microservices", "Error handling", "Testing"]
                },
                dotnet: {
                  description: ".NET - Create modern applications with ASP.NET Core",
                  topics: ["ASP.NET Core", "Entity Framework", "Web APIs", "Dependency injection", "Middleware", "Authentication", "SignalR", "Blazor"]
                },
                rust: {
                  description: "Rust - Write memory-safe systems programming code",
                  topics: ["Ownership", "Borrowing", "Lifetimes", "Async runtime (Tokio)", "Actix/Axum", "Error handling", "Memory safety", "Performance optimization"]
                }
              },
              fullstack: {
                mern: {
                  description: "MERN Stack - MongoDB, Express, React, and Node.js ecosystem",
                  topics: ["MongoDB (queries, aggregation)", "Express.js", "React", "Node.js", "RESTful APIs", "State management", "Authentication", "Deployment"]
                },
                mean: {
                  description: "MEAN Stack - Build Angular applications with Node.js backend",
                  topics: ["MongoDB", "Express.js", "Angular", "Node.js", "TypeScript", "RxJS", "Authentication", "Full-stack architecture"]
                },
                lamp: {
                  description: "LAMP Stack - Traditional web development with Linux, Apache, MySQL, PHP",
                  topics: ["Linux server", "Apache configuration", "MySQL", "PHP", "MVC patterns", "Database design", "Security", "Deployment"]
                },
                jamstack: {
                  description: "JAMstack - Modern web architecture with JavaScript, APIs, and Markup",
                  topics: ["Static site generators (Gatsby, Hugo)", "Headless CMS", "Serverless functions", "CDN deployment", "APIs", "Pre-rendering", "Performance"]
                },
                serverless: {
                  description: "Serverless - Build scalable apps without managing infrastructure",
                  topics: ["AWS Lambda", "Azure Functions", "Event-driven design", "Cold starts", "Function composition", "API Gateway", "DynamoDB", "Cost optimization"]
                },
                microservices: {
                  description: "Microservices - Design distributed systems with service architecture",
                  topics: ["Service decomposition", "API design", "Inter-service communication", "Event sourcing", "CQRS", "Service mesh", "Containerization", "Monitoring"]
                }
              },
              datascience: {
                "python-ds": {
                  description: "Python for DS - Master NumPy, Pandas, and data visualization libraries",
                  topics: ["NumPy arrays", "Pandas DataFrames", "Data manipulation", "Data cleaning", "Exploratory data analysis", "Matplotlib", "Seaborn", "Jupyter notebooks"]
                },
                ml: {
                  description: "Machine Learning - Build predictive models with scikit-learn and algorithms",
                  topics: ["Supervised learning", "Unsupervised learning", "scikit-learn", "Model training", "Cross-validation", "Feature engineering", "Hyperparameter tuning", "Model evaluation"]
                },
                deeplearning: {
                  description: "Deep Learning - Create neural networks with TensorFlow and PyTorch",
                  topics: ["Neural networks", "TensorFlow", "PyTorch", "CNNs", "RNNs", "Transformers", "Model optimization", "GPU training", "Transfer learning"]
                },
                nlp: {
                  description: "NLP - Process and analyze natural language data",
                  topics: ["Text preprocessing", "Tokenization", "Word embeddings", "Sentiment analysis", "Named entity recognition", "Transformers (BERT, GPT)", "Text classification"]
                },
                sql: {
                  description: "SQL & Databases - Query and manage relational database systems",
                  topics: ["Complex queries", "JOINs", "Window functions", "Indexing", "Query optimization", "Database design", "Stored procedures", "Transactions"]
                },
                analytics: {
                  description: "Data Analytics - Extract insights from data with statistical analysis",
                  topics: ["Statistical analysis", "Hypothesis testing", "A/B testing", "Data visualization", "Business intelligence", "Reporting", "KPIs", "Dashboards"]
                }
              },
              devops: {
                docker: {
                  description: "Docker - Containerize applications for consistent deployment",
                  topics: ["Containers", "Images", "Dockerfile", "Docker Compose", "Networking", "Volumes", "Multi-stage builds", "Best practices"]
                },
                kubernetes: {
                  description: "Kubernetes - Orchestrate and manage containerized workloads",
                  topics: ["Pods", "Services", "Deployments", "ConfigMaps", "Secrets", "Scaling", "Helm", "Monitoring", "Ingress"]
                },
                aws: {
                  description: "AWS - Deploy scalable cloud infrastructure on Amazon Web Services",
                  topics: ["EC2", "S3", "Lambda", "RDS", "CloudFormation", "IAM", "VPC", "Architecture design", "Cost optimization"]
                },
                gcp: {
                  description: "Google Cloud - Build applications on Google Cloud Platform",
                  topics: ["Compute Engine", "Cloud Functions", "BigQuery", "Cloud Storage", "Kubernetes Engine", "IAM", "Cloud Run", "Pub/Sub"]
                },
                azure: {
                  description: "Azure - Create enterprise solutions with Microsoft Azure",
                  topics: ["Virtual Machines", "App Service", "Azure Functions", "Cosmos DB", "Azure DevOps", "Active Directory", "Storage", "Networking"]
                },
                cicd: {
                  description: "CI/CD Pipelines - Automate testing and deployment workflows",
                  topics: ["Pipeline design", "Automated testing", "Deployment strategies", "GitOps", "Jenkins", "GitHub Actions", "GitLab CI", "ArgoCD"]
                }
              },
              mobile: {
                reactnative: {
                  description: "React Native - Build cross-platform apps with React for mobile",
                  topics: ["React Native components", "Navigation", "State management", "Native modules", "Expo", "Platform-specific code", "Performance", "Debugging"]
                },
                flutter: {
                  description: "Flutter - Create beautiful native apps with Dart framework",
                  topics: ["Widgets", "State management (Provider, Riverpod, Bloc)", "Dart language", "Animations", "Platform integration", "Navigation", "Testing"]
                },
                swift: {
                  description: "Swift (iOS) - Develop native iOS applications with Swift",
                  topics: ["Swift language", "UIKit", "SwiftUI", "Core Data", "Networking", "App lifecycle", "Auto Layout", "App Store guidelines"]
                },
                kotlin: {
                  description: "Kotlin (Android) - Build modern Android apps with Kotlin language",
                  topics: ["Kotlin language", "Jetpack Compose", "Activities", "Fragments", "Room database", "MVVM", "Coroutines", "Navigation"]
                },
                xamarin: {
                  description: "Xamarin - Create cross-platform apps with C# and .NET",
                  topics: ["C#", ".NET", "XAML", "Xamarin.Forms", "Native API access", "MVVM", "Platform-specific code", "Testing"]
                },
                ionic: {
                  description: "Ionic - Build hybrid mobile apps with web technologies",
                  topics: ["Angular/React/Vue integration", "Capacitor", "Hybrid apps", "Web technologies", "Native plugins", "PWA", "Theming", "Performance"]
                }
              },
              productmgmt: {
                strategy: {
                  description: "Product Strategy - Define vision, goals, and product roadmaps",
                  topics: ["Vision setting", "Market analysis", "Competitive positioning", "Product-market fit", "Roadmap prioritization", "OKRs", "Go-to-market strategy"]
                },
                research: {
                  description: "User Research - Understand user needs through research and testing",
                  topics: ["User interviews", "Surveys", "Usability testing", "Personas", "Journey mapping", "A/B testing", "Analytics interpretation", "Feedback loops"]
                },
                analytics: {
                  description: "Product Analytics - Make data-driven decisions with metrics and KPIs",
                  topics: ["Metrics definition", "KPIs", "Funnel analysis", "Cohort analysis", "Retention metrics", "Data-driven decisions", "Dashboards", "Experimentation"]
                },
                roadmap: {
                  description: "Roadmap Planning - Prioritize features and plan product releases",
                  topics: ["Feature prioritization", "Release planning", "Stakeholder alignment", "Resource allocation", "Timeline estimation", "Dependencies", "Trade-offs"]
                },
                stakeholder: {
                  description: "Stakeholder Mgmt - Align teams and communicate with stakeholders",
                  topics: ["Executive communication", "Cross-functional collaboration", "Conflict resolution", "Alignment strategies", "Presentations", "Status updates"]
                },
                agile: {
                  description: "Agile & Scrum - Manage projects with agile methodologies",
                  topics: ["Sprint planning", "Backlog grooming", "Retrospectives", "User stories", "Estimation techniques", "Agile ceremonies", "Kanban", "Velocity"]
                }
              },
              qa: {
                manual: {
                  description: "Manual Testing - Learn testing fundamentals and test case design",
                  topics: ["Test case design", "Test planning", "Exploratory testing", "Regression testing", "Bug reporting", "Test documentation", "Test scenarios", "Edge cases"]
                },
                automation: {
                  description: "Test Automation - Automate testing with frameworks and best practices",
                  topics: ["Test frameworks", "Page Object Model", "Test data management", "CI integration", "Test reporting", "Best practices", "Maintainability"]
                },
                selenium: {
                  description: "Selenium - Perform browser automation and web testing",
                  topics: ["WebDriver", "Locators", "Waits (implicit/explicit)", "Cross-browser testing", "Selenium Grid", "Framework integration", "Handling alerts/frames"]
                },
                performance: {
                  description: "Performance Testing - Test application speed, scalability, and stability",
                  topics: ["Load testing", "Stress testing", "JMeter", "k6", "Performance metrics", "Bottleneck identification", "Optimization", "Monitoring"]
                },
                security: {
                  description: "Security Testing - Identify vulnerabilities and security flaws",
                  topics: ["OWASP Top 10", "Penetration testing", "Vulnerability assessment", "Security scanning tools", "Secure coding", "Authentication testing", "SQL injection"]
                },
                api: {
                  description: "API Testing - Validate REST APIs and microservices endpoints",
                  topics: ["REST API testing", "Postman", "Request/response validation", "Authentication testing", "Contract testing", "Mocking", "Status codes", "Error handling"]
                }
              }
            }

            const topicData = courseMap[courseName]?.[courseSubject]
            const topicDescription = topicData?.description || `${courseName} ${courseSubject} development`
            const topicsList = topicData?.topics || []

            courseContext = `\n\n🎯 COURSE FOCUS: ${courseName.toUpperCase()} - ${courseSubject.toUpperCase()}

TOPIC: ${topicDescription}

KEY TOPICS TO ASK ABOUT:
${topicsList.map((t, i) => `${i + 1}. ${t}`).join('\n')}

YOUR QUESTIONS MUST:
1. Be directly related to the KEY TOPICS listed above
2. Cover practical, real-world scenarios specific to ${courseSubject}
3. Test understanding of ${courseSubject} concepts, not generic programming
4. Ask about best practices, common challenges, and optimization

⚠️ DO NOT ask questions about other technologies or generic programming.

DIFFICULTY: ${difficulty}
Previous questions (avoid repetition):
${previousAnswers.map((qa: any, idx: number) => `${idx + 1}. ${qa.question}`).join("\n")}`
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
          isDSAInterview
            ? `${interviewContext}${difficultyContext}

This is coding problem number ${questionNumber} out of ${questionCount}.
${previousContext}

CRITICAL: You are generating a CODING PROBLEM for ${courseSubject.toUpperCase()}, not a conversational question.

REQUIRED FORMAT:
**Problem:** [Clear problem statement - MUST be about ${courseSubject}]

**Example:**
Input: [example input]
Output: [example output]

**Constraints:**
- [time/space complexity requirements]
- [input size/range]

Generate ONE unique ${courseSubject} coding problem. Make it different from any previous problems in this interview.`
            : isAptitude
            ? `${interviewContext}${difficultyContext}

This is aptitude problem number ${questionNumber} out of ${questionCount}.
${previousContext}

CRITICAL: You are generating an APTITUDE PROBLEM for ${courseSubject.toUpperCase()}, NOT a coding problem.

Generate ONE clear, concise ${courseSubject} aptitude problem. Return ONLY the problem statement.`
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
