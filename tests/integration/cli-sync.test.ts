import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runCli } from '../helpers/run-cli'

const fixturesDir = path.resolve(__dirname, '../fixtures')
const sourceRoot = path.join(fixturesDir, 'source')
const configPath = path.join(fixturesDir, 'configs/multi-file-config.yml')
const cliPath = path.resolve(__dirname, '../../src/cli-sync.ts')

/** prevents duplication of cliPath and current working directory */
function run(args: string[], env?: Record<string, string>) {
  return runCli(cliPath, args, { cwd: sourceRoot, env })
}

describe('cli-sync', () => {
  let targetRoot: string

  beforeEach(() => {
    targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-sync-test-'))
  })

  afterEach(() => {
    fs.rmSync(targetRoot, { recursive: true, force: true })
  })

  it('exits with code 1 when --config is missing', async () => {
    const result = await run([])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--config is required')
  })

  it('syncs multi_file and writes correct files to target', async () => {
    const result = await run(['--config', configPath, '--source-root', sourceRoot, '--target-root', targetRoot])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Files written successfully')

    expect(fs.existsSync(path.join(targetRoot, 'schemas/petstore-api-v2.yml'))).toBe(true)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/schemas/Pet.yml'))).toBe(true)
    expect(fs.existsSync(path.join(targetRoot, 'schemas/paths/pets.yml'))).toBe(true)

    // Internal files should not exist
    expect(fs.existsSync(path.join(targetRoot, 'schemas/components/schemas/InternalDiagnostics.yml'))).toBe(false)
  })

  it('writes GITHUB_OUTPUT variables', async () => {
    const outputFile = path.join(targetRoot, 'github-output.txt')
    fs.writeFileSync(outputFile, '')

    const result = await run(['--config', configPath, '--source-root', sourceRoot, '--target-root', targetRoot], {
      GITHUB_OUTPUT: outputFile,
    })

    expect(result.exitCode).toBe(0)

    const output = fs.readFileSync(outputFile, 'utf-8')
    expect(output).toContain('has_diff<<EOF_OPENAPI_SYNC')
    expect(output).toContain('true')
    expect(output).toContain('diff_summary<<EOF_OPENAPI_SYNC')
    expect(output).toContain('pr_body<<EOF_OPENAPI_SYNC')
    expect(output).toContain('This PR automatically updates the OpenAPI schema')
  })

  it('reports no diff on second run', async () => {
    await run(['--config', configPath, '--source-root', sourceRoot, '--target-root', targetRoot])

    const outputFile = path.join(targetRoot, 'github-output.txt')
    fs.writeFileSync(outputFile, '')

    const result = await run(['--config', configPath, '--source-root', sourceRoot, '--target-root', targetRoot], {
      GITHUB_OUTPUT: outputFile,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No meaningful changes detected')

    const output = fs.readFileSync(outputFile, 'utf-8')
    expect(output).toContain('has_diff<<EOF_OPENAPI_SYNC')
    expect(output).toContain('false')
  })
})
