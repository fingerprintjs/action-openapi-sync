import * as path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { syncMultiFile, syncBundled } from '../src/sync'
import type { SyncConfig } from '../src/types'

const fixturesDir = path.resolve(__dirname, 'fixtures')
const sourceRoot = path.join(fixturesDir, 'source')

const multiFileConfig: SyncConfig = {
  entrypoint: 'api/v2/petstore-api.yml',
  mode: 'multi_file',
  file_mappings: [
    { source: 'api/v2/petstore-api.yml', target: 'schemas/petstore-api-v2.yml' },
    { source_dir: 'api/v2/components', target_dir: 'schemas/components' },
    { source_dir: 'api/v2/paths', target_dir: 'schemas/paths' },
  ],
  internal: {
    internal_marker: 'x-internal',
    strip_fields: ['x-internal'],
    exclude_patterns: [],
  },
}

describe('syncMultiFile', () => {
  it('resolves refs, filters internal content, and maps to target paths', async () => {
    const result = await syncMultiFile(multiFileConfig, sourceRoot)

    expect(result.has('schemas/petstore-api-v2.yml')).toBe(true)
    expect(result.has('schemas/components/schemas/Pet.yml')).toBe(true)
    expect(result.has('schemas/paths/pets.yml')).toBe(true)
  })

  it('excludes internal files from output', async () => {
    const result = await syncMultiFile(multiFileConfig, sourceRoot)

    const keys = [...result.keys()]
    expect(keys.some((k) => k.includes('InternalDiagnostics'))).toBe(false)
  })

  it('warns on unmapped source files', async () => {
    const configNoMappings: SyncConfig = {
      ...multiFileConfig,
      file_mappings: [],
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await syncMultiFile(configNoMappings, sourceRoot)

    expect(result.size).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No mapping for source file'))
    warnSpy.mockRestore()
  })
})

describe('syncBundled', () => {
  it('reads entrypoint, filters content, and maps to target path', () => {
    const config: SyncConfig = {
      entrypoint: 'api/v2/petstore-api.yml',
      mode: 'bundled',
      file_mappings: [{ source: 'api/v2/petstore-api.yml', target: 'schemas/petstore-api-bundled.yml' }],
      internal: {
        internal_marker: 'x-internal',
        strip_fields: ['x-internal'],
        exclude_patterns: [],
      },
    }

    const result = syncBundled(config, sourceRoot)

    expect(result.has('schemas/petstore-api-bundled.yml')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('returns empty map when file is entirely internal', () => {
    const config: SyncConfig = {
      entrypoint: 'api/v2/components/schemas/InternalDiagnostics.yml',
      mode: 'bundled',
      file_mappings: [{ source: 'api/v2/components/schemas/InternalDiagnostics.yml', target: 'schemas/internal.yml' }],
      internal: {
        internal_marker: 'x-internal',
        strip_fields: ['x-internal'],
        exclude_patterns: [],
      },
    }

    const result = syncBundled(config, sourceRoot)

    expect(result.size).toBe(0)
  })

  it('returns empty map when entrypoint has no mapping', () => {
    const config: SyncConfig = {
      entrypoint: 'api/v2/petstore-api.yml',
      mode: 'bundled',
      file_mappings: [],
      internal: {
        internal_marker: 'x-internal',
        strip_fields: ['x-internal'],
        exclude_patterns: [],
      },
    }

    const result = syncBundled(config, sourceRoot)

    expect(result.size).toBe(0)
  })
})
