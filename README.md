<p align="center">
  <a href="https://fingerprint.com">
    <picture>
     <source media="(prefers-color-scheme: dark)" srcset="https://fingerprintjs.github.io/home/resources/logo_light.svg" />
     <source media="(prefers-color-scheme: light)" srcset="https://fingerprintjs.github.io/home/resources/logo_dark.svg" />
     <img src="https://fingerprintjs.github.io/home/resources/logo_dark.svg" alt="Fingerprint logo" width="312px" />
   </picture>
  </a>
</p>
<p align="center">
  <a href="https://github.com/fingerprintjs/action-openapi-sync/actions/workflows/release.yml"><img src="https://github.com/fingerprintjs/action-openapi-sync/actions/workflows/release.yml/badge.svg" alt="Release status"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/:license-mit-blue.svg" alt="MIT license"></a>
  <a href="https://discord.gg/39EpE2neBg"><img src="https://img.shields.io/discord/852099967190433792?style=logo&label=Discord&logo=Discord&logoColor=white" alt="Discord server"></a>
</p>

# OpenAPI Sync Action

> [!WARNING]
> This repository isn't part of our core product. It's kindly shared "as-is" without any guaranteed level of
> support from Fingerprint. We warmly welcome community contributions.

> [!NOTE]
> This is a beta version of the OpenAPI Sync Action.

A GitHub Action that synchronizes OpenAPI schema files between repositories.

## Features

- **Internal content filtering** - Removes files and fields marked as internal
- **Diff support** - Only creates PRs when there are meaningful changes
- **Bundle support** - Handles both multi-file and bundled schemas
- **Warnings and Referencing PRs** - Links source and target PRs, adds warnings when source is unmerged
- **Scoped file cleanup** - Deletes target files no longer reachable from the source

## Usage

```yaml
- uses: actions/checkout@v4
  with:
    path: source

- name: Sync OpenAPI Schema
  uses: fingerprintjs/action-openapi-sync@v0.2.0
  with:
    source_path: source
    config_path: openapi-sync.config.yaml
    # You can also use source repository files
    # config_path: source/openapi-sync.config.yaml
    target_repo: your-openapi-repo
    target_branch: sync-openapi
    pr_title: 'Sync OpenAPI Schema'
    target_repo_github_token: ${{ secrets.TARGET_REPO_TOKEN }}
    source_repo_github_token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input                      | Required | Default                      | Description                                                                          |
|----------------------------|----------|------------------------------|--------------------------------------------------------------------------------------|
| `source_path`              | Yes      |                              | Source repository path                                                               |
| `config_path`              | Yes      |                              | Path to the sync config file relative to source repo root                            |
| `target_repo`              | Yes      |                              | Target repository name. Must be under the same owner as the source repo.             |
| `target_branch`            | Yes      |                              | Branch name for the PR in target repo                                                |
| `target_repo_github_token` | Yes      |                              | GitHub token for target repo access (checkout, PR creation, labels, status comments) |
| `source_repo_github_token` | No       |                              | GitHub token for source repo access (commenting on source PRs)                       |
| `pr_title`                 | No       | `Sync OpenAPI Schema`        | Pull Request title                                                                   |
| `commit_message`           | No       | `chore: sync OpenAPI schema` | Commit message                                                                       |
| `labels`                   | No       |                              | Comma-separated PR labels                                                            |
| `dry_run`                  | No       | `false`                      | Only report diff, do not create PR                                                   |
| `source_pr_number`         | No       |                              | Source PR number (for commenting on source PR with target PR link)                   |
| `source_pr_merged`         | No       | `true`                       | Whether the source PR is merged. If `false`, adds a warning to the target PR         |
| `comment_on_source_pr`     | No       | `true`                       | Whether to post a link comment on the source PR                                      |

## Outputs

| Output             | Description                                               |
|--------------------|-----------------------------------------------------------|
| `has_diff`         | Whether meaningful changes were detected (`true`/`false`) |
| `diff_summary`     | Summary of changes                                        |
| `target_pr_number` | PR number created/updated in target repo                  |

## Config File

The sync config file lives in the source repo and is referenced with the `config_path` input.

### Multi-file mode

```yaml
entrypoint: api/server-api.yaml
mode: multi_file

file_mappings:
  # Exact file mapping (e.g. rename the entrypoint)
  - source: api/server-api.yaml
    target: schemas/server-api.yaml

  # Directory mappings
  - source_dir: api/components
    target_dir: schemas/components

  - source_dir: api/paths
    target_dir: schemas/paths
    exclude_from_deletion:
      - "examples/**"

internal:
  internal_marker: x-internal
  strip_fields:
    - x-internal
    - x-custom-vendor-extension-to-strip
  exclude_patterns: []
```

### Bundled mode

For pre-bundled single-file schemas:

```yaml
entrypoint: api/dist/server-api.yaml
mode: bundled

file_mappings:
  - source: api/dist/server-api.yaml
    target: schemas/server-api.yaml

internal:
  internal_marker: x-internal
  strip_fields:
    - x-internal
    - x-custom-vendor-extension-to-strip
  exclude_patterns: []
```

In bundled mode the action only reads the pre-built `entrypoint` file, strips internal fields, and writes a single cleaned file to the target. No `$ref` resolution is implemented.

## Filtering

The action filters internal content at multiple levels:

**File-level** - Skip entire file if top-level `x-internal: true` is present, or if the file path matches an `exclude_patterns` glob.

**Path operations** - Remove operations (GET, POST, etc.) marked `x-internal: true`. If all operations on a path are internal, the entire path is removed.

**Parameters** - Remove individual parameters marked `x-internal: true`.

**Schema properties** - Remove properties marked `x-internal: true`.

**Dangling `$ref` cleanup** - After filtering, any `$ref` pointing to an excluded file is removed.

**Orphaned file removal** - After filtering and dangling ref cleanup, files no longer reachable from the entrypoint are excluded.

**Field stripping** - All keys listed in `strip_fields` are removed from the output.

**`externalValue` support** - Files referenced via OpenAPI `externalValue` are included in ref resolution.

## Full Workflow Example

```yaml
name: Sync OpenAPI Schema

on:
  pull_request:
    types: [opened, synchronize, reopened, closed, labeled]
    branches: [main]
    paths:
      - 'api/**'
  workflow_dispatch:
    inputs:
      target_branch:
        description: 'Target branch name in OpenAPI repo'
        required: true
        default: 'sync-openapi'
      pr_title:
        description: 'PR Title'
        required: true
        default: 'Sync OpenAPI Schema'
      dry_run:
        description: 'Dry run'
        type: boolean
        default: false

permissions:
  contents: read
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event.action == 'closed' && github.event.pull_request.merged) ||
      (github.event.action == 'labeled' && github.event.label.name == 'OpenAPI')
    steps:
      - uses: actions/checkout@v4
        with:
          path: source

      - name: Sync OpenAPI
        uses: fingerprintjs/openapi-sync-action@v0.2.0
        with:
          source_path: source
          config_path: source/openapi-sync.config.yaml
          target_repo: your-openapi-repo
          target_branch: ${{ inputs.target_branch || format('sync-{0}', github.event.pull_request.number) }}
          pr_title: ${{ inputs.pr_title || format('Sync OpenAPI Schema (#{0})', github.event.pull_request.number) }}
          target_repo_github_token: ${{ secrets.TARGET_REPO_TOKEN }}
          source_repo_github_token: ${{ secrets.GITHUB_TOKEN }}
          source_pr_number: ${{ github.event.pull_request.number }}
          source_pr_merged: ${{ github.event.pull_request.merged || 'true' }}
          dry_run: ${{ inputs.dry_run || false }}
```

You can also use the `actions/create-github-app-token` action to generate a GitHub token for the target (and source) repository:

```yaml
- name: Get GitHub App token
  uses: actions/create-github-app-token@f2acddfb5195534d487896a656232b016a682f3c
  id: app-token
  with:
    app-id: ${{ vars.RUNNER_APP_ID }}
    private-key: ${{ secrets.RUNNER_APP_PRIVATE_KEY }}
    repositories: your-openapi-repo

- name: Run OpenAPI Sync
  uses: fingerprintjs/openapi-sync-action@v0.2.0
  with:
    # ...
    target_repo_github_token: ${{ steps.app-token.outputs.token }}
```

## Development

Install dependencies

```bash
pnpm install
```

Run `prepare` to install git hooks

```bash
pnpm prepare
```

Run `test`, `lint`, `format` on development

```bash
pnpm test:coverage
pnpm lint
# or pnpm lint:fix
pnpm format
# or pnpm format:fix
```

Build files

```bash
pnpm build
```
