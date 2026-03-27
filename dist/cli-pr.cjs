"use strict";

// src/cli-pr.ts
var import_node_util = require("node:util");

// src/pr.ts
var COMMENT_TAG_LINK = "<!-- openapi-sync-link -->";
var COMMENT_TAG_STATUS = "<!-- openapi-sync-status -->";
var WARNING_LABEL = "Not Completed";
async function handlePrLifecycle(options) {
  const {
    sourceGithubToken: sourceGithubToken2,
    targetGithubToken: targetGithubToken2,
    sourceRepo,
    sourcePrNumber,
    sourcePrMerged,
    targetRepo,
    targetPrNumber,
    commentOnSourcePr = true
  } = options;
  const targetPrUrl = `https://github.com/${targetRepo}/pull/${targetPrNumber}`;
  if (sourceGithubToken2 && commentOnSourcePr) {
    const linkBody = `${COMMENT_TAG_LINK}
OpenAPI Sync PR: [${targetRepo}#${targetPrNumber}](${targetPrUrl})`;
    await upsertComment(sourceRepo, sourcePrNumber, COMMENT_TAG_LINK, linkBody, sourceGithubToken2);
  }
  if (!sourcePrMerged) {
    await addLabel(targetRepo, targetPrNumber, WARNING_LABEL, targetGithubToken2);
    const statusBody = `${COMMENT_TAG_STATUS}
\u26A0\uFE0FThe changes are not finalized yet. Do not merge this PR until the changes are ready.`;
    await upsertComment(targetRepo, targetPrNumber, COMMENT_TAG_STATUS, statusBody, targetGithubToken2);
  } else {
    await removeLabel(targetRepo, targetPrNumber, WARNING_LABEL, targetGithubToken2);
    const statusBody = `${COMMENT_TAG_STATUS}
\u2705The changes have been finalized. This PR is ready for review.`;
    await upsertComment(targetRepo, targetPrNumber, COMMENT_TAG_STATUS, statusBody, targetGithubToken2);
  }
}
async function upsertComment(repo, prNumber, tag, body, token) {
  const existing = await findComment(repo, prNumber, tag, token);
  if (existing) {
    const url = `https://api.github.com/repos/${repo}/issues/comments/${existing.id}`;
    const response = await githubApi("PATCH", url, token, { body });
    if (!response.ok) {
      console.warn(`Warning: Failed to update comment on ${repo}#${prNumber}: ${response.status}`);
    }
  } else {
    const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
    const response = await githubApi("POST", url, token, { body });
    if (!response.ok) {
      console.warn(`Warning: Failed to create comment on ${repo}#${prNumber}: ${response.status}`);
    }
  }
}
async function findComment(repo, prNumber, tag, token) {
  let url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  while (url) {
    const response = await githubApi("GET", url, token);
    if (!response.ok) {
      console.warn(`Warning: Failed to list comments on ${repo}#${prNumber}: ${response.status}`);
      return null;
    }
    const comments = await response.json();
    if (!Array.isArray(comments)) {
      return null;
    }
    const found = comments.find((c) => c.body.includes(tag));
    if (found) {
      return found;
    }
    url = getNextPageUrl(response);
  }
  return null;
}
function getNextPageUrl(response) {
  const link = response.headers.get("link");
  if (!link) {
    return null;
  }
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match?.[1] ?? null;
}
async function githubApi(method, url, token, body) {
  const options = {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    }
  };
  if (body !== void 0) {
    options.body = JSON.stringify(body);
  }
  return fetch(url, options);
}
async function addLabel(repo, prNumber, label, token) {
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/labels`;
  const response = await githubApi("POST", url, token, { labels: [label] });
  if (!response.ok) {
    console.warn(`Warning: Failed to add label "${label}" to ${repo}#${prNumber}: ${response.status}`);
  }
}
async function removeLabel(repo, prNumber, label, token) {
  const encodedLabel = encodeURIComponent(label);
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/labels/${encodedLabel}`;
  const response = await githubApi("DELETE", url, token);
  if (!response.ok && response.status !== 404) {
    console.warn(`Warning: Failed to remove label "${label}" from ${repo}#${prNumber}: ${response.status}`);
  }
}

// src/cli-pr.ts
var { values: args } = (0, import_node_util.parseArgs)({
  options: {
    "source-repo": { type: "string" },
    "source-pr": { type: "string" },
    "source-pr-merged": { type: "string", default: "true" },
    "target-repo": { type: "string" },
    "target-pr": { type: "string" },
    "comment-on-source-pr": { type: "string", default: "true" }
  },
  strict: true
});
var targetGithubToken = process.env.TARGET_REPO_GITHUB_TOKEN;
var sourceGithubToken = process.env.SOURCE_REPO_GITHUB_TOKEN;
if (!targetGithubToken || !args["source-repo"] || !args["source-pr"] || !args["target-repo"] || !args["target-pr"]) {
  console.error(
    "Error: TARGET_REPO_GITHUB_TOKEN env var, --source-repo, --source-pr, --target-repo, and --target-pr are required"
  );
  process.exit(1);
}
handlePrLifecycle({
  sourceGithubToken,
  targetGithubToken,
  sourceRepo: args["source-repo"],
  sourcePrNumber: parseInt(args["source-pr"], 10),
  sourcePrMerged: args["source-pr-merged"] === "true",
  targetRepo: args["target-repo"],
  targetPrNumber: parseInt(args["target-pr"], 10),
  commentOnSourcePr: args["comment-on-source-pr"] === "true"
}).then(() => {
  console.log("PR lifecycle actions completed.");
}).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
