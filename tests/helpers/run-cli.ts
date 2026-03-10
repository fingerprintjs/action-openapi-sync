import { execFile } from 'node:child_process'
import * as path from 'node:path'

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface RunCliOptions {
  cwd?: string
  env?: Record<string, string>
  tsxArgs?: string[]
}

const tsxBin = path.resolve(__dirname, '../../node_modules/.bin/tsx')

export function runCli(scriptPath: string, args: string[], options?: RunCliOptions): Promise<CliResult> {
  const { cwd, env, tsxArgs = [] } = options ?? {}

  return new Promise((resolve) => {
    execFile(
      tsxBin,
      [...tsxArgs, scriptPath, ...args],
      { cwd, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        })
      }
    )
  })
}
