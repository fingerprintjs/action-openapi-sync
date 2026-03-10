import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { loadConfig, mapSourceToTarget, getManagedTargetDirs, getExclusionPatterns } from '../src/config'
import type { SyncConfig } from '../src/types'
import os from 'node:os'
import fs from 'node:fs'

const fixturesDir = path.resolve(__dirname, 'fixtures/configs')
const multiFileConfigFile = path.resolve(fixturesDir, 'multi-file-config.yml')
const bundledConfigFile = path.resolve(fixturesDir, 'bundled-config.yml')
const minimalConfigFile = path.resolve(fixturesDir, 'minimal-config.yml')

describe('loadConfig', () => {
  it('loads valid multi_file config', () => {
    const config = loadConfig(multiFileConfigFile)

    expect(config.entrypoint).toBe('api/v2/petstore-api.yml')
    expect(config.mode).toBe('multi_file')
    expect(config.file_mappings).toHaveLength(3)
    expect(config.file_mappings[0]).toEqual({
      source: 'api/v2/petstore-api.yml',
      target: 'schemas/petstore-api-v2.yml',
    })
    expect(config.file_mappings[1]).toEqual({
      source_dir: 'api/v2/components',
      target_dir: 'schemas/components',
    })
    expect(config.file_mappings[2]).toEqual({
      source_dir: 'api/v2/paths',
      target_dir: 'schemas/paths',
      exclude_from_deletion: ['examples/**'],
    })
    expect(config.internal.internal_marker).toBe('x-internal')
    expect(config.internal.strip_fields).toEqual(['x-internal'])
    expect(config.internal.exclude_patterns).toEqual([])
  })

  it('loads valid bundled config', () => {
    const config = loadConfig(bundledConfigFile)

    expect(config.entrypoint).toBe('api/v1/dist/petstore-api.yml')
    expect(config.mode).toBe('bundled')
    expect(config.file_mappings).toHaveLength(1)
  })

  it('defaults mode to multi_file if omitted', () => {
    const config = loadConfig(minimalConfigFile)

    expect(config.mode).toBe('multi_file')
  })

  it('throws on non-existent config file', () => {
    expect(() => loadConfig('/nonexistent/path/config.yml')).toThrow()
  })

  it('throws on unreadable config file', () => {
    const tmpFile = path.join(os.tmpdir(), `unreadable-config.yml`)
    fs.closeSync(fs.openSync(tmpFile, 'w'))
    fs.chmodSync(tmpFile, 0o000)

    try {
      expect(() => loadConfig(tmpFile)).toThrow('Config file is not readable')
    } finally {
      fs.chmodSync(tmpFile, 0o644)
      fs.unlinkSync(tmpFile)
    }
  })

  it.each`
    fixture                                 | expectedError
    ${'invalid-missing-entrypoint.yml'}     | ${'non-empty `entrypoint`'}
    ${'invalid-bad-mode.yml'}               | ${'Invalid mode'}
    ${'invalid-empty.yml'}                  | ${'YAML object'}
    ${'invalid-mappings-not-array.yml'}     | ${'"file_mappings" must be an array'}
    ${'invalid-mapping-not-object.yml'}     | ${'must be an object'}
    ${'invalid-mapping-bad-source.yml'}     | ${'source must be a string'}
    ${'invalid-mapping-bad-target.yml'}     | ${'target must be a string'}
    ${'invalid-mapping-bad-source-dir.yml'} | ${'source_dir must be a string'}
    ${'invalid-mapping-bad-target-dir.yml'} | ${'target_dir must be a string'}
    ${'invalid-mapping-incomplete.yml'}     | ${'must have either'}
    ${'invalid-internal-not-object.yml'}    | ${'"internal" must be an object'}
    ${'invalid-internal-bad-marker.yml'}    | ${'internal_marker'}
    ${'invalid-internal-bad-strip.yml'}     | ${'strip_fields'}
    ${'invalid-internal-bad-patterns.yml'}  | ${'exclude_patterns'}
    ${'invalid-mapping-bad-exclude.yml'}    | ${'exclude_from_deletion must be an array of strings'}
  `('throws "$expectedError" for $fixture', ({ fixture, expectedError }) => {
    expect(() => loadConfig(path.join(fixturesDir, fixture))).toThrow(expectedError)
  })
})

describe('mapSourceToTarget', () => {
  const config: SyncConfig = {
    entrypoint: 'api/v2/petstore-api.yml',
    mode: 'multi_file',
    file_mappings: [
      { source: 'api/v2/petstore-api.yml', target: 'schemas/petstore-api-v2.yml' },
      { source_dir: 'api/v2/components', target_dir: 'schemas/components' },
      { source_dir: 'api/v2/paths', target_dir: 'schemas/paths' },
    ],
    internal: { internal_marker: 'x-internal', strip_fields: ['x-internal'], exclude_patterns: [] },
  }

  it.each`
    sourcePath                                       | expected
    ${'api/v2/petstore-api.yml'}                     | ${'schemas/petstore-api-v2.yml'}
    ${'api/v2/components/schemas/Pet.yml'}           | ${'schemas/components/schemas/Pet.yml'}
    ${'api/v2/paths/examples/pets/get_pet_200.json'} | ${'schemas/paths/examples/pets/get_pet_200.json'}
    ${'api/v1/something.yml'}                        | ${null}
    ${'api/v2/components-extra/foo.yml'}             | ${null}
  `('maps "$sourcePath" -> $expected', ({ sourcePath, expected }) => {
    expect(mapSourceToTarget(config, sourcePath)).toBe(expected)
  })

  it('exact match takes priority over directory match', () => {
    const configWithOverlap: SyncConfig = {
      ...config,
      file_mappings: [
        { source: 'api/v2/components/special.yml', target: 'schemas/special-override.yml' },
        { source_dir: 'api/v2/components', target_dir: 'schemas/components' },
      ],
    }

    expect(mapSourceToTarget(configWithOverlap, 'api/v2/components/special.yml')).toBe('schemas/special-override.yml')
  })

  it.each`
    description                         | source_dir              | target_dir
    ${'source_dir with trailing slash'} | ${'api/v2/components/'} | ${'schemas/components'}
    ${'target_dir with trailing slash'} | ${'api/v2/components'}  | ${'schemas/components/'}
  `('handles $description', ({ source_dir, target_dir }) => {
    const configWithSlash: SyncConfig = {
      ...config,
      file_mappings: [{ source_dir, target_dir }],
    }

    expect(mapSourceToTarget(configWithSlash, 'api/v2/components/schemas/Pet.yml')).toBe(
      'schemas/components/schemas/Pet.yml'
    )
  })
})

describe('getExclusionPatterns', () => {
  it('builds full patterns', () => {
    const config: SyncConfig = {
      entrypoint: 'api.yml',
      mode: 'multi_file',
      file_mappings: [
        { source_dir: 'api/paths', target_dir: 'schemas/paths', exclude_from_deletion: ['examples/**'] },
        { source_dir: 'api/components', target_dir: 'schemas/components' },
      ],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    expect(getExclusionPatterns(config)).toEqual(['schemas/paths/examples/**'])
  })

  it('returns empty array when no mappings have exclude_from_deletion', () => {
    const config: SyncConfig = {
      entrypoint: 'api.yml',
      mode: 'multi_file',
      file_mappings: [{ source_dir: 'api/paths', target_dir: 'schemas/paths' }],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    expect(getExclusionPatterns(config)).toEqual([])
  })

  it('handles target_dir with trailing slash', () => {
    const config: SyncConfig = {
      entrypoint: 'api.yml',
      mode: 'multi_file',
      file_mappings: [
        { source_dir: 'api/paths', target_dir: 'schemas/paths/', exclude_from_deletion: ['examples/**'] },
      ],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    expect(getExclusionPatterns(config)).toEqual(['schemas/paths/examples/**'])
  })

  it('ignores exclude_from_deletion on target file mappings', () => {
    const config: SyncConfig = {
      entrypoint: 'api.yml',
      mode: 'multi_file',
      file_mappings: [{ source: 'api.yml', target: 'schemas/api.yml', exclude_from_deletion: ['something'] }],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    expect(getExclusionPatterns(config)).toEqual([])
  })
})

describe('getManagedTargetDirs', () => {
  it('extracts all unique target directories', () => {
    const config: SyncConfig = {
      entrypoint: 'api/v2/petstore-api.yml',
      mode: 'multi_file',
      file_mappings: [
        { source: 'api/v2/petstore-api.yml', target: 'schemas/petstore-api-v2.yml' },
        { source_dir: 'api/v2/components', target_dir: 'schemas/components' },
        { source_dir: 'api/v2/paths', target_dir: 'schemas/paths' },
      ],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    const dirs = getManagedTargetDirs(config)
    expect(dirs).toContain('schemas')
    expect(dirs).toContain('schemas/components')
    expect(dirs).toContain('schemas/paths')
    expect(dirs).toHaveLength(3)
  })

  it('deduplicates directories', () => {
    const config: SyncConfig = {
      entrypoint: 'api/v2/petstore-api.yml',
      mode: 'multi_file',
      file_mappings: [
        { source: 'api/v2/a.yml', target: 'schemas/a.yml' },
        { source: 'api/v2/b.yml', target: 'schemas/b.yml' },
      ],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    const dirs = getManagedTargetDirs(config)
    expect(dirs).toEqual(['schemas'])
  })

  it('excludes root-level targets from managed dirs', () => {
    const config: SyncConfig = {
      entrypoint: 'e.yaml',
      mode: 'multi_file',
      file_mappings: [{ source: 'e.yaml', target: 'schema.yaml' }],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    const dirs = getManagedTargetDirs(config)
    expect(dirs).toEqual([])
  })

  it('includes dirname of exact file targets', () => {
    const config: SyncConfig = {
      entrypoint: 'e.yml',
      mode: 'multi_file',
      file_mappings: [{ source: 'e.yml', target: 'out/nested/file.yml' }],
      internal: { internal_marker: 'x-internal', strip_fields: [], exclude_patterns: [] },
    }

    const dirs = getManagedTargetDirs(config)
    expect(dirs).toContain('out/nested')
  })
})
