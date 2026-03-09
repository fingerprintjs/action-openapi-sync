import { execFile } from 'node:child_process'
import * as path from 'node:path'

const cliPath = path.resolve(__dirname, '../src/cli-sync.ts')
const tsxBin = path.resolve(__dirname, '../node_modules/.bin/tsx')

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

function runCli(args: string[], cwd: string, env?: Record<string, string>): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      tsxBin,
      [cliPath, ...args],
      { cwd, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error?.code ?? 0,
        })
      }
    )
  })
}

describe('cli-sync', () => {
  it('exits with code 0', async () => {
    const result = await runCli([], __dirname)

    expect(result.exitCode).toBe(0)
  })
})
