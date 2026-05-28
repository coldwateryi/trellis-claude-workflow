export const meta = {
  name: 'trellis-parallel-implement',
  description: 'Parallel implementation of independent modules from a Trellis task implement.md',
  whenToUse: 'When a Trellis task has multiple independent implementation steps that can run in parallel',
  phases: [
    { title: 'Implement', detail: 'One agent per module, optionally in isolated worktrees' },
    { title: 'Verify', detail: 'Type-check, lint, and test each module immediately after implementation' },
  ],
}

// --- Configuration via args ---
// args.taskPath:    string  - path to the active Trellis task directory
// args.modules:     array   - [{key, desc, specs?: string[]}] list of independent implementation units
// args.worktree:    boolean - whether to use worktree isolation (default: true for 3+ modules)
// args.verifyCmd:   string  - custom verify command (default: type-check + lint + test)
// args.globalSpecs: string[] - spec files injected into ALL subagents

const taskPath = args.taskPath
const modules = args.modules
const useWorktree = args.worktree ?? modules.length >= 3
const globalSpecs = args.globalSpecs || []

phase('Implement')
log(`Starting parallel implementation of ${modules.length} modules (worktree: ${useWorktree})`)

const results = await pipeline(
  modules,
  // Stage 1: Implement each module
  (_, mod, idx) => {
    const modSpecs = [...globalSpecs, ...(mod.specs || [])]
    const specInstructions = modSpecs.length
      ? `\nRead these spec files FIRST for coding guidelines:\n${modSpecs.map(s => `- ${s}`).join('\n')}\n`
      : ''

    return agent(
      `Active task: ${taskPath}
${specInstructions}Read the task's implement.jsonl for full context, then implement the "${mod.key}" module.

Requirements: ${mod.desc}

Follow existing code patterns. Write unit tests for new logic.
Return the list of files you created or modified and a one-line summary.`,
      {
        label: `impl:${mod.key}`,
        phase: 'Implement',
        ...(useWorktree ? { isolation: 'worktree' } : {}),
        agentType: 'trellis-implement',
        schema: {
          type: 'object',
          properties: {
            files: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['files', 'summary'],
        },
      }
    )
  },
  // Stage 2: Verify each module immediately after implementation
  (implResult, mod) => agent(
    `Active task: ${taskPath}
Verify the "${mod.key}" module implementation.
Files changed: ${implResult.files.join(', ')}
Run type-check, lint, and unit tests for these files.
${args.verifyCmd ? 'Custom verify command: ' + args.verifyCmd : ''}
Report whether all checks pass and list any issues found.`,
    {
      label: `verify:${mod.key}`,
      phase: 'Verify',
      agentType: 'trellis-check',
      schema: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['passed', 'issues'],
      },
    }
  )
)

// Summarize results
const valid = results.filter(Boolean)
const passed = valid.filter(r => r.passed)
const failed = valid.filter(r => !r.passed)

if (failed.length) {
  log(`${failed.length}/${modules.length} modules need fixes`)
} else {
  log(`All ${modules.length} modules implemented and verified`)
}

return {
  total: modules.length,
  passed: passed.length,
  failed: failed.length,
  modules: modules.map((mod, i) => ({
    key: mod.key,
    result: valid[i] || null,
  })),
}
