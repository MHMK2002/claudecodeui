# Commit-message generator session reuse investigation

## Trace summary

1. `POST /api/git/generate-commit-message` calls `gitCommitMessageService.generate`.
2. Git builds a bounded prompt from the frozen staged index and calls
   `providerTextCompletionService.complete`.
3. The completion service previously generated a new lifecycle id for every
   request and discarded `writer.setSessionId`.
4. The provider runtime therefore had no provider-native session id to resume,
   so Claude, Codex, Cursor, and OpenCode each created a new native session.
5. Provider filesystem synchronization could later index those native sessions
   as visible application Chat sessions because their isolated temporary cwd
   was not excluded from session persistence.

## Verified root cause

The lifecycle id required for per-request cancellation was also being used as
the only session lookup key. Because it was intentionally transient and the
native id callback was ignored, no state connected one generation to the next.

## Resolution

- Keep a fresh lifecycle id for every request so cancellation remains precise.
- Cache the provider-native session id by authenticated user, project,
  provider, profile, model, and effort, with a 100-entry in-memory bound.
- Resume the cached native session on the next matching generation.
- Recreate the same empty isolated cwd for resumed turns, then delete it again
  in `finally`; this supports providers that bind session lookup to cwd without
  retaining project data.
- Do not persist provider sessions whose cwd uses the generator-owned temporary
  prefix, and suppress watcher updates for rows that were intentionally not
  indexed.
- Reduce the bounded provider input to at most 16 KiB of patch excerpts, 8 KiB
  of metadata, 10 recent subjects of 120 bytes each, request low reasoning
  effort where supported, and require a response under 600 characters.

## Side effects and boundaries

- Changing project, provider, profile, or model intentionally creates a
  separate hidden native session.
- The reuse cache is process-local and bounded; a server restart or cache
  eviction can create one new native session for that scope.
- Provider-native history remains owned by the third-party provider and is not
  deleted. Only CloudCLI's derived session index row is suppressed or removed.
- A failed resumed run invalidates its cached native id so recovery does not
  repeatedly resume a broken session. Cancellation and timeout keep the id.

## Verification evidence

- RED: five focused assertions reproduced missing native-session reuse,
  transient/native id conflation, visible indexing, absent project scope, and
  oversized prompt budgets.
- GREEN: 31 focused backend tests passed after the correction.
- A second RED/GREEN cycle verified that resumed sessions reuse the same
  isolated cwd while cleanup remains per request.

## Runtime regression evidence (2026-08-17)

### Trace and hypothesis

The user's post-fix Generate attempt still opened a Chat. The request reached
the long-running backend processes started on 2026-08-15, while the corrected
session-indexing files were modified on 2026-08-17. The active database at
`~/.cloudcli/auth.db` contained two generated Chat rows whose titles began with
the old `Generate a conventional commit message...` prompt and whose cwd was
the registered project. This falsified a frontend-only explanation: the live
server was executing the pre-fix route/runtime.

### Resolution

Complete and verify the global Settings work first, then restart the stale
backend exactly once and smoke-test the real endpoint. The new generation
request carries only project id and staged paths; the server resolves the
authenticated user's global provider/profile/model/effort/base-prompt setting.
No client selection or editable prompt can restore the legacy project-cwd path.

### Side effects and boundaries

- Restarting clears the in-memory hidden-session reuse cache, so the first
  generation after restart may create one new provider-native hidden session.
- The additive user-table migration preserves existing identity and session
  rows. Missing Generator settings receive a low-token runtime default until
  the user saves the global card.
- Existing legacy Chat rows are diagnostic evidence and are not deleted
  automatically; destructive cleanup requires a separate user request.

### Final verification

- Global Settings/Generator focus: 49 backend and 23 frontend tests passed.
- Full suites: server and frontend test commands exited successfully; all 50
  Playwright E2E tests, 4 a11y/contrast tests, and 117 Desktop tests passed.
- Production client/server build, Storybook build, TypeScript typecheck,
  UX audit, and lint (0 errors; existing warnings only) passed.
- The stale process on `127.0.0.1:64728` was replaced by the final verified
  source server. Health reports PID `8090` with build
  `1.37.0-mswx01hq-f1d8fdaca5009f4dd07a3188`, and the
  additive Generator columns exist in the live database.
- No live provider was called during final smoke verification, intentionally
  avoiding extra provider tokens. The HTTP journey uses deterministic mocks;
  the real Git/service/provider isolation path is covered by temporary-repo
  integration tests.
