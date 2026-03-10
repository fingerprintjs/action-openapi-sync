import * as path from 'node:path'
import * as yaml from 'js-yaml'
import { minimatch } from 'minimatch'
import type { InternalConfig } from './types'
import { isRecord } from './utils'
import type { DumpOptions } from 'js-yaml'

export interface FilterFilesResult {
  filtered: Map<string, string>
  excludedFiles: Set<string>
}

interface DanglingRefResult {
  node: unknown
  changed: boolean
}

const yamlDumpConfig: DumpOptions = {
  lineWidth: -1,
  noRefs: true,
  quotingType: "'",
  forceQuotes: false,
}

/** Filter a single YAML file's content. */
export function filterFile(content: string, config: InternalConfig): string | null {
  let doc: unknown
  try {
    doc = yaml.load(content)
  } catch {
    return content
  }

  if (!isRecord(doc)) {
    return content
  }

  // File-level marker check
  if (config.internal_marker && doc[config.internal_marker] === true) {
    return null
  }

  // Field-level filtering
  let filtered = filterNode(doc, config)

  // Strip all strip_fields keys
  filtered = stripFields(filtered, config.strip_fields)

  // Prune empty objects
  filtered = pruneEmpty(filtered)

  if (filtered === undefined || filtered === null) {
    return null
  }

  return yaml.dump(filtered, yamlDumpConfig)
}

/** Filter a list of files. */
export function filterFiles(
  files: Map<string, string>,
  reachableFiles: Set<string>,
  config: InternalConfig
): FilterFilesResult {
  const filtered = new Map<string, string>()
  const excludedFiles = new Set<string>()

  // Filter reachable files
  for (const filePath of reachableFiles) {
    const content = files.get(filePath)
    if (content === undefined) {
      continue
    }

    // Check exclusion
    if (isFileExcluded(filePath, config)) {
      excludedFiles.add(filePath)
      continue
    }

    // Only filter YAML files
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.yaml' && ext !== '.yml') {
      filtered.set(filePath, content)
      continue
    }

    const filteredContent = filterFile(content, config)

    if (filteredContent === null) {
      excludedFiles.add(filePath)
    } else {
      filtered.set(filePath, filteredContent)
    }
  }

  // Clean dangling $refs
  for (const [filePath, content] of filtered) {
    const doc = yaml.load(content)
    if (!isRecord(doc)) {
      continue
    }

    const currentDir = path.dirname(filePath)
    const result = cleanDanglingRefs(doc, excludedFiles, currentDir)

    if (result.changed) {
      const cleaned = pruneEmpty(result.node)
      if (cleaned === undefined || cleaned === null) {
        filtered.delete(filePath)
        excludedFiles.add(filePath)
        continue
      }

      const output = yaml.dump(cleaned, yamlDumpConfig)
      filtered.set(filePath, output)
    }
  }

  return { filtered, excludedFiles }
}

/** Collect file paths referenced with $ref in a node. */
function collectFileRefs(node: unknown, currentDir: string, seen: Set<string>, queue: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectFileRefs(item, currentDir, seen, queue)
    }
    return
  }

  if (!isRecord(node)) {
    return
  }

  if (typeof node['$ref'] === 'string' && !node['$ref'].startsWith('#')) {
    const filePart = node['$ref'].split('#')[0]
    const resolved = path.normalize(path.join(currentDir, filePart)).split(path.sep).join('/')
    if (!seen.has(resolved)) {
      queue.push(resolved)
    }
  }

  if (typeof node['externalValue'] === 'string') {
    const resolved = path.normalize(path.join(currentDir, node['externalValue'])).split(path.sep).join('/')
    if (!seen.has(resolved)) {
      queue.push(resolved)
    }
  }

  for (const value of Object.values(node)) {
    collectFileRefs(value, currentDir, seen, queue)
  }
}

/** Remove files that are no longer reachable from the entrypoint. */
export function removeOrphanedFiles(filtered: Map<string, string>, entrypoint: string): string[] {
  const reachable = new Set<string>()
  const queue = [entrypoint]

  while (queue.length > 0) {
    const current = queue.pop()!
    if (reachable.has(current) || !filtered.has(current)) {
      continue
    }
    reachable.add(current)

    const doc = yaml.load(filtered.get(current)!)
    const currentDir = path.dirname(current)
    collectFileRefs(doc, currentDir, reachable, queue)
  }

  const orphaned: string[] = []
  for (const filePath of filtered.keys()) {
    if (!reachable.has(filePath)) {
      orphaned.push(filePath)
      filtered.delete(filePath)
    }
  }

  return orphaned
}

/** Check if a file path matches with exclude glob patterns. */
export function isFileExcluded(filePath: string, config: InternalConfig): boolean {
  return config.exclude_patterns.some((pattern) => minimatch(filePath, pattern))
}

/** Check if a node is marked as internal. */
function hasInternalMarker(node: unknown, config: InternalConfig): boolean {
  return isRecord(node) && node[config.internal_marker] === true
}

/** Recursively filter a parsed node. */
function filterNode(node: unknown, config: InternalConfig): unknown {
  if (Array.isArray(node)) {
    return node.filter((item) => !hasInternalMarker(item, config)).map((item) => filterNode(item, config))
  }

  if (!isRecord(node)) {
    return node
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node)) {
    // Filter path operations
    if (key === 'paths' && isRecord(value)) {
      const filteredPaths = filterPaths(value, config)
      if (filteredPaths !== null && Object.keys(filteredPaths).length > 0) {
        result[key] = filteredPaths
      }
      continue
    }

    // Filter parameters arrays
    if (key === 'parameters' && Array.isArray(value)) {
      const filteredParams = value.filter((param) => !hasInternalMarker(param, config))
      if (filteredParams.length > 0) {
        result[key] = filteredParams.map((p) => filterNode(p, config))
      }
      continue
    }

    // Filter schema properties
    if (key === 'properties' && isRecord(value)) {
      const filteredProps: Record<string, unknown> = {}
      for (const [propName, propValue] of Object.entries(value)) {
        if (!hasInternalMarker(propValue, config)) {
          filteredProps[propName] = filterNode(propValue, config)
        }
      }
      if (Object.keys(filteredProps).length > 0) {
        result[key] = filteredProps
      }
      continue
    }

    // Skip any key whose value is marked internal
    if (hasInternalMarker(value, config)) {
      continue
    }

    // Recurse into other objects
    result[key] = filterNode(value, config)
  }

  return result
}

/** Filter a `paths` object. */
function filterPaths(paths: Record<string, unknown>, config: InternalConfig): Record<string, unknown> | null {
  const result: Record<string, unknown> = {}

  for (const [pathKey, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) {
      result[pathKey] = pathValue
      continue
    }

    // Check if entire path is internal
    if (hasInternalMarker(pathValue, config)) {
      continue
    }

    const filteredPath: Record<string, unknown> = {}
    let hasPublicOperation = false

    for (const [opKey, opValue] of Object.entries(pathValue)) {
      if (hasInternalMarker(opValue, config)) {
        continue
      }
      filteredPath[opKey] = filterNode(opValue, config)
      hasPublicOperation = true
    }

    if (hasPublicOperation) {
      result[pathKey] = filteredPath
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

/** Recursively remove all the specified field keys from a node. */
function stripFields(node: unknown, fields: string[]): unknown {
  if (fields.length === 0) {
    return node
  }

  if (Array.isArray(node)) {
    return node.map((item) => stripFields(item, fields))
  }

  if (!isRecord(node)) {
    return node
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (fields.includes(key)) {
      continue
    }
    result[key] = stripFields(value, fields)
  }
  return result
}

/** Recursively remove empty objects and arrays. */
function pruneEmpty(node: unknown): unknown {
  if (Array.isArray(node)) {
    const pruned = node.map((item) => pruneEmpty(item)).filter((item) => item !== undefined)
    if (pruned.length === 0) {
      return undefined
    }
    return pruned
  }

  if (!isRecord(node)) {
    return node
  }

  const result: Record<string, unknown> = {}
  let hasKeys = false

  for (const [key, value] of Object.entries(node)) {
    const pruned = pruneEmpty(value)
    if (pruned !== undefined) {
      result[key] = pruned
      hasKeys = true
    }
  }

  return hasKeys ? result : undefined
}

/** Recursively remove $ref nodes that point to excluded files. */
function cleanDanglingRefs(node: unknown, excludedFiles: Set<string>, currentDir: string): DanglingRefResult {
  if (Array.isArray(node)) {
    let changed = false
    const result = []

    for (const item of node) {
      const itemResult = cleanDanglingRefs(item, excludedFiles, currentDir)
      if (itemResult.changed) {
        changed = true
      }
      if (itemResult.node !== undefined) {
        result.push(itemResult.node)
      }
    }

    return {
      node: result.length > 0 ? result : undefined,
      changed: result.length !== node.length || changed,
    }
  }

  if (!isRecord(node)) {
    return { node, changed: false }
  }

  // Check if this node itself has a dangling $ref
  if (typeof node['$ref'] === 'string') {
    const ref = node['$ref']
    if (!ref.startsWith('#')) {
      const filePart = ref.split('#')[0]
      const resolved = path.normalize(path.join(currentDir, filePart)).split(path.sep).join('/')
      if (excludedFiles.has(resolved)) {
        console.warn(`Removed dangling $ref to excluded file: ${ref} (resolved: ${resolved})`)
        return { node: undefined, changed: true }
      }
    }
  }

  const result: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isRecord(value)) {
      // For properties, remove entries with dangling refs
      const filteredProps: Record<string, unknown> = {}
      for (const [propName, propValue] of Object.entries(value)) {
        const propResult = cleanDanglingRefs(propValue, excludedFiles, currentDir)
        if (propResult.node !== undefined) {
          filteredProps[propName] = propResult.node
          if (propResult.changed) {
            changed = true
          }
        } else {
          changed = true
        }
      }
      if (Object.keys(filteredProps).length > 0) {
        result[key] = filteredProps
      } else {
        changed = true
      }
    } else {
      const childResult = cleanDanglingRefs(value, excludedFiles, currentDir)
      if (childResult.changed) {
        changed = true
      }
      if (childResult.node !== undefined) {
        result[key] = childResult.node
      } else {
        changed = true
      }
    }
  }

  return { node: result, changed }
}
