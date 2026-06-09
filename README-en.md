# Trellis Workflow Templates

Reusable Claude Code Workflow scripts that integrate with Trellis task management.

## Installation

Install target resolution:

1. `TRELLIS_WORKFLOW_INSTALL_DIR`, when set
2. Project-level `.claude/workflows` for the nearest Trellis-initialized project found by walking up from the current directory
3. Project-level `.claude/workflows` for `--project-dir` / `TRELLIS_WORKFLOW_PROJECT_DIR`, when provided
4. Global `~/.claude/workflows`, only when `--global` is passed or the interactive prompt is accepted

A Trellis-initialized project is detected by `.trellis/`, matching the Trellis skills installer behavior.

The single installer supports both local clone installs and fully online installs. When it runs from a git clone, it uses the local workflow files. When it runs from a GitHub raw download, it downloads the repository archive and installs from that archive.

### From a git clone

```sh
git clone https://github.com/coldwateryi/trellis-claude-workflow.git
cd trellis-claude-workflow
bash scripts/install-trellis-workflows.sh --project-dir /path/to/trellis-project
```

```powershell
git clone https://github.com/coldwateryi/trellis-claude-workflow.git
cd trellis-claude-workflow
powershell -ExecutionPolicy Bypass -File scripts/install-trellis-workflows.ps1 -ProjectDir "C:\path\to\trellis-project"
```

If you run the installer from inside a Trellis-initialized project, `--project-dir` is optional and the installer targets that project. To install globally instead:

```sh
bash scripts/install-trellis-workflows.sh --global
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-trellis-workflows.ps1 -Global
```

Override the target directory directly when needed:

```sh
bash scripts/install-trellis-workflows.sh --target-dir /path/to/.claude/workflows
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-trellis-workflows.ps1 -TargetDir "C:\path\to\.claude\workflows"
```

### Fully online from GitHub

```sh
curl -fsSL https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.sh | bash -s -- --project-dir /path/to/trellis-project
```

```powershell
$script = "$env:TEMP\install-trellis-workflow.ps1"
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.ps1 -OutFile $script
powershell -ExecutionPolicy Bypass -File $script -ProjectDir "C:\path\to\trellis-project"
```

Pin a branch, tag, or commit:

```sh
curl -fsSL https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.sh | bash -s -- --project-dir /path/to/trellis-project --ref main
```

```powershell
$script = "$env:TEMP\install-trellis-workflow.ps1"
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.ps1 -OutFile $script
powershell -ExecutionPolicy Bypass -File $script -ProjectDir "C:\path\to\trellis-project" -Ref main
```

Online global install:

```sh
curl -fsSL https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.sh | bash -s -- --global
```

```powershell
$script = "$env:TEMP\install-trellis-workflow.ps1"
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/coldwateryi/trellis-claude-workflow/main/scripts/install-trellis-workflows.ps1 -OutFile $script
powershell -ExecutionPolicy Bypass -File $script -Global
```

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
- Each research agent uses the Trellis core `trellis-research` agentType (web + codebase search; research has no trellis-skills equivalent)
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

### Execution layer (core agents vs trellis-skills)

Each implement/check workflow takes an `executor` arg (default `'core'`):

- **`'core'`** — dispatches the Trellis core sub-agents (`agentType: trellis-implement` / `trellis-check`), shipped by Trellis itself under `.claude/agents/`. They load task context via the Trellis hook/agent protocol. This is the default and matches stock Trellis behavior.
- **`'skill'`** — dispatches a generic workflow sub-agent and injects the [trellis-skills](https://github.com/coldwateryi/trellis-skills) enhancement skills into the prompt: `$trellis-implement-tdd` (RED→GREEN→REFACTOR, falling back to `$trellis-debug-systematic` on stuck-red), and `$trellis-review-twostage` for verification.

The two layers are parallel paths, not nested: the core `trellis-implement` / `trellis-check` agents have no Skill tool, so they cannot call the skills — pick one layer per run via `executor`. Research always uses the core `trellis-research` agent (trellis-skills has no research-phase equivalent).

```javascript
Workflow({
  name: 'trellis-dag-implement',
  args: {
    parentPath: '...',
    tasks: [ /* ... */ ],
    executor: 'skill',   // omit for default 'core'
  }
})
```

#### Triggering it from a prompt

In practice you rarely hand-write `args` — you state your intent in the main session in natural language, and the main loop translates it into a `Workflow(...)` call. The value of `executor` is inferred from signal words in your prompt:

| What you say | Inferred `executor` |
|---|---|
| "implement this task tree with a workflow" / "implement the children of XXX in dependency order" | `'core'` (default — no execution method mentioned means core agents) |
| "implement via TDD red-green loop" / "use the trellis-skills TDD flow" / "a small model is running this" | `'skill'` |
| "set executor to skill" / "use core agents this time, no skills" | explicit lock — done as you say |

Rule of thumb:

- **Unsure / using a strong model / want the native Trellis experience** → mention nothing, defaults to `'core'`, following the upstream hook/agent protocol.
- **Execution layer is a small model (e.g. qwen3.6 35b), or you want the "done = test goes green" mechanical guardrail** → put "TDD / red-green loop / small model / trellis-skills" in your prompt to trigger `'skill'`, where `$trellis-implement-tdd` clamps implementation into an AC-by-AC red-green loop.

End-to-end example (strong model plans + small model executes):

```
You: [paste PRD] /trellis-zero-to-mvp
        → strong model splits a parent/child task tree, annotates complexity
You: Confirm the task tree. Execution phase uses qwen3.6 35b, so implement via TDD red-green loop
        → main loop generates Workflow({ name:'trellis-dag-implement', args:{ ..., executor:'skill' } })
        → in each child task the small model is "clamped" by $trellis-implement-tdd, only chasing "make the assertion green", switching to $trellis-debug-systematic on stuck-red
You: (if a wave fails) fix 04-user-api then continue the remaining waves
You: all green, commit
```

For the same task tree executed by a strong model, just say "confirmed, implement with the workflow" — omit `executor` and it runs the default `'core'`.

### Trellis context injection

Every subagent prompt starts with `Active task: ${taskPath}`.
This tells the core agents (`trellis-implement` / `trellis-check` / `trellis-research`) or the injected `$trellis-implement-tdd` / `$trellis-review-twostage` skills where to find:
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
| Single complex task | Direct `trellis-implement` agent (or `$trellis-implement-tdd` skill) | no workflow needed |
