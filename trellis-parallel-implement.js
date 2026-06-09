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
// args.executor:    'core' | 'skill' - which execution layer to drive each agent (default: 'core')
//                   'core'  -> Trellis core sub-agents (agentType trellis-implement / trellis-check)
//                   'skill' -> generic workflow sub-agent driven by trellis-skills ($trellis-implement-tdd /
//                              $trellis-debug-systematic / $trellis-review-twostage)

const taskPath = args.taskPath
const modules = args.modules
const moduleCount = Array.isArray(modules) ? modules.length : 0
const useWorktree = args.worktree ?? moduleCount >= 3
const globalSpecs = args.globalSpecs || []
const executor = args.executor === 'skill' ? 'skill' : 'core'

// Build the implement/verify directives + agent options for the active executor.
// core  -> Trellis core trellis-implement / trellis-check sub-agents (no skill injection)
// skill -> generic sub-agent told to drive the trellis-skills TDD/debug/review skills
function implementDirective(modKey) {
  return executor === 'skill'
    ? `Use the $trellis-implement-tdd skill to implement the "${modKey}" module with strict TDD (RED→GREEN→REFACTOR), one acceptance criterion at a time. If a test stays red and the cause is not obvious, switch to the $trellis-debug-systematic skill.\n\n`
    : ''
}

function implementAgentType() {
  return executor === 'skill' ? {} : { agentType: 'trellis-implement' }
}

function verifyDirective(modKey) {
  return executor === 'skill'
    ? `Use the $trellis-review-twostage skill to review the "${modKey}" module before marking it complete: Stage 1 spec compliance against prd.md, then Stage 2 code-quality review.\n`
    : ''
}

function verifyAgentType() {
  return executor === 'skill' ? {} : { agentType: 'trellis-check' }
}

phase('Implement')

function validateModules(moduleList) {
  if (!Array.isArray(moduleList)) {
    return ['args.modules must be a non-empty array']
  }
  if (moduleList.length === 0) {
    return ['args.modules must include at least one module']
  }

  const issues = []
  const keys = new Set()
  moduleList.forEach((mod, idx) => {
    if (!mod || typeof mod !== 'object') {
      issues.push(`module at index ${idx} must be an object`)
      return
    }
    if (!mod.key || typeof mod.key !== 'string') {
      issues.push(`module at index ${idx} is missing a string key`)
    } else if (keys.has(mod.key)) {
      issues.push(`duplicate module key: ${mod.key}`)
    } else {
      keys.add(mod.key)
    }
    if (!mod.desc || typeof mod.desc !== 'string') {
      issues.push(`module ${mod.key || idx} is missing a string desc`)
    }
  })
  return issues
}

function normalizeImplementationResult(mod, result) {
  if (!result || typeof result !== 'object') {
    return {
      valid: false,
      files: [],
      summary: 'implementation agent returned null or invalid result',
      issues: ['implementation agent returned null or invalid result'],
    }
  }

  const issues = []
  if (!Array.isArray(result.files)) {
    issues.push('implementation agent did not return files')
  }
  if (typeof result.summary !== 'string') {
    issues.push('implementation agent did not return summary')
  }

  return {
    valid: issues.length === 0,
    files: Array.isArray(result.files) ? result.files : [],
    summary: typeof result.summary === 'string' ? result.summary : `implementation for ${mod.key} did not return summary`,
    issues,
  }
}

function normalizeVerificationResult(result) {
  if (!result || typeof result !== 'object') {
    return {
      passed: false,
      issues: ['verification agent returned null or invalid result'],
      summary: 'verification check did not return a result',
    }
  }

  const issues = Array.isArray(result.issues) ? [...result.issues] : ['verification agent did not return issues']
  return {
    passed: result.passed === true && issues.length === 0,
    issues,
    summary: typeof result.summary === 'string' ? result.summary : '',
  }
}

const validationIssues = validateModules(modules)
if (validationIssues.length) {
  validationIssues.forEach(issue => log(`ERROR: ${issue}`))

  return {
    total: moduleCount,
    passed: 0,
    failed: moduleCount,
    issues: validationIssues,
    modules: Array.isArray(modules) ? modules.map(mod => ({ key: mod?.key || '', result: null })) : [],
  }
}

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
${specInstructions}${implementDirective(mod.key)}Read the task's implement.jsonl for full context.

Requirements: ${mod.desc}

Follow existing code patterns. Write unit tests for new logic.
Return the list of files you created or modified and a one-line summary.`,
      {
        label: `impl:${mod.key}`,
        phase: 'Implement',
        ...(useWorktree ? { isolation: 'worktree' } : {}),
        ...implementAgentType(),
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
  (implResult, mod) => {
    const implementation = normalizeImplementationResult(mod, implResult)
    if (!implementation.valid) {
      return {
        passed: false,
        issues: implementation.issues,
        summary: implementation.summary,
      }
    }

    return agent(
      `Active task: ${taskPath}
${verifyDirective(mod.key)}Files changed: ${implementation.files.join(', ')}
Run type-check, lint, and unit tests for these files.
${args.verifyCmd ? 'Custom verify command: ' + args.verifyCmd : ''}
Report whether all checks pass and list any issues found.`,
      {
        label: `verify:${mod.key}`,
        phase: 'Verify',
        ...verifyAgentType(),
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
  }
)

// Summarize results
const normalizedResults = modules.map((_, i) => normalizeVerificationResult(Array.isArray(results) ? results[i] : null))
const passed = normalizedResults.filter(r => r.passed)
const failed = normalizedResults.filter(r => !r.passed)

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
    result: normalizedResults[i],
  })),
}
