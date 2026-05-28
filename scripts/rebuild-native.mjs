import { spawnSync } from 'node:child_process'

function canImportDistutils(python) {
  const result = spawnSync(python, ['-c', 'import distutils'], { stdio: 'ignore' })
  return result.status === 0
}

function findPython() {
  const candidates = [
    process.env.PYTHON,
    process.platform === 'darwin' ? '/usr/bin/python3' : undefined,
    'python3',
    'python'
  ].filter(Boolean)

  return candidates.find(canImportDistutils)
}

const env = { ...process.env }
const python = env.PYTHON && canImportDistutils(env.PYTHON) ? env.PYTHON : findPython()

if (python) {
  env.PYTHON = python
}

const command = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
const result = spawnSync(command, ['install-app-deps'], {
  env,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
