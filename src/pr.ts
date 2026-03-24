const COMMENT_TAG_LINK = '<!-- openapi-sync-link -->'
const COMMENT_TAG_STATUS = '<!-- openapi-sync-status -->'
const WARNING_LABEL = 'Not Completed'

export interface PrOptions {
  targetGithubToken: string
  sourceRepo: string
  sourcePrNumber: number
  sourcePrMerged: boolean
  targetRepo: string
  targetPrNumber: number
  sourceGithubToken?: string
  commentOnSourcePr?: boolean
}

interface GitHubComment {
  id: number
  body: string
}

/** Handle PR lifecycle actions. */
export async function handlePrLifecycle(options: PrOptions): Promise<void> {
  const {
    sourceGithubToken,
    targetGithubToken,
    sourceRepo,
    sourcePrNumber,
    sourcePrMerged,
    targetRepo,
    targetPrNumber,
    commentOnSourcePr = true,
  } = options

  const targetPrUrl = `https://github.com/${targetRepo}/pull/${targetPrNumber}`

  // Comment on source PR with link to target PR
  if (sourceGithubToken && commentOnSourcePr) {
    const linkBody = `${COMMENT_TAG_LINK}\nOpenAPI Sync PR: [${targetRepo}#${targetPrNumber}](${targetPrUrl})`
    await upsertComment(sourceRepo, sourcePrNumber, COMMENT_TAG_LINK, linkBody, sourceGithubToken)
  }

  // Handle status on target PR
  if (!sourcePrMerged) {
    await addLabel(targetRepo, targetPrNumber, WARNING_LABEL, targetGithubToken)

    const statusBody = `${COMMENT_TAG_STATUS}\n⚠️The changes are not finalized yet. Do not merge this PR until the changes are ready.`
    await upsertComment(targetRepo, targetPrNumber, COMMENT_TAG_STATUS, statusBody, targetGithubToken)
  } else {
    await removeLabel(targetRepo, targetPrNumber, WARNING_LABEL, targetGithubToken)

    const statusBody = `${COMMENT_TAG_STATUS}\n✅The changes have been finalized. This PR is ready for review.`
    await upsertComment(targetRepo, targetPrNumber, COMMENT_TAG_STATUS, statusBody, targetGithubToken)
  }
}

/** Create or update a comment on a PR, by its tag. */
async function upsertComment(repo: string, prNumber: number, tag: string, body: string, token: string): Promise<void> {
  const existing = await findComment(repo, prNumber, tag, token)

  if (existing) {
    const url = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`
    const response = await githubApi('PATCH', url, token, { body })
    if (!response.ok) {
      console.warn(`Warning: Failed to update comment on ${repo}#${prNumber}: ${response.status}`)
    }
  } else {
    const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`
    const response = await githubApi('POST', url, token, { body })
    if (!response.ok) {
      console.warn(`Warning: Failed to create comment on ${repo}#${prNumber}: ${response.status}`)
    }
  }
}

/** Find an existing comment on a PR by its tag. */
async function findComment(repo: string, prNumber: number, tag: string, token: string): Promise<GitHubComment | null> {
  let url: string | null = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`

  while (url) {
    const response = await githubApi('GET', url, token)

    if (!response.ok) {
      console.warn(`Warning: Failed to list comments on ${repo}#${prNumber}: ${response.status}`)
      return null
    }

    const comments: unknown = await response.json()
    if (!Array.isArray(comments)) {
      return null
    }

    const found = comments.find((c: GitHubComment) => c.body.includes(tag))
    if (found) {
      return found
    }

    url = getNextPageUrl(response)
  }

  return null
}

/**
 * Extract the next page URL from the GitHub API response.
 * Ref: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api?apiVersion=2022-11-28
 */
function getNextPageUrl(response: Response): string | null {
  const link = response.headers.get('link')
  if (!link) {
    return null
  }

  const match = link.match(/<([^>]+)>;\s*rel="next"/)
  return match?.[1] ?? null
}

/** Make an authenticated request to the GitHub API. */
async function githubApi(
  method: string,
  url: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  return fetch(url, options)
}

/** Add a label to a PR. */
async function addLabel(repo: string, prNumber: number, label: string, token: string): Promise<void> {
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/labels`
  const response = await githubApi('POST', url, token, { labels: [label] })
  if (!response.ok) {
    console.warn(`Warning: Failed to add label "${label}" to ${repo}#${prNumber}: ${response.status}`)
  }
}

/** Remove a label from a PR. */
async function removeLabel(repo: string, prNumber: number, label: string, token: string): Promise<void> {
  const encodedLabel = encodeURIComponent(label)
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/labels/${encodedLabel}`
  const response = await githubApi('DELETE', url, token)
  if (!response.ok && response.status !== 404) {
    console.warn(`Warning: Failed to remove label "${label}" from ${repo}#${prNumber}: ${response.status}`)
  }
}
