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
// args.executor:    'core' | 'skill' - which execution layer to drive each agent (default: 'core')
//                   'core'  -> Trellis core sub-agents (agentType trellis-implement / trellis-check)
//                   'skill' -> generic workflow sub-agent driven by trellis-skills ($trellis-implement-tdd /
//                              $trellis-debug-systematic / $trellis-review-twostage)

const tasks = args.tasks
const parentPath = args.parentPath
const stopOnFail = args.stopOnFail ?? true
const useWorktree = args.worktree ?? true
const globalSpecs = args.globalSpecs || []
const executor = args.executor === 'skill' ? 'skill' : 'core'

// Build the implement-step prompt body + agent options for the active executor.
// core  -> Trellis core `trellis-implement` sub-agent (no skill injection; it loads context itself)
// skill -> generic sub-agent told to drive the trellis-skills TDD/debug skills
function implementDirective() {
  return executor === 'skill'
    ? 'Use the $trellis-implement-tdd skill to implement this subtask with strict TDD (RED→GREEN→REFACTOR), one acceptance criterion at a time. If a test stays red and the cause is not obvious, switch to the $trellis-debug-systematic skill.\n\n'
    : ''
}

function implementAgentType() {
  return executor === 'skill' ? {} : { agentType: 'trellis-implement' }
}

function checkDirective() {
  return executor === 'skill'
    ? 'Apply the $trellis-review-twostage skill: '
    : ''
}

function checkAgentType() {
  return executor === 'skill' ? {} : { agentType: 'trellis-check' }
}

// --- Phase 1: Topological sort into waves ---
phase('Plan')

function validateTasks(taskList) {
  if (!Array.isArray(taskList)) {
    return ['args.tasks must be a non-empty array']
  }
  if (taskList.length === 0) {
    return ['args.tasks must include at least one task']
  }

  const issues = []
  const keys = new Set()

  taskList.forEach((task, idx) => {
    if (!task || typeof task !== 'object') {
      issues.push(`task at index ${idx} must be an object`)
      return
    }

    if (!task.key || typeof task.key !== 'string') {
      issues.push(`task at index ${idx} is missing a string key`)
    } else if (keys.has(task.key)) {
      issues.push(`duplicate task key: ${task.key}`)
    } else {
      keys.add(task.key)
    }

    if (!task.path || typeof task.path !== 'string') {
      issues.push(`task ${task.key || idx} is missing a string path`)
    }

    if (!Array.isArray(task.deps)) {
      issues.push(`task ${task.key || idx} deps must be an array`)
    }
  })

  taskList.forEach((task) => {
    if (!task || typeof task !== 'object' || !Array.isArray(task.deps)) return

    task.deps.forEach((dep) => {
      if (!keys.has(dep)) {
        issues.push(`task ${task.key} depends on unknown task: ${dep}`)
      }
    })
  })

  return issues
}

function computeWaves(taskList) {
  const remaining = [...taskList]
  const completed = new Set()
  const waves = []

  while (remaining.length > 0) {
    const ready = remaining.filter(t =>
      t.deps.every(d => completed.has(d))
    )
    if (ready.length === 0) {
      return {
        waves,
        issues: [`circular dependency detected among: ${remaining.map(t => t.key).join(', ')}`],
      }
    }
    waves.push(ready)
    ready.forEach(t => {
      completed.add(t.key)
      remaining.splice(remaining.indexOf(t), 1)
    })
  }
  return { waves, issues: [] }
}

function normalizeTaskResult(task, result) {
  if (!result || typeof result !== 'object') {
    return {
      key: task.key,
      files: [],
      passed: false,
      testResults: '',
      summary: 'agent returned null or invalid result',
      issues: ['agent returned null or invalid result'],
    }
  }

  const issues = Array.isArray(result.issues) ? [...result.issues] : []
  if (result.key && result.key !== task.key) {
    issues.push(`agent returned key ${result.key}, expected ${task.key}`)
  }
  if (!Array.isArray(result.files)) {
    issues.push('agent did not return files')
  }
  if (typeof result.summary !== 'string') {
    issues.push('agent did not return summary')
  }

  return {
    key: task.key,
    files: Array.isArray(result.files) ? result.files : [],
    passed: result.passed === true && issues.length === 0,
    testResults: typeof result.testResults === 'string' ? result.testResults : '',
    summary: typeof result.summary === 'string' ? result.summary : 'agent did not return summary',
    ...(issues.length ? { issues } : {}),
  }
}

function normalizeIntegrationResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      passed: false,
      issues: ['integration agent returned null or invalid result'],
      summary: 'integration check did not return a result',
    }
  }

  const issues = Array.isArray(result.issues) ? [...result.issues] : ['integration agent did not return issues']
  if (typeof result.summary !== 'string') {
    issues.push('integration agent did not return summary')
  }

  return {
    passed: result.passed === true && issues.length === 0,
    issues,
    summary: typeof result.summary === 'string' ? result.summary : 'integration agent did not return summary',
  }
}

const validationIssues = validateTasks(tasks)
const graph = validationIssues.length ? { waves: [], issues: validationIssues } : computeWaves(tasks)
const waves = graph.waves

if (graph.issues.length) {
  graph.issues.forEach(issue => log(`ERROR: ${issue}`))

  return {
    waves: waves.length,
    completed: 0,
    total: Array.isArray(tasks) ? tasks.length : 0,
    halted: true,
    allPassed: false,
    childTasksPassed: false,
    integration: null,
    integrationPassed: false,
    issues: graph.issues,
    results: {},
  }
}

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
${specInstructions}${implementDirective()}Read the task's implement.jsonl and prd.md for full context.
This task depends on: ${task.deps.length ? task.deps.join(', ') : 'nothing (no dependencies)'}.
${task.deps.length ? 'Those dependencies are already implemented and verified.' : ''}

Implement this task fully. Follow existing code patterns. Write unit tests.
After implementation, run type-check and tests to verify correctness.
Return the files changed, test results, and a summary.`,
        {
          label: `wave${i + 1}:${task.key}`,
          phase: 'Execute',
          ...(useWorktree && wave.length > 1 ? { isolation: 'worktree' } : {}),
          ...implementAgentType(),
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
  wave.forEach((task, j) => {
    allResults[task.key] = normalizeTaskResult(task, waveResults[j])
  })

  const waveFailed = wave.map(task => allResults[task.key]).filter(r => !r.passed)
  if (waveFailed.length > 0 && stopOnFail) {
    log(`Wave ${i + 1} has ${waveFailed.length} failures. Halting downstream waves.`)
    halted = true
  }
}

// --- Phase 3: Integration check ---
phase('Integrate')

const completedKeys = Object.keys(allResults)
const childTasksPassed = completedKeys.length === tasks.length && Object.values(allResults).every(r => r.passed)
let integration = null
let allPassed = childTasksPassed

if (halted) {
  log(`Halted after wave failures. Completed: ${completedKeys.length}/${tasks.length}`)
} else if (childTasksPassed) {
  log('All waves passed. Running cross-task integration check.')

  const integrationResult = await agent(
    `Active task: ${parentPath}
All child tasks have been implemented:
${Object.entries(allResults).map(([k, v]) => `- ${k}: ${v.summary}`).join('\n')}

${checkDirective()}Run a cross-module integration check:
1. Verify imports between modules resolve correctly
2. Run the full test suite (not just per-module)
3. Check for type errors across module boundaries
Report any integration issues found.`,
    {
      label: 'integration-check',
      phase: 'Integrate',
      ...checkAgentType(),
      schema: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['passed', 'issues', 'summary'],
      },
    }
  )

  integration = normalizeIntegrationResult(integrationResult)
  allPassed = integration.passed
  if (!integration.passed) {
    log(`Integration check failed: ${integration.issues.join('; ')}`)
  }
}

return {
  waves: waves.length,
  completed: completedKeys.length,
  total: tasks.length,
  halted,
  allPassed,
  childTasksPassed,
  integration,
  integrationPassed: integration ? integration.passed : null,
  results: allResults,
}
