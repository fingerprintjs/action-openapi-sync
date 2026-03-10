import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runCli } from '../helpers/run-cli'

const cliPath = path.resolve(__dirname, '../../src/cli-pr.ts')
const mockFetchPath = path.resolve(__dirname, '../helpers/mock-github-api.ts')

function run(args: string[], env?: Record<string, string>) {
  return runCli(cliPath, args, { tsxArgs: ['--import', mockFetchPath], env })
}

const allArgs = [
  '--source-repo',
  'owner/source',
  '--source-pr',
  '42',
  '--target-repo',
  'owner/target',
  '--target-pr',
  '99',
]

describe('cli-pr', () => {
  it('exits with code 1 when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN

    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    const result = await run(allArgs, process.env as Record<string, string>)

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('GITHUB_TOKEN')
  })

  it.each(['--source-repo', '--source-pr', '--target-repo', '--target-pr'])(
    'exits with code 1 when %s is missing',
    async (missing) => {
      const argIndex = allArgs.indexOf(missing)
      const args = [...allArgs.slice(0, argIndex), ...allArgs.slice(argIndex + 2)]
      const result = await run(args, { GITHUB_TOKEN: 'test-token' })

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(missing)
    }
  )

  it('completes successfully with all required args and token', async () => {
    const result = await run(allArgs, { GITHUB_TOKEN: 'test-token' })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('PR lifecycle actions completed')
  })

  it('accepts --source-pr-merged false', async () => {
    const result = await run([...allArgs, '--source-pr-merged', 'false'], {
      GITHUB_TOKEN: 'test-token',
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('PR lifecycle actions completed')
  })
})
