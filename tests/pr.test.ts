import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handlePrLifecycle } from '../src/pr'
import type { PrOptions } from '../src/pr'

interface MockResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

function mockFetch(responses: MockResponse[]): void {
  let callIndex = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const resp = responses[callIndex] ?? { status: 200, body: [] }
      callIndex++
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.body ?? [],
        headers: new Headers(resp.headers),
      }
    })
  )
}

/** Mock the GitHub API fetch flow. Override only the steps you care about. */
function mockFetchFlow(
  overrides?: Partial<{
    getSourceComments: MockResponse | MockResponse[]
    writeSourceComment: MockResponse
    manageLabel: MockResponse
    getTargetComments: MockResponse | MockResponse[]
    writeTargetComment: MockResponse
  }>
): void {
  const source = overrides?.getSourceComments ?? { status: 200, body: [] }
  const target = overrides?.getTargetComments ?? { status: 200, body: [] }

  mockFetch([
    ...(Array.isArray(source) ? source : [source]),
    overrides?.writeSourceComment ?? { status: 201 },
    overrides?.manageLabel ?? { status: 404 },
    ...(Array.isArray(target) ? target : [target]),
    overrides?.writeTargetComment ?? { status: 201 },
  ])
}

function defaultOptions(overrides?: Partial<PrOptions>): PrOptions {
  return {
    sourceGithubToken: 'source-token',
    targetGithubToken: 'target-token',
    sourceRepo: 'owner/source',
    sourcePrNumber: 42,
    sourcePrMerged: true,
    targetRepo: 'owner/target',
    targetPrNumber: 99,
    ...overrides,
  }
}

function getFetchCallBody(callIndex: number): Record<string, unknown> {
  const fetchMock = vi.mocked(fetch)
  return JSON.parse(String(fetchMock.mock.calls[callIndex][1]?.body))
}

function getFetchCallHeaders(callIndex: number): Record<string, string> {
  const fetchMock = vi.mocked(fetch)
  const headers = fetchMock.mock.calls[callIndex][1]?.headers
  return headers ? Object.fromEntries(Object.entries(headers)) : {}
}

describe('handlePrLifecycle', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates link comment on source PR when no existing comment', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/source/issues/42/comments')
    expect(fetchMock.mock.calls[1][0]).toContain('/repos/owner/source/issues/42/comments')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
    const body = getFetchCallBody(1)
    expect(body.body).toContain('<!-- openapi-sync-link -->')
    expect(body.body).toContain('owner/target#99')
  })

  it('updates existing link comment on source PR', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: [{ id: 777, body: '<!-- openapi-sync-link -->\nOld link' }] },
      writeSourceComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[1][0]).toContain('/issues/comments/777')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH')
  })

  it('adds warning label and comment when source not merged', async () => {
    mockFetchFlow({ manageLabel: { status: 200 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[2][0]).toContain('/repos/owner/target/issues/99/labels')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('POST')
    const labelBody = getFetchCallBody(2)
    expect(labelBody.labels).toEqual(['Not Completed'])

    const commentBody = getFetchCallBody(4)
    expect(commentBody.body).toContain('<!-- openapi-sync-status -->')
    expect(commentBody.body).toContain('not finalized yet')
  })

  it('removes warning label and adds merged comment when source is merged', async () => {
    mockFetchFlow({ manageLabel: { status: 200 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[2][0]).toContain('/repos/owner/target/issues/99/labels/Not%20Completed')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')

    const commentBody = getFetchCallBody(4)
    expect(commentBody.body).toContain('<!-- openapi-sync-status -->')
    expect(commentBody.body).toContain('have been finalized')
    expect(commentBody.body).toContain('ready for review')
  })

  it('warns on failed comment listing', async () => {
    mockFetchFlow({ getSourceComments: { status: 403 } })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to list comments'))
  })

  it('warns on failed comment creation', async () => {
    mockFetchFlow({
      writeSourceComment: { status: 500 },
      writeTargetComment: { status: 500 },
    })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create comment'))
  })

  it('warns on failed comment update', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: [{ id: 1, body: '<!-- openapi-sync-link -->\nold' }] },
      writeSourceComment: { status: 500 },
    })

    await handlePrLifecycle(defaultOptions())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to update comment'))
  })

  it('warns on failed label add', async () => {
    mockFetchFlow({ manageLabel: { status: 403 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to add label'))
  })

  it('warns on failed label removal', async () => {
    mockFetchFlow({ manageLabel: { status: 500 } })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to remove label'))
  })

  it('does not warn when label removal returns 404 (label was not there)', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: true }))

    // No warning about label removal
    const labelWarnings = warnSpy.mock.calls.filter(
      // @ts-ignore
      (call) => typeof call[0] === 'string' && call[0].includes('Failed to remove label')
    )
    expect(labelWarnings).toHaveLength(0)
  })

  it('updates existing status comment instead of creating duplicate', async () => {
    mockFetchFlow({
      manageLabel: { status: 200 },
      getTargetComments: { status: 200, body: [{ id: 888, body: '<!-- openapi-sync-status -->\nOld status' }] },
      writeTargetComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions({ sourcePrMerged: false }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[4][0]).toContain('/issues/comments/888')
    expect(fetchMock.mock.calls[4][1]?.method).toBe('PATCH')
  })

  it('handles non-array response from comments endpoint', async () => {
    mockFetchFlow({
      getSourceComments: { status: 200, body: { message: 'unexpected' } },
      getTargetComments: { status: 200, body: 'not-an-array' },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[4][1]?.method).toBe('POST')
  })

  it('sends correct Authorization header per repo', async () => {
    mockFetchFlow()

    await handlePrLifecycle(defaultOptions({ sourceGithubToken: 'source-secret', targetGithubToken: 'target-secret' }))

    expect(getFetchCallHeaders(0).Authorization).toBe('token source-secret')
    expect(getFetchCallHeaders(1).Authorization).toBe('token source-secret')
    expect(getFetchCallHeaders(2).Authorization).toBe('token target-secret')
    expect(getFetchCallHeaders(3).Authorization).toBe('token target-secret')
    expect(getFetchCallHeaders(4).Authorization).toBe('token target-secret')
  })

  it('finds comment on second page', async () => {
    const nextUrl = 'https://api.github.com/repos/owner/source/issues/42/comments?per_page=100&page=2'

    mockFetchFlow({
      getSourceComments: [
        {
          status: 200,
          body: [{ id: 1, body: 'unrelated comment' }],
          headers: { link: `<${nextUrl}>; rel="next"` },
        },
        { status: 200, body: [{ id: 2, body: '<!-- openapi-sync-link -->\nOld link' }] },
      ],
      writeSourceComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[1][0]).toBe(nextUrl)
    expect(fetchMock.mock.calls[2][0]).toContain('/issues/comments/2')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('PATCH')
  })

  it('paginates through multiple pages on target PR comments', async () => {
    const nextUrl = 'https://api.github.com/repos/owner/target/issues/42/comments?per_page=100&page=2'

    mockFetchFlow({
      getTargetComments: [
        {
          status: 200,
          body: [{ id: 1, body: 'some other comment' }],
          headers: { link: `<${nextUrl}>; rel="next"` },
        },
        { status: 200, body: [{ id: 2, body: '<!-- openapi-sync-status -->\nOld status' }] },
      ],
      writeTargetComment: { status: 200 },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls[4][0]).toBe(nextUrl)
    expect(fetchMock.mock.calls[5][0]).toContain('/issues/comments/2')
    expect(fetchMock.mock.calls[5][1]?.method).toBe('PATCH')
  })

  it('skips source PR comment when `sourceGithubToken` is not provided', async () => {
    mockFetch([{ status: 200 }, { status: 200, body: [] }, { status: 201 }])

    await handlePrLifecycle(defaultOptions({ sourceGithubToken: undefined }))

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/target/')
  })

  it('stops pagination when no more page', async () => {
    mockFetchFlow({
      getSourceComments: {
        status: 200,
        body: [{ id: 1, body: 'unrelated' }],
        headers: { link: '<https://api.github.com/repos/owner/source/issues/42/comments?page=1>; rel="last"' },
      },
    })

    await handlePrLifecycle(defaultOptions())

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
  })

  describe('commentOnSourcePr option', () => {
    it('skips source PR comment when commentOnSourcePr is false', async () => {
      mockFetch([{ status: 200 }, { status: 200, body: [] }, { status: 201 }])

      await handlePrLifecycle(defaultOptions({ commentOnSourcePr: false }))

      const fetchMock = vi.mocked(fetch)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/target/issues/99/labels')
    })

    it('still posts source PR comment when commentOnSourcePr is true', async () => {
      mockFetchFlow()

      await handlePrLifecycle(defaultOptions({ commentOnSourcePr: true }))

      const fetchMock = vi.mocked(fetch)
      expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/source/issues/42/comments')
    })

    it('still posts source PR comment by default', async () => {
      mockFetchFlow()

      await handlePrLifecycle(defaultOptions())

      const fetchMock = vi.mocked(fetch)
      expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/source/issues/42/comments')
    })

    it('handles target PR status correctly when source comment is skipped and source not merged', async () => {
      mockFetch([{ status: 200 }, { status: 200, body: [] }, { status: 201 }])

      await handlePrLifecycle(defaultOptions({ commentOnSourcePr: false, sourcePrMerged: false }))

      const fetchMock = vi.mocked(fetch)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(fetchMock.mock.calls[0][0]).toContain('/repos/owner/target/issues/99/labels')
      expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
      const commentBody = getFetchCallBody(2)
      expect(commentBody.body).toContain('not finalized yet')
    })
  })
})
