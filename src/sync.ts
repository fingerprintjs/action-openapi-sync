import * as fs from 'node:fs'
import * as path from 'node:path'
import { mapSourceToTarget } from './config'
import { resolveRefs } from './resolve'
import { filterFile, filterFiles, removeOrphanedFiles } from './filter'
import type { SyncConfig } from './types'

/** Resolve refs, filter internal content, and map source paths to target paths. */
export async function syncMultiFile(config: SyncConfig, sourceRoot: string): Promise<Map<string, string>> {
  console.log('Resolving $ref graph...')
  const reachableFiles = await resolveRefs(config.entrypoint, sourceRoot)
  console.log(`Found ${reachableFiles.size} reachable files`)

  const sourceFiles = new Map<string, string>()
  for (const filePath of reachableFiles) {
    const absPath = path.resolve(sourceRoot, filePath)
    sourceFiles.set(filePath, fs.readFileSync(absPath, 'utf-8'))
  }

  console.log('Filtering internal content...')
  const filterResult = filterFiles(sourceFiles, reachableFiles, config.internal)
  removeOrphanedFiles(filterResult.filtered, config.entrypoint)
  console.log(`Filtered: ${filterResult.filtered.size} files kept, ${filterResult.excludedFiles.size} files excluded`)

  const targetFiles = new Map<string, string>()
  for (const [sourcePath, content] of filterResult.filtered) {
    const targetPath = mapSourceToTarget(config, sourcePath)
    if (targetPath) {
      targetFiles.set(targetPath, content)
    } else {
      console.warn(`Warning: No mapping for source file: ${sourcePath}`)
    }
  }

  return targetFiles
}

/** Read the bundled file, strip internal fields, and map to target path. */
export function syncBundled(config: SyncConfig, sourceRoot: string): Map<string, string> {
  const absPath = path.resolve(sourceRoot, config.entrypoint)
  const content = fs.readFileSync(absPath, 'utf-8')

  const filtered = filterFile(content, config.internal)

  const targetFiles = new Map<string, string>()
  if (filtered !== null) {
    const targetPath = mapSourceToTarget(config, config.entrypoint)
    if (targetPath) {
      targetFiles.set(targetPath, filtered)
    }
  }

  return targetFiles
}
