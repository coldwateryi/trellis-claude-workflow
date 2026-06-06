import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

async function runWorkflow(file, options = {}) {
  const {
    args = {},
    agent = async () => ({}),
    parallel = async (tasks) => Promise.all(tasks.map(task => task())),
    pipeline = async (items, ...stages) => Promise.all(items.map(async (item, idx) => {
      let value
      for (const stage of stages) {
        value = await stage(value, item, idx)
      }
      return value
    })),
  } = options

  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  const body = source.replace(/^export const meta\s*=/m, 'const meta =')
  const logs = []
  const phases = []
  const agentCalls = []

  const workflow = new AsyncFunction('args', 'phase', 'log', 'parallel', 'pipeline', 'agent', body)
  const result = await workflow(
    args,
    name => phases.push(name),
    message => logs.push(message),
    parallel,
    pipeline,
    async (prompt, config = {}) => {
      agentCalls.push({ prompt, config })
      return agent(prompt, config, agentCalls.length - 1)
    }
  )

  return { result, logs, phases, agentCalls }
}

test('dag workflow rejects unknown dependencies before running agents', async () => {
  const { result, logs, agentCalls } = await runWorkflow('trellis-dag-implement.js', {
    args: {
      parentPath: '.trellis/tasks/parent',
      tasks: [
        { key: 'api', path: '.trellis/tasks/api', deps: ['model'] },
      ],
    },
  })

  assert.equal(result.halted, true)
  assert.equal(result.allPassed, false)
  assert.equal(result.integrationPassed, false)
  assert.deepEqual(result.results, {})
  assert.match(result.issues[0], /unknown task: model/)
  assert.equal(agentCalls.length, 0)
  assert.match(logs.join('\n'), /ERROR/)
})

test('dag workflow keeps same-wave results aligned when an agent returns null', async () => {
  let call = 0
  const { result } = await runWorkflow('trellis-dag-implement.js', {
    args: {
      parentPath: '.trellis/tasks/parent',
      tasks: [
        { key: 'a', path: '.trellis/tasks/a', deps: [] },
        { key: 'b', path: '.trellis/tasks/b', deps: [] },
      ],
      stopOnFail: true,
    },
    agent: async () => {
      call += 1
      if (call === 1) return null
      return { key: 'b', files: ['b.js'], passed: true, summary: 'b done' }
    },
  })

  assert.equal(result.halted, true)
  assert.equal(result.allPassed, false)
  assert.equal(result.completed, 2)
  assert.equal(result.results.a.passed, false)
  assert.equal(result.results.b.passed, true)
  assert.match(result.results.a.summary, /null or invalid/)
})

test('dag workflow includes integration failures in allPassed', async () => {
  const { result, agentCalls } = await runWorkflow('trellis-dag-implement.js', {
    args: {
      parentPath: '.trellis/tasks/parent',
      tasks: [
        { key: 'model', path: '.trellis/tasks/model', deps: [] },
      ],
    },
    agent: async (_prompt, config) => {
      if (config.label === 'integration-check') {
        return { passed: false, issues: ['bad import'], summary: 'integration failed' }
      }
      return { key: 'model', files: ['model.js'], passed: true, summary: 'model done' }
    },
  })

  assert.equal(result.childTasksPassed, true)
  assert.equal(result.integrationPassed, false)
  assert.equal(result.allPassed, false)
  assert.equal(result.integration.summary, 'integration failed')
  assert.equal(agentCalls.at(-1).config.label, 'integration-check')
})

test('parallel implement workflow turns null implementation results into module failures', async () => {
  const { result, agentCalls } = await runWorkflow('trellis-parallel-implement.js', {
    args: {
      taskPath: '.trellis/tasks/feature',
      modules: [
        { key: 'api', desc: 'API module' },
      ],
    },
    agent: async (_prompt, config) => {
      if (config.label === 'impl:api') return null
      return { passed: true, issues: [], summary: 'verified' }
    },
  })

  assert.equal(result.total, 1)
  assert.equal(result.passed, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.modules[0].key, 'api')
  assert.equal(result.modules[0].result.passed, false)
  assert.match(result.modules[0].result.issues[0], /implementation agent returned null/)
  assert.deepEqual(agentCalls.map(call => call.config.label), ['impl:api'])
})

test('research workflow preserves failed findings and asks synthesis to write outputFile', async () => {
  const { result, agentCalls } = await runWorkflow('trellis-parallel-research.js', {
    args: {
      taskPath: '.trellis/tasks/research',
      outputFile: 'research/decision.md',
      questions: [
        { key: 'lib', question: 'Which library?' },
        { key: 'perf', question: 'What performance risks?' },
      ],
    },
    agent: async (_prompt, config) => {
      if (config.label === 'research:lib') return null
      if (config.label === 'research:perf') {
        return {
          key: 'perf',
          question: 'What performance risks?',
          findings: ['Runtime lookup is cheap with caching.'],
          recommendation: 'Cache translations.',
          confidence: 'medium',
          sources: ['local docs'],
        }
      }
      return { outputFile: 'research/decision.md', summary: 'decision written' }
    },
  })

  assert.equal(result.findings.length, 2)
  assert.equal(result.findings[0].key, 'lib')
  assert.equal(result.findings[0].confidence, 'low')
  assert.match(result.findings[0].issues[0], /null or invalid/)
  assert.equal(result.synthesis.outputFile, 'research/decision.md')
  assert.match(agentCalls.at(-1).prompt, /Write the decision report to research\/decision\.md/)
})
