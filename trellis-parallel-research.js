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

const taskPath = args.taskPath
const questions = args.questions

phase('Research')
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
const validFindings = findings.filter(Boolean)
log(`Synthesizing ${validFindings.length} research results`)

const synthesis = await agent(
  `Active task: ${taskPath}
You have ${validFindings.length} research findings to synthesize.

${JSON.stringify(validFindings, null, 2)}

Write a decision report: for each question, state the recommendation and confidence.
End with an overall recommendation considering all findings together.
Write the output as markdown suitable for ${args.outputFile || 'research/synthesis.md'}.`,
  {
    label: 'synthesize',
    phase: 'Synthesize',
  }
)

return {
  findings: validFindings,
  synthesis,
  outputFile: args.outputFile || 'research/synthesis.md',
}
