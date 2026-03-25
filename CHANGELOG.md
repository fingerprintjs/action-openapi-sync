# action-openapi-sync

## 0.2.1

### Patch Changes

- Move dry_run handling from sync CLI to action workflow level. ([885beb2](https://github.com/fingerprintjs/action-openapi-sync/commit/885beb23ecdcf2f23bd7f0f64f32e3dad1817f3d))

## 0.2.0

### Minor Changes

- Added `source_path` input to make the source repository path configurable instead of hardcoded to _source_. ([249cccf](https://github.com/fingerprintjs/action-openapi-sync/commit/249cccfe7b7d1683f5a3fc8830188279c8455e92))
- Split `github_token` into `target_repo_github_token` and `source_repo_github_token`. ([d2f75be](https://github.com/fingerprintjs/action-openapi-sync/commit/d2f75bec7b101f11e0d46c1e386cffd161b1a691))
- Add diff patch artifact upload ([33354c2](https://github.com/fingerprintjs/action-openapi-sync/commit/33354c27f2ab60b825e16f426f4d82e83be5151a))
- Add `comment_on_source_pr` option. ([bca0d8e](https://github.com/fingerprintjs/action-openapi-sync/commit/bca0d8e5318e2960a9ff4c892daf28df65baeaa7))
- Replaced GitHub App authentication (`app_id` & `app_private_key`) with a single required `github_token` input. ([2e43f26](https://github.com/fingerprintjs/action-openapi-sync/commit/2e43f26b255eb1968ea645b78a9207ed8f930912))
