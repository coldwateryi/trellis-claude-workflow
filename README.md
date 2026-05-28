# Trellis Workflow Templates

Reusable Claude Code Workflow scripts that integrate with Trellis task management.

## Available Workflows

### trellis-parallel-implement

Parallel implementation of independent modules from a Trellis task's `implement.md`.

**When to use:** Phase 2 (Execute) with 2+ independent implementation steps.

**Invocation:**

```
Workflow({
  name: 'trellis-parallel-implement',
  args: {
    taskPath: '.trellis/tasks/05-28-api-i18n',
    modules: [
      { key: 'middleware', desc: 'Request language detection middleware' },
      { key: 'response', desc: 'Response wrapper with i18n key replacement' },
      { key: 'errors', desc: 'Error message internationalization' },
    ],
    worktree: true,       // optional, default: true when 3+ modules
    verifyCmd: 'npm test' // optional, custom verify command
  }
})
```

**Behavior:**
- Uses `pipeline()` — each module verifies immediately after implementation
- `isolation: 'worktree'` prevents file conflicts between parallel agents
- Each agent gets Trellis context via `implement.jsonl`
- Returns `{total, passed, failed, modules}` for the main loop to act on

---

### trellis-parallel-research

Fan-out research across multiple questions, synthesize into a decision report.

**When to use:** Phase 1.2 (Research) exploring multiple technical directions.

**Invocation:**

```
Workflow({
  name: 'trellis-parallel-research',
  args: {
    taskPath: '.trellis/tasks/05-28-api-i18n',
    questions: [
      { key: 'lib', question: 'Best i18n library for Node.js in 2026?' },
      { key: 'format', question: 'ICU vs gettext vs custom format?' },
      { key: 'perf', question: 'Runtime translation lookup performance?' },
    ],
    outputFile: 'research/i18n-decisions.md' // optional
  }
})
```

**Behavior:**
- Uses `parallel()` with barrier — synthesis needs ALL findings together
- Each research agent uses `trellis-research` agentType (web + codebase search)
- Final synthesis agent writes a decision report
- Returns `{findings, synthesis, outputFile}`

---

## Design Principles

### Why pipeline() is the default

```
pipeline: item完成即进入下一阶段     parallel+barrier: 等所有item完成才继续
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ A: [impl][verify] ✓          │   │ A: [impl]----wait----[verify]│
│ B: [==impl==][verify] ✓      │   │ B: [==impl==]-wait--[verify]│
│ C: [impl][verify] ✓          │   │ C: [impl]----wait----[verify]│
└──────────────────────────────┘   └──────────────────────────────┘
  wall-clock = max(single chain)     wall-clock = sum(max per stage)
```

Use `parallel()` barrier ONLY when:
- Synthesis needs cross-item context (research → merge)
- Dedup across all results before expensive next stage
- Early-exit if total count is zero

### Trellis context injection

Every subagent prompt starts with `Active task: ${taskPath}`.
This tells `trellis-implement` / `trellis-check` where to find:
- `implement.jsonl` — file list and role context
- `prd.md` — acceptance criteria
- `design.md` — architectural constraints

### Worktree isolation

Use `isolation: 'worktree'` when:
- 3+ agents write files in parallel
- Agents modify overlapping directories
- You want atomic rollback per module

Skip worktree when:
- Agents only read (research, review)
- Single agent at a time (sequential pipeline)
- Changes are to non-overlapping files

---

## Creating Custom Workflows

Copy a template and modify. Key rules:

1. `meta` must be a pure literal (no variables, no interpolation)
2. Use `args` for all runtime parameters
3. Every `agent()` prompt starts with `Active task: ${taskPath}`
4. Use `schema` for structured output — no string parsing
5. Use `log()` for progress visibility
6. Return a summary object the main loop can act on

---

### trellis-dag-implement

Execute dependent child tasks in topological wave order with maximum parallelism.

**When to use:** After `/trellis-zero-to-mvp-zh` creates a parent/child task tree with inter-task dependencies.

**Invocation:**

```
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '.trellis/tasks/00-mvp-parent',
    tasks: [
      { key: 'auth-model',      path: '.trellis/tasks/01-auth-model',      deps: [] },
      { key: 'auth-middleware',  path: '.trellis/tasks/02-auth-middleware', deps: ['auth-model'] },
      { key: 'user-api',        path: '.trellis/tasks/03-user-api',        deps: ['auth-model'] },
      { key: 'user-ui',         path: '.trellis/tasks/04-user-ui',         deps: ['user-api', 'auth-middleware'] },
    ],
    stopOnFail: true,  // halt downstream waves on failure (default: true)
    worktree: true     // isolate parallel agents in same wave (default: true)
  }
})
```

**Behavior:**

```
DAG:  auth-model → auth-middleware → user-ui
      auth-model → user-api ──────→ user-ui

Waves:
  Wave 1: [auth-model]                    ← sequential (single task)
  Wave 2: [auth-middleware, user-api]     ← parallel (independent)
  Wave 3: [user-ui]                       ← waits for Wave 2
```

- Topological sort computes waves at runtime (detects circular deps)
- Same-wave tasks run via `parallel()` with worktree isolation
- `stopOnFail: true` halts all downstream waves if any task fails
- Final integration check verifies cross-module boundaries
- Returns `{waves, completed, total, halted, allPassed, results}`

---

## Choosing the Right Template

| Scenario | Template | Why |
|----------|----------|-----|
| Independent modules, no deps | `trellis-parallel-implement` | pipeline, fastest |
| Tasks with dependency order | `trellis-dag-implement` | wave-based DAG |
| Multi-direction research | `trellis-parallel-research` | barrier + synthesis |
| Single complex task | Direct `trellis-implement` | no workflow needed |
