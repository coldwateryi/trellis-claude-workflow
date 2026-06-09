export const meta = {
  name: 'trellis-parallel-research',
  description: 'Fan-out research across multiple questions, synthesize into a single report',
  whenToUse: 'During Trellis Phase 1.2 (Research) when exploring multiple technical directions',
  phases: [
    { title: 'Research', detail: 'One agent per research question' },
    { title: 'Synthesize', detail: 'Merge findings into a structured recommendation' },
  ],
}

// --- Configuration via args ---
// args.taskPath:    string   - path to the active Trellis task directory
// args.questions:   array    - [{key, question}] list of research questions
// args.outputFile:  string   - where to write the synthesis (default: research/synthesis.md)
//
// Research always runs on the Trellis core `trellis-research` sub-agent: it owns the
// research/ persistence contract and there is no trellis-skills research equivalent,
// so this workflow has no `executor` switch (unlike the implement/dag workflows).

const taskPath = args.taskPath
const questions = args.questions
const outputFile = args.outputFile || 'research/synthesis.md'

phase('Research')

function validateQuestions(questionList) {
  if (!Array.isArray(questionList)) {
    return ['args.questions must be a non-empty array']
  }
  if (questionList.length === 0) {
    return ['args.questions must include at least one question']
  }

  const issues = []
  const keys = new Set()
  questionList.forEach((question, idx) => {
    if (!question || typeof question !== 'object') {
      issues.push(`question at index ${idx} must be an object`)
      return
    }
    if (!question.key || typeof question.key !== 'string') {
      issues.push(`question at index ${idx} is missing a string key`)
    } else if (keys.has(question.key)) {
      issues.push(`duplicate question key: ${question.key}`)
    } else {
      keys.add(question.key)
    }
    if (!question.question || typeof question.question !== 'string') {
      issues.push(`question ${question.key || idx} is missing question text`)
    }
  })
  return issues
}

function normalizeFinding(question, result) {
  if (!result || typeof result !== 'object') {
    return {
      key: question.key,
      question: question.question,
      findings: ['Research agent returned null or invalid result.'],
      recommendation: 'Re-run this research question before making a final decision.',
      confidence: 'low',
      sources: [],
      issues: ['research agent returned null or invalid result'],
    }
  }

  const issues = []
  if (!Array.isArray(result.findings)) {
    issues.push('research agent did not return findings')
  }
  if (!result.recommendation || typeof result.recommendation !== 'string') {
    issues.push('research agent did not return recommendation')
  }
  if (!['high', 'medium', 'low'].includes(result.confidence)) {
    issues.push('research agent did not return valid confidence')
  }

  return {
    key: typeof result.key === 'string' ? result.key : question.key,
    question: typeof result.question === 'string' ? result.question : question.question,
    findings: Array.isArray(result.findings) ? result.findings : ['Research result was missing findings.'],
    recommendation: typeof result.recommendation === 'string' ? result.recommendation : 'Re-run this research question.',
    confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'low',
    sources: Array.isArray(result.sources) ? result.sources : [],
    ...(issues.length ? { issues } : {}),
  }
}

const validationIssues = validateQuestions(questions)
if (validationIssues.length) {
  validationIssues.forEach(issue => log(`ERROR: ${issue}`))

  return {
    findings: [],
    synthesis: null,
    outputFile,
    issues: validationIssues,
  }
}

log(`Researching ${questions.length} questions in parallel`)

const findings = await parallel(
  questions.map((q) => () => agent(
    `Active task: ${taskPath}
Research question: ${q.question}

Search the codebase, web, and documentation. Return structured findings.`,
    {
      label: `research:${q.key}`,
      phase: 'Research',
      agentType: 'trellis-research',
      schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          question: { type: 'string' },
          findings: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          confidence: { enum: ['high', 'medium', 'low'] },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'findings', 'recommendation', 'confidence'],
      },
    }
  ))
)

// Barrier needed: synthesis requires ALL research results together
phase('Synthesize')
const normalizedFindings = questions.map((question, i) => normalizeFinding(question, findings[i]))
log(`Synthesizing ${normalizedFindings.length} research results`)

const synthesis = await agent(
  `Active task: ${taskPath}
You have ${normalizedFindings.length} research findings to synthesize.

${JSON.stringify(normalizedFindings, null, 2)}

Write a decision report: for each question, state the recommendation and confidence.
End with an overall recommendation considering all findings together.
Write the decision report to ${outputFile}.
Return the output file path and a concise summary of the decision report.`,
  {
    label: 'synthesize',
    phase: 'Synthesize',
    agentType: 'trellis-research',
    schema: {
      type: 'object',
      properties: {
        outputFile: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['outputFile', 'summary'],
    },
  }
)

return {
  findings: normalizedFindings,
  synthesis,
  outputFile,
}
