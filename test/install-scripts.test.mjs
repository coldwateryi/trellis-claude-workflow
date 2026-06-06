import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const installSh = 'scripts/install-trellis-workflows.sh'
const installPs1 = 'scripts/install-trellis-workflows.ps1'

const workflowFiles = [
  'trellis-dag-implement.js',
  'trellis-parallel-implement.js',
  'trellis-parallel-research.js',
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    ...options,
  })

  assert.equal(result.status, 0, [
    `${command} ${args.join(' ')} failed`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n'))

  return result
}

function commandExists(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).status === 0
}

const defaultShell = commandExists('bash') ? 'bash' : 'zsh'

test('scripts directory keeps one sh installer and one PowerShell installer', () => {
  const scriptFiles = readdirSync(new URL('../scripts', import.meta.url)).sort()
  assert.deepEqual(scriptFiles, [
    'install-trellis-workflows.ps1',
    'install-trellis-workflows.sh',
  ])
})

test('sh installer is valid in bash and zsh when available', (t) => {
  for (const shell of ['bash', 'zsh']) {
    if (!commandExists(shell)) {
      t.diagnostic(`skipping ${shell}: command not found`)
      continue
    }

    run(shell, ['-n', installSh])
  }
})

test('unified sh installer copies workflow files into the target directory', () => {
  const targetDir = mkdtempSync(join(tmpdir(), 'trellis-workflow-install-'))

  try {
    run(defaultShell, [installSh, '--target-dir', targetDir])
    const installedFiles = new Set(readdirSync(targetDir))

    for (const workflowFile of workflowFiles) {
      assert.equal(installedFiles.has(workflowFile), true)
    }
  } finally {
    rmSync(targetDir, { recursive: true, force: true })
  }
})

test('unified sh installer auto-installs into current Trellis project', () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'trellis-workflow-project-'))
  mkdirSync(join(projectDir, '.trellis'))
  writeFileSync(join(projectDir, '.trellis', 'config.yaml'), 'version: test\n')

  try {
    run(defaultShell, [new URL(`../${installSh}`, import.meta.url).pathname], { cwd: projectDir })
    const installedFiles = new Set(readdirSync(join(projectDir, '.claude', 'workflows')))

    for (const workflowFile of workflowFiles) {
      assert.equal(installedFiles.has(workflowFile), true)
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true })
  }
})

test('unified sh installer supports explicit global install when current directory is not Trellis', () => {
  const cwdDir = mkdtempSync(join(tmpdir(), 'trellis-workflow-non-project-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'trellis-workflow-home-'))

  try {
    run(defaultShell, [new URL(`../${installSh}`, import.meta.url).pathname, '--global'], {
      cwd: cwdDir,
      env: { ...process.env, HOME: homeDir },
    })
    const installedFiles = new Set(readdirSync(join(homeDir, '.claude', 'workflows')))

    for (const workflowFile of workflowFiles) {
      assert.equal(installedFiles.has(workflowFile), true)
    }
  } finally {
    rmSync(cwdDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})

test('unified sh installer exposes online options without network access', () => {
  const result = run(defaultShell, [installSh, '--help'])
  assert.match(result.stdout, /--repo OWNER\/REPO/)
  assert.match(result.stdout, /--branch REF/)
  assert.match(result.stdout, /--online/)
})

test('PowerShell installer parses when PowerShell is available', (t) => {
  const shell = commandExists('pwsh') ? 'pwsh' : commandExists('powershell') ? 'powershell' : ''
  if (!shell) {
    t.diagnostic('skipping PowerShell parse check: pwsh/powershell not found')
    return
  }

  run(shell, ['-NoProfile', '-Command', `$null = [scriptblock]::Create((Get-Content -Raw ${installPs1}))`])
})
