export const meta = {
  name: 'trellis-dag-implement',
  description: 'Execute dependent Trellis child tasks in topological wave order',
  whenToUse: 'When child tasks have dependencies and must execute in correct order with maximum parallelism',
  phases: [
    { title: 'Plan', detail: 'Compute execution waves from dependency graph' },
    { title: 'Execute', detail: 'Implement each wave in parallel, verify, then next wave' },
    { title: 'Integrate', detail: 'Cross-task integration check after all waves complete' },
  ],
}

// --- Configuration via args ---
// args.tasks:       [{key, path, deps: string[], specs?: string[]}] - child tasks with dependency keys and optional spec paths
// args.parentPath:  string - parent task directory for cross-task context
// args.worktree:    boolean - use worktree isolation within each wave (default: true)
// args.stopOnFail:  boolean - halt all downstream waves on failure (default: true)
// args.globalSpecs: string[] - spec files injected into ALL subagents (e.g. shared coding standards)

const tasks = args.tasks
const parentPath = args.parentPath
const stopOnFail = args.stopOnFail ?? true
const useWorktree = args.worktree ?? true
const globalSpecs = args.globalSpecs || []

// --- Phase 1: Topological sort into waves ---
phase('Plan')

function computeWaves(taskList) {
  const remaining = [...taskList]
  const completed = new Set()
  const waves = []

  while (remaining.length > 0) {
    const ready = remaining.filter(t =>
      t.deps.every(d => completed.has(d))
    )
    if (ready.length === 0) {
      log(`ERROR: circular dependency detected among: ${remaining.map(t => t.key).join(', ')}`)
      return waves
    }
    waves.push(ready)
    ready.forEach(t => {
      completed.add(t.key)
      remaining.splice(remaining.indexOf(t), 1)
    })
  }
  return waves
}

const waves = computeWaves(tasks)
log(`Dependency graph resolved: ${waves.length} waves, ${tasks.length} total tasks`)
waves.forEach((w, i) => log(`  Wave ${i + 1}: [${w.map(t => t.key).join(', ')}]`))

// --- Phase 2: Execute waves sequentially, tasks within each wave in parallel ---
phase('Execute')

const allResults = {}
let halted = false

for (let i = 0; i < waves.length; i++) {
  if (halted) break

  const wave = waves[i]
  log(`Wave ${i + 1}/${waves.length}: executing [${wave.map(t => t.key).join(', ')}]`)

  const waveResults = await parallel(
    wave.map((task) => () => {
      const taskSpecs = [...globalSpecs, ...(task.specs || [])]
      const specInstructions = taskSpecs.length
        ? `\nRead these spec files FIRST for coding guidelines:\n${taskSpecs.map(s => `- ${s}`).join('\n')}\n`
        : ''

      return agent(
        `Active task: ${task.path}
${specInstructions}Read the task's implement.jsonl and prd.md for full context.
This task depends on: ${task.deps.length ? task.deps.join(', ') : 'nothing (no dependencies)'}.
${task.deps.length ? 'Those dependencies are already implemented and verified.' : ''}

Implement this task fully. Follow existing code patterns. Write unit tests.
After implementation, run type-check and tests to verify correctness.
Return the files changed, test results, and a summary.`,
        {
          label: `wave${i + 1}:${task.key}`,
          phase: 'Execute',
          ...(useWorktree && wave.length > 1 ? { isolation: 'worktree' } : {}),
          agentType: 'trellis-implement',
          schema: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              files: { type: 'array', items: { type: 'string' } },
              passed: { type: 'boolean' },
              testResults: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['key', 'files', 'passed', 'summary'],
          },
        }
      )
    })
  )

  // Record results and check for failures
  const waveValid = waveResults.filter(Boolean)
  wave.forEach((task, j) => {
    allResults[task.key] = waveValid[j] || { key: task.key, passed: false, files: [], summary: 'agent returned null' }
  })

  const waveFailed = waveValid.filter(r => !r.passed)
  if (waveFailed.length > 0 && stopOnFail) {
    log(`Wave ${i + 1} has ${waveFailed.length} failures. Halting downstream waves.`)
    halted = true
  }
}

// --- Phase 3: Integration check ---
phase('Integrate')

const completedKeys = Object.keys(allResults)
const allPassed = Object.values(allResults).every(r => r.passed)

if (halted) {
  log(`Halted after wave failures. Completed: ${completedKeys.length}/${tasks.length}`)
} else if (allPassed) {
  log('All waves passed. Running cross-task integration check.')

  await agent(
    `Active task: ${parentPath}
All child tasks have been implemented:
${Object.entries(allResults).map(([k, v]) => `- ${k}: ${v.summary}`).join('\n')}

Run a cross-module integration check:
1. Verify imports between modules resolve correctly
2. Run the full test suite (not just per-module)
3. Check for type errors across module boundaries
Report any integration issues found.`,
    {
      label: 'integration-check',
      phase: 'Integrate',
      agentType: 'trellis-check',
    }
  )
}

return {
  waves: waves.length,
  completed: completedKeys.length,
  total: tasks.length,
  halted,
  allPassed,
  results: allResults,
}
