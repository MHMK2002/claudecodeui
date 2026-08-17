# Commit message generator: requirements and implementation plan

Status: implemented and verified on 2026-08-17. The original plan below is supplemented by the accepted global-settings amendment.

## Accepted global-settings amendment (2026-08-17)

This amendment supersedes any conflicting provider-selection or no-migration text later in this document:

- Commit-message generation uses one authenticated-user setting shared by every project, not Chat/localStorage selection.
- Settings → Git contains one polished card for provider, Claude/Codex profile, model, model-supported effort, and a free-form base prompt.
- The base prompt has a visible length budget and a neutral `Restore default` action. The page retains one primary Save action for Git identity and generator settings together.
- The server validates provider/profile/model/effort against the shared catalog before persistence and again before execution. Invalid or unavailable saved selections fail visibly and never switch provider silently.
- The editable prompt controls style and format only. Fixed server instructions, untrusted-data delimiters, no-tool/read-only execution, bounded input, output normalization, and all other safety guards cannot be replaced by user text.
- The backend, not the generation request, resolves the saved selection and prompt. `POST /api/git/generate-commit-message` accepts only the project id and expected staged files.
- New users receive a low-token default: the first available catalog selection, the lowest supported effort (prefer `minimal`, then `low`), and the built-in concise style prompt. Existing users require a small additive database migration for the global fields.
- Generation continues to reuse one hidden provider-native conversation per project and selection, while creating no CloudCLI Chat row and opening no Chat UI.

## Executor brief

Implement an inline, AI-assisted commit-message suggestion flow in Source Control > Changes. The user must review and explicitly commit the message. The generator must analyze exactly the staged Git index snapshot, must not mutate the project, and must not create a visible Chat session.

Before changing code:

1. Read `AGENTS.md`, `RTK.md`, `UX_Design.md`, and the backend module standards.
2. Re-read every target file from the live working tree. The repository currently has user-owned uncommitted changes in the Git UI, Git backend, provider catalog, and related tests.
3. Preserve those changes. Do not restore files from `HEAD`, overwrite whole files, reset, branch, commit, rebase, or push.
4. Prefix shell commands with `rtk`.
5. Treat this document as the accepted scope. Stop and ask only if the live code makes a requirement contradictory or impossible.

## Goal

Let a user stage changes, request a commit-message suggestion from the currently selected AI provider, edit or reject that suggestion, and then use the existing Commit action.

The result must preserve the Source Control contract:

- `Commit` remains the only visually primary CTA.
- `Generate message`, `Cancel`, `Use suggestion`, `Dismiss`, `Update suggestion`, and recovery actions are neutral.
- Generation never stages, unstages, edits, commits, pushes, or publishes anything.
- The manual commit workflow continues to work when AI is unavailable.

## Why the legacy path cannot simply be wired to the UI

The repository already contains a dormant generator route and controller method, but they predate the current provider and Source Control contracts:

- `server/modules/git/git.routes.ts` uses `git diff HEAD`, which can include unstaged edits from a file that also has staged edits.
- The same route falls back to reading working-tree files, which is not staged-only behavior.
- `/api/git/commit` runs `git add` again before committing, so unstaged edits can enter the commit after the user reviewed the staged index.
- The generator accepts only Claude or Cursor, sends only a provider name, ignores the selected profile and model, and hard-codes a Claude model.
- Provider failures are converted into generic `chore` messages that look like successful AI output.
- Provider execution uses bypass/skip-permission modes and can receive the project working directory.
- The route owns diff collection, prompt policy, provider execution, stream parsing, cleanup, fallback policy, and logging instead of delegating to typed services.
- The frontend function is returned by `useGitPanelController`, but `GitPanel`, `ChangesView`, and `CommitComposer` do not wire it into the journey.

The implementation must replace this behavior, not expose it unchanged.

## Confirmed product decisions

| ID | Decision |
| --- | --- |
| D1 | The generator lives inline in the existing Commit Composer; it does not open a modal or a separate workspace. |
| D2 | `Commit` remains the only primary CTA. The generator is a neutral assistant action. |
| D3 | Generation is explicit. Staging files never auto-generates a message. |
| D4 | The server-side Git index is the source of truth. Only `git diff --cached` data may inform a suggestion. |
| D5 | Generation supports every provider in the shared catalog: Claude, Codex, Cursor, and OpenCode. |
| D6 | The generator uses the globally saved complete selection: provider, provider profile where applicable, model, and effort. The server never trusts a per-request selection and never silently switches provider. |
| D7 | Provider/profile/model/effort and the style base prompt live only in Settings → Git, not in the Source Control journey. An unavailable saved selection recovers through Settings. |
| D8 | Inline disclosure states that a bounded staged snapshot and recent commit subjects are sent to the selected provider. No first-use modal is added. |
| D9 | With enough repository history, the model follows the repository's recent message style and language. Otherwise it falls back to an English Conventional Commit. |
| D10 | A generated message is always a draft. The user may edit, dismiss, replace, or keep it. There is no automatic commit or push. |
| D11 | Existing non-empty or newly edited input is never overwritten by an asynchronous suggestion. |
| D12 | A generated draft is associated with a server-derived staged snapshot fingerprint. A stale generated draft requires regeneration or explicit conversion to a manual message before Commit is enabled. |
| D13 | Generation is cancellable, times out, ignores late/stale responses, and uses inline persistent success/error/recovery feedback rather than transient toasts. |

## User journey

```text
Review changes
    -> Stage files
    -> Generate message
    -> Check provider selection
    -> Generate from the staged snapshot
    -> Review/edit/use/dismiss suggestion
    -> Commit
```

### Common path

1. The user reviews diffs and stages one or more files.
2. The expanded Commit Composer shows a neutral `Generate message` action near the textarea.
3. Supporting text identifies the selected provider and discloses the data boundary, for example: `Uses Codex to analyze a bounded snapshot of staged changes and recent commit subjects.`
4. Clicking `Generate message` first resolves the stored provider/profile/model against the shared catalog.
5. While the catalog is being checked, show `Checking provider…` in a polite live region.
6. While the request runs, show `Generating from 3 staged files…` and a neutral `Cancel` action. Do not invent finer-grained backend stages unless the API actually reports them.
7. If the textarea was empty when generation began and the user did not type while it ran, place the result in the textarea, focus it, position the caret at the end, and show `Suggestion ready. Review before committing.`
8. The user can edit the message and use the existing `Commit` action and confirmation flow.
9. After a successful commit, clear the draft, suggestion provenance, snapshot id, errors, and cached composer state for that project.

### Existing or concurrently edited input

- If the textarea was non-empty when generation began, do not replace it.
- If the user types while generation is running, do not replace the new input even if the request began with an empty textarea.
- Render the result in an inline suggestion panel with neutral `Use suggestion` and `Dismiss` actions.
- `Use suggestion` replaces the textarea and attaches the server snapshot id.
- `Dismiss` leaves the user's text and focus unchanged.
- If a valid manual message exists, `Commit` may remain enabled while generation runs. Starting Commit cancels/invalidates the in-flight suggestion before continuing.

### Staged changes change after generation

- Any in-app stage/unstage operation marks a generated draft stale immediately.
- A server snapshot mismatch detected during Commit also marks it stale, including same-path index changes made by another Git client.
- Preserve the message and show: `Staged changes changed after this suggestion was generated.`
- Disable `Commit` with an adjacent explanation that satisfies MCTA-5.
- Offer neutral `Update suggestion` and `Keep current message` actions.
- `Update suggestion` generates from the new snapshot. It may replace the old generated text only when that text was not manually edited; otherwise show the new result as a comparison suggestion.
- `Keep current message` explicitly converts the text to a manual draft, clears its old snapshot id, and re-enables Commit after the latest staged set is stable.

### No staged files or pending stage operations

- `Generate message` is disabled when zero files are staged.
- The nearby explanation is `Stage at least one file to generate a message.`
- Generation is also disabled while the optimistic stage/unstage queue is non-empty, with `Wait for staging to finish.`
- `Commit` retains its existing disabled-state explanations.

### Provider and generation failures

- Preserve the textarea, cached draft, staged files, and focus context.
- Provider unavailable, missing profile, or authentication failure: show the provider-specific reason and neutral `Open Agent Settings`.
- Catalog/network/generation/timeout/invalid-output failure: show the reason and neutral `Retry`.
- No staged changes or staged-set mismatch: refresh Source Control and show `Review staged changes`.
- Cancellation returns to the previous editable state without an error toast.
- Never turn an error into a generic successful message.

### Mobile and hidden-composer behavior

- All touch targets are at least 44 by 44 CSS pixels.
- The collapsed mobile label becomes `Write or generate commit message · N staged`.
- A running generation must remain visible. Do not hide its status merely because a file diff is expanded; keep a compact progress/recovery row visible or keep the composer visible until the request terminates.
- Avoid a fixed `max-height` that clips suggestion, stale, or error content.

## State model

Use an explicit state machine rather than independent booleans.

| State | Meaning | Allowed transitions |
| --- | --- | --- |
| `idle` | No request or active suggestion panel | `checking-provider`, `committing` |
| `checking-provider` | Lazy catalog resolution is running | `generating`, `error`, `cancelled` |
| `generating` | Backend is collecting/processing one stable staged snapshot | `applied`, `suggestion`, `error`, `cancelled`, `stale` |
| `applied` | Generated text owns the textarea and has a snapshot id | `stale`, `checking-provider`, `committing`, `idle` |
| `suggestion` | Generated text is shown separately because user input is protected | `applied`, `idle`, `stale` |
| `stale` | Generated provenance no longer matches the index | `checking-provider`, `manual`, `idle` |
| `manual` | User explicitly owns the draft; no generation snapshot is enforced | `checking-provider`, `committing`, `idle` |
| `error` | A typed, recoverable generation error is visible | `checking-provider`, `idle` |
| `cancelled` | Request was cancelled without changing input | `idle`, `checking-provider` |

State invariants:

- Only one request per composer may be active.
- Every request has a local request id, project id, sorted staged-file key, draft revision, and `AbortController`.
- A response is ignored when its request id, project id, staged-file key, or draft-overwrite precondition is no longer current.
- The project-keyed cache stores the message plus manual/generated provenance and snapshot id, not only the string.
- Unmount, project switch, successful commit, or a newer generation aborts/invalidates the previous request.

## Functional requirements

### FR-1: Source Control integration

- Wire generation through `GitPanel` -> `ChangesView` -> `CommitComposer` without adding a new navigation destination.
- Pass the database project id to API calls; never send a client-supplied filesystem path.
- Keep the Commit Composer's existing manual typing, direction detection, cache, keyboard commit shortcut, and confirmation behavior.

Acceptance:

- Source Control has exactly one primary `Commit` control in every normal Changes state.
- No generator action appears outside the Commit Composer or its compact in-progress row.

### FR-2: Full provider selection

- Lazily load/reuse the shared provider catalog on the first Generate action.
- Read the stored provider, provider profile, and per-provider model using one shared preference parser.
- Reconcile only within the stored provider using `resolveValidSelection` semantics.
- Send the resolved triple to the backend and validate it again server-side for the authenticated user.
- Support Claude, Codex, Cursor, and OpenCode through the provider module's public API.

Acceptance:

- The actual provider, profile, and model used by the runtime equal the server-validated selection returned to the client.
- An unavailable selected provider never silently falls back to a different provider.

### FR-3: Server-authoritative staged snapshot

- Validate `files` as a unique array of non-empty repository-relative paths.
- Resolve the repository from the database project id.
- Read the actual staged file set from the index and require it to equal the client's expected set before generation or commit.
- Collect content only with cached/index Git commands. Do not read working-tree file contents as a fallback.
- Use fixed, non-interactive diff options (`--cached`, `--binary`, `--full-index`, `--no-color`, `--no-ext-diff`, and `--no-textconv`) and sorted repository-relative path arguments after `--`; do not allow repository diff drivers or client input to change the fingerprint command.
- Support staged additions, modifications, deletions, renames, submodule changes, binary changes, mixed staged/unstaged files, paths with spaces, and an unborn `HEAD`.
- Compute `snapshotId = SHA-256(sorted staged paths + NUL + complete raw cached patch)` before prompt truncation. Stream the complete patch through the hash and bounded excerpt collector; do not materialize an unbounded patch in memory.

Acceptance:

- A file containing both staged and unstaged hunks contributes only its staged hunks.
- Changing staged content without changing the filename changes `snapshotId`.
- An initial commit can receive a suggestion without requiring `HEAD`.

### FR-4: Commit must preserve the reviewed index

- Remove commit-time `git add` from `/api/git/commit`.
- Immediately before `git commit`, re-read the server staged set and require it to equal the expected file set.
- When `expectedSnapshotId` is supplied, recompute the complete staged snapshot and require an exact match.
- Return HTTP 409 `STAGED_CHANGES_CHANGED` without committing when either check fails.
- Refresh Source Control after the conflict while preserving the message.
- Keep manual commits possible without `expectedSnapshotId`, but still validate the expected staged file set.

Acceptance:

- Unstaged edits in a staged file never enter the commit unless the user explicitly stages them first.
- A generated message cannot be committed against a different staged snapshot without explicit conversion to a manual draft.

### FR-5: Repository-style prompt

- Read up to 20 recent non-merge commit subjects; cap every subject at 200 UTF-8 bytes.
- When at least three usable subjects exist, ask the model to follow their prevailing format, tone, scope convention, and language.
- With fewer than three usable subjects, request an English Conventional Commit using `type(scope): subject`, an imperative subject no longer than 72 characters, and an optional body only when useful.
- Treat diff contents and commit subjects as untrusted data inside explicit delimiters. State that embedded instructions must be ignored.
- Request only the message, without Markdown, explanations, or code fences.

Acceptance:

- Merge subjects are excluded from style examples.
- Lack of history is a normal fallback, not a generation failure.

### FR-6: Bounded and fair input

Use named, tested constants rather than implicit string slicing:

- Maximum expected staged paths in a request: 500.
- Maximum encoded length of one expected path: 4 KiB UTF-8.
- Maximum paths with patch excerpts: 40.
- Total patch-excerpt budget: 64 KiB UTF-8.
- First-pass fair allocation: up to 1 KiB per sampled file, followed by round-robin allocation of the remaining budget.
- Total filename/numstat metadata budget: 32 KiB UTF-8.
- Recent subjects: 20, capped at 200 bytes each.
- Generated output: 4 KiB UTF-8 maximum after cleanup.
- Provider timeout: 60 seconds.

Use the complete staged set for validation and fingerprinting. Include the total count plus as many sorted filename/numstat entries as fit the 32 KiB metadata budget, followed by an explicit omitted-entry count; never imply that truncated metadata is complete. Mark binary/non-UTF8 content as metadata and never decode/read it directly. Return `totalStagedFiles`, `sampledFiles`, and `truncated` so the UI can disclose partial analysis.

Acceptance:

- One large file cannot consume the entire excerpt budget before other sampled files receive their first allocation.
- Truncation is explicit; it is never a silent first-N-character cut.

### FR-7: Output normalization

- Trim whitespace, surrounding quotes, Markdown fences, and explanatory prefaces.
- Preserve a valid multi-line subject/body.
- Reject empty output, output containing NUL/control payloads, or output that remains above 4 KiB after safe cleanup.
- Return a typed failure instead of inserting a hard-coded fallback.

### FR-8: Cancellation and stale-response safety

- The frontend aborts the active request on `Cancel`, project switch, unmount, successful Commit, or superseding generation.
- The backend binds client disconnect and timeout to the provider runtime's abort API.
- Use a transient runtime id as the provider session key so abort works before a provider-native id is discovered.
- If a provider cannot be aborted safely, the client must still ignore its late result and the backend must terminate it at the timeout boundary.

Acceptance:

- Cancelled and late requests never modify the textarea or show a success state.
- Cancellation does not create a false error recovery state.

## Security, privacy, and side-effect requirements

### SEC-1: Project isolation

- The provider receives only the bounded prompt; it is never given the registered project's path as its working directory.
- Run the provider in an isolated temporary directory and remove it in `finally`.
- Use each provider's existing plan/read-only mode and explicitly disallow tools where supported.
- Never use `bypassPermissions`, `skipPermissions`, auto-approval, or a project-writable sandbox for this feature.
- If safe non-writing execution cannot be guaranteed for a provider, return `PROVIDER_UNSUPPORTED_FOR_GENERATION`; do not weaken the invariant.

### SEC-2: No product mutation

- Capture the repository status/index/HEAD before and after provider execution in integration tests.
- Generation must not change files, the index, refs, commits, remotes, settings, tasks, or schedules.
- Generation must not invoke Commit, Push, Publish, or any write route.

### SEC-3: No visible Chat session

- Use a transient runtime lifecycle id, but never create an application session row or emit the run into the Chat session store.
- Running a suggestion must not add a visible session under the registered project.
- Provider-native local history that the third-party CLI creates outside CloudCLI is not deleted automatically; document this as provider behavior rather than performing destructive cleanup.

### SEC-4: Logging and transport

- Add `Cache-Control: no-store` to generation responses.
- Never log raw patches, filenames, absolute paths, prompts, recent subjects, generated messages, tokens, or provider profile secrets.
- Structured logs may contain only request/generation id, provider id, counts, truncation flag, duration, outcome code, and cancellation/timeout state.

## API contract

Keep the existing path to minimize unnecessary surface change:

`POST /api/git/generate-commit-message`

Request:

```json
{
  "project": "project-id",
  "files": ["src/app.ts", "src/view.tsx"],
  "selection": {
    "provider": "codex",
    "providerProfileId": 12,
    "model": "gpt-5.4"
  }
}
```

Success, HTTP 200:

```json
{
  "success": true,
  "message": "feat(git): generate commit suggestions",
  "snapshotId": "sha256-hex",
  "selection": {
    "provider": "codex",
    "providerProfileId": 12,
    "model": "gpt-5.4"
  },
  "analysis": {
    "totalStagedFiles": 2,
    "sampledFiles": 2,
    "recentSubjects": 20,
    "truncated": false
  }
}
```

Failure shape:

```json
{
  "success": false,
  "code": "PROVIDER_UNAVAILABLE",
  "error": "Codex is unavailable",
  "details": "Connect or repair Codex in Agent Settings.",
  "action": "OPEN_AGENT_SETTINGS"
}
```

Generation-specific error codes:

| HTTP | Code | Recovery |
| ---: | --- | --- |
| 400 | `INVALID_GENERATION_REQUEST` | Correct/retry after refresh |
| 413 | `TOO_MANY_STAGED_FILES` | Review/split the staged change before generating |
| 409 | `NO_STAGED_CHANGES` | `REVIEW_STAGED_CHANGES` |
| 409 | `STAGED_CHANGES_CHANGED` | Refresh, then `Update suggestion` |
| 409 | `PROVIDER_UNAVAILABLE` | `OPEN_AGENT_SETTINGS` |
| 409 | `PROVIDER_PROFILE_UNAVAILABLE` | `OPEN_AGENT_SETTINGS` |
| 409 | `MODEL_UNAVAILABLE` | Reload the catalog or `OPEN_AGENT_SETTINGS` |
| 409 | `PROVIDER_UNSUPPORTED_FOR_GENERATION` | `OPEN_AGENT_SETTINGS` |
| no response after disconnect | `GENERATION_CANCELLED` (internal outcome) | No error UI |
| 502 | `GENERATION_FAILED` | `RETRY` |
| 502 | `INVALID_GENERATED_MESSAGE` | `RETRY` |
| 504 | `GENERATION_TIMEOUT` | `RETRY` |

Update `POST /api/git/commit` request:

```json
{
  "project": "project-id",
  "message": "feat(git): generate commit suggestions",
  "files": ["src/app.ts", "src/view.tsx"],
  "expectedSnapshotId": "optional-sha256-hex"
}
```

`expectedSnapshotId` is present for generated/edited-generated drafts and absent for manual drafts. The server always validates the exact expected staged path set. A mismatch returns HTTP 409 `STAGED_CHANGES_CHANGED` and does not run `git commit`.

## Backend architecture

### Provider text-completion service

Add `server/modules/providers/services/provider-text-completion.service.ts` and export only its required public API through `server/modules/providers/index.ts`.

Responsibilities:

- Validate the complete selection for the authenticated user through `providerSelectionService`.
- Resolve Claude/Codex runtime profiles inside the Providers module.
- Dispatch any catalog provider through `providerRuntimeService`.
- Normalize assistant text from legacy and normalized provider events.
- Run with a transient lifecycle id, isolated temporary cwd, verified non-writing options, timeout, and abort handling.
- Return typed text or a typed provider/completion error.
- Never know about Git, staged files, commit formats, or UI concerns.

Use existing shared types where available. If the completion input/result types are consumed by both Git and Providers, define and document them in `server/shared/types.ts` following the repository grouping-comment convention. Do not create module-local `types.ts`, `interfaces.ts`, or `utils.ts` files.

### Git commit-message service

Add `server/modules/git/git-commit-message.service.ts`.

Responsibilities:

- Inspect and validate the staged index.
- Produce the complete fingerprint and the bounded prompt input.
- Read recent non-merge subjects.
- Build the repository-style/fallback prompt.
- Call the injected provider text-completion contract.
- Normalize/validate the output and return response metadata.
- Recompute/validate the staged set and snapshot for Commit.

Keep helpers that have one consumer in this service. Move a helper to `server/shared/utils.ts` only if a second backend module genuinely uses it, and add the required doc comment/grouping.

### Thin routes and composition

- `git.routes.ts` parses/validates HTTP fields, obtains the authenticated user id, calls the commit-message service, and maps typed results/errors to status codes.
- It must not collect patches, build prompts, parse provider events, read fallback files, or choose provider models.
- `git.module.ts` assembles the service dependencies.
- `server/index.ts` passes the Providers public completion dependency into `createGitModule`; remove the Git module's direct Claude/Cursor runner dependency once unused.
- Preserve `server/modules/git/index.ts` as a deliberate narrow barrel. Do not export the internal Git service unless another module consumes it.

## Frontend architecture

### Shared provider preference/catalog access

- Replace the provider-name-only Git hook with a complete stored-selection reader.
- Reuse the catalog cache and `resolveValidSelection`; expose a lazy catalog loader if needed rather than mounting a new eager catalog request for every Git panel.
- Remove `useSelectedProvider.ts` only after confirming it has no remaining consumers.

### Suggestion controller hook

Add `src/components/git-panel/hooks/useCommitMessageSuggestion.ts`.

Responsibilities:

- Own the explicit state machine, request ids, `AbortController`, timeout/cancel presentation state, and stale-response guards.
- Resolve the current provider selection lazily.
- Call and decode the typed generation endpoint.
- Protect manual drafts through a draft-revision precondition.
- Track generated/manual provenance, snapshot id, staged-file key, partial-analysis metadata, and typed errors.
- Expose actions used by the Composer: Generate, Cancel, Retry, Use, Dismiss, Update, and Keep as manual.

Keep generation state out of the already large `useGitPanelController`. Remove the dormant `generateCommitMessage` method from that controller and from `GitPanelController` once the new hook owns it.

### Commit Composer

- `GitPanel` passes project id and `Open Agent Settings` recovery.
- `ChangesView` passes the real staged paths and whether stage operations are pending.
- `CommitComposer` remains the visual owner of the draft and renders generation states inline.
- Extend the project-keyed cache to retain provenance/snapshot metadata safely.
- Update the Commit callback/result type so `STAGED_CHANGES_CHANGED` is handled inside the Composer without discarding the draft or replacing the whole Source Control surface.
- Ensure ordinary Git commit failures continue to use the canonical Git recovery behavior.

## Expected file change map

The implementer must confirm the live tree before editing; names below describe the intended ownership, not permission to overwrite user changes.

| File | Planned change |
| --- | --- |
| `UX_Design.md` | Add Generator as a neutral Source Control action and add staged-only, draft-preservation, provider-recovery, cancellation, and no-auto-commit checklist items. |
| `server/shared/types.ts` | Add cross-module provider-completion types only if structurally required. |
| `server/modules/providers/services/provider-text-completion.service.ts` | New provider-agnostic, abortable, isolated text-completion service. |
| `server/modules/providers/index.ts` | Export/document the public completion service used by Git. |
| `server/modules/providers/tests/provider-text-completion.service.test.ts` | Provider output, profile/model, read-only options, abort, timeout, cleanup, and logging tests. |
| `server/modules/git/git-commit-message.service.ts` | New staged snapshot, budgeting, prompt, normalization, and commit-precondition service. |
| `server/modules/git/git.routes.ts` | Replace legacy generator body with a thin typed route; remove fake fallback/logging; stop commit-time restaging; add 409 checks. |
| `server/modules/git/git.module.ts` | Assemble the new Git service and completion dependency. |
| `server/index.ts` | Supply the Providers completion contract instead of direct Claude/Cursor runners. |
| `server/modules/git/tests/git-commit-message.service.test.ts` | Unit and real-temporary-repository staged-index coverage. |
| `server/modules/git/tests/git-commit-message.routes.test.ts` | Request/response/error/no-store/cancellation and commit-precondition contract tests. |
| `src/shared/providerSelectionCatalog.ts` and/or `src/shared/hooks/useProviderSelectionCatalog.ts` | Share lazy catalog and stored full-selection resolution without duplicating provider rules. |
| `src/shared/hooks/providerSelectionCatalog.test.ts` | Add selection reconciliation/lazy error cases when shared behavior changes. |
| `src/components/git-panel/hooks/useCommitMessageSuggestion.ts` | New state/request controller. |
| `src/components/git-panel/hooks/useSelectedProvider.ts` | Delete after replacing its sole consumer. |
| `src/components/git-panel/hooks/useGitPanelController.ts` | Remove dormant generation call; add snapshot-aware Commit request/result behavior. |
| `src/components/git-panel/types/types.ts` | Add typed generation state/API/error/analysis and snapshot-aware Commit types. |
| `src/components/git-panel/view/GitPanel.tsx` | Pass project id and Agent Settings recovery. |
| `src/components/git-panel/view/changes/ChangesView.tsx` | Pass stable staged paths/pending-stage state and react to Commit snapshot conflicts. |
| `src/components/git-panel/view/changes/CommitComposer.tsx` | Render the inline journey and preserve accessible/manual behavior. |
| `src/components/git-panel/view/changes/CommitComposer.stories.tsx` | Cover empty, ready, generating, protected-input suggestion, stale, failure, and mobile states. |
| `src/components/git-panel/phase8GitContract.test.tsx` | Assert Commit-only primary styling, neutral generator actions, explanations, and recovery labels. |
| `tests/e2e/phase8-git.spec.ts` | Exercise the full generator journey, races, stale snapshots, failures, keyboard flow, and 320 px behavior. |
| `tests/e2e/accessibility.spec.ts` | Extend only if the existing Source Control accessibility path does not cover the new live regions/focus flow. |

Do not add a dependency unless the live repository lacks a necessary primitive and the user approves the dependency change.

## Ordered implementation plan

### Phase 0: Preserve and record the baseline

1. Record `rtk git status --short` and focused diffs for every target file.
2. Confirm `AGENTS.md`, `RTK.md`, `UX_Design.md`, provider catalog contracts, Git staging queue behavior, and backend standards are unchanged from the assumptions above.
3. Confirm the legacy generator and `useSelectedProvider` consumers with codebase-memory first, then exact file reads.
4. Do not proceed by checking out clean copies; integrate with the live user changes.

Exit gate: the implementer can name the exact existing changes that overlap this feature and how they will be preserved.

### Phase 1: Lock the contracts with tests and types

1. Add typed success/error/request shapes and suggestion state definitions.
2. Add failing backend tests for staged-only mixed files, unborn HEAD, exact staged-set comparison, snapshot changes, no commit-time `git add`, selection validation, no fake fallback, and response headers.
3. Add failing provider-completion tests for all four normalized outputs, exact model/profile forwarding, isolated cwd/read-only options, abort, timeout, temp cleanup, and safe logging.
4. Add frontend pure state/contract tests for no-overwrite, late-response rejection, stale conversion, and one-primary-CTA rules.

Exit gate: tests fail for the legacy behavior for the intended reasons.

### Phase 2: Build the provider text-completion boundary

1. Implement the Providers-owned completion service through existing public provider services.
2. Use a transient runtime id for immediate abortability, `userId: null` on the writer to avoid run notifications, and the authenticated user id only for selection/profile validation.
3. Run in a cleaned-up temporary directory with verified read-only/plan settings and no project path.
4. Normalize assistant text across Claude/Codex/Cursor/OpenCode, rejecting error/empty terminal results.
5. Add timeout and signal handling that calls the provider runtime abort API exactly once.
6. Export the narrow API through the Providers barrel with the required consumer comment.

Exit gate: all focused Providers tests pass and a fake run cannot see or mutate the registered project.

### Phase 3: Make the Git index and commit path authoritative

1. Implement the Git commit-message service and full snapshot fingerprint.
2. Implement exact expected-file-set validation using repository-relative staged paths.
3. Implement the bounded metadata/excerpt allocator and recent-subject lookup.
4. Implement the prompt and output normalization policy.
5. Replace the legacy route internals with the thin service call and typed errors.
6. Remove working-tree fallback reads and all raw prompt/response logging.
7. Remove `git add` from Commit; add expected set/snapshot validation immediately before `git commit`.
8. Refresh status after a 409 without clearing the client draft.

Exit gate: real temporary-repository tests prove mixed staged/unstaged files generate and commit only the index content.

### Phase 4: Implement the frontend request/state controller

1. Add lazy full-selection resolution and same-provider reconciliation.
2. Implement the explicit suggestion state machine and API decoder.
3. Add request identity, project identity, staged-key, draft-revision, pending-stage, and abort guards.
4. Store provenance/snapshot metadata in the project draft cache.
5. Remove the provider-name-only Git hook and dormant controller method after consumer verification.
6. Extend Commit request/results with optional `expectedSnapshotId` and typed snapshot conflicts.

Exit gate: pure state tests prove manual text, project switches, stage changes, cancel, retry, and late responses cannot overwrite the wrong draft.

### Phase 5: Implement and polish the inline Composer journey

1. Add the neutral Generator action, disclosure, accessible status/error regions, and disabled explanations.
2. Add protected-input suggestion, Use/Dismiss, stale Update/Keep, partial-analysis disclosure, and Agent Settings recovery.
3. Keep Commit as the only primary action; inspect every state for MCTA-1 through MCTA-8.
4. Preserve keyboard Commit, textarea direction, focus-visible styles, focus return, and 44 px mobile targets.
5. Ensure progress/recovery remains visible when diffs expand and content is not clipped.
6. Add deterministic Storybook states.

Exit gate: static contract tests and Storybook cover every state in the state table.

### Phase 6: End-to-end verification and documentation

1. Update `UX_Design.md` registry/checklist before claiming the design task complete.
2. Extend Git mocks for the catalog, delayed generation, cancellation, typed failures, response snapshots, and Commit 409.
3. Add Playwright paths for the common journey, non-overwrite, stale snapshot, provider recovery, cancel/late response, keyboard usage, and 320 px.
4. Run focused tests, then the full gates below.
5. Review the final diff only against this document. Report unrelated baseline failures separately and do not hide them.

Exit gate: every acceptance criterion below has test evidence or an explicit manual verification record.

## Test matrix

### Backend Git service and route

- No staged files.
- Staged tracked modification.
- Staged new file on an unborn branch.
- Staged deletion and rename.
- Mixed staged and unstaged hunks in one path.
- Binary/non-UTF8 file and submodule change.
- Paths with spaces, Unicode, and rename arrows.
- Client file set missing/adding a server-staged path.
- Same filenames but changed staged content produce a different fingerprint.
- Full fingerprint is stable regardless of client path order.
- Fair per-file budgeting and explicit partial metadata.
- Recent history >=3, <3, no commits, merges excluded.
- Prompt-like instructions inside a diff remain delimited untrusted data.
- Empty, fenced, quoted, multiline, oversized, and invalid provider output.
- Commit with matching snapshot succeeds without `git add`.
- Commit with set/snapshot mismatch returns 409 and does not create a commit.
- Route rejects malformed provider/profile/model/files/project input.
- `Cache-Control: no-store` and no sensitive log payload.

### Provider completion service

- Claude, Codex, Cursor, and OpenCode normalized assistant output.
- Correct provider/profile/model passed through.
- Provider availability/auth/profile/model failures map to typed errors.
- Project path is absent; cwd is isolated and removed afterward.
- No bypass/auto-approval/write option is used.
- Transient id supports abort before provider-native session discovery.
- Client abort and 60-second timeout invoke runtime abort once.
- Error/complete without assistant text is not a success.
- No CloudCLI session row or project Chat history item is created.

### Frontend state and component

- Zero staged and pending-stage disabled explanations.
- Empty untouched draft receives the suggestion and focus.
- Existing draft is not overwritten.
- Typing during generation is not overwritten.
- Use and Dismiss suggestion behavior.
- Cancel restores the prior state and ignores late success.
- Project switch/unmount/superseding request ignores late success.
- In-app staged change marks generated draft stale.
- Commit 409 catches external same-path staged changes.
- Update suggestion versus Keep current message behavior.
- Partial-analysis note.
- Provider unavailable opens `agents` Settings and preserves input.
- Generation failure Retry preserves input.
- Successful Commit clears cached message and provenance.
- Commit is the only primary CTA in every normal/recovery state.
- Live-region announcements, focus order, visible focus, and 44 px targets.
- Desktop and 320 px mobile collapsed/expanded states.

## Verification commands

Run narrow checks first:

```bash
rtk npx tsx --tsconfig server/tsconfig.json --test \
  server/modules/providers/tests/provider-text-completion.service.test.ts \
  server/modules/git/tests/git-commit-message.service.test.ts \
  server/modules/git/tests/git-commit-message.routes.test.ts

rtk npx tsx --tsconfig tsconfig.json --test \
  src/shared/hooks/providerSelectionCatalog.test.ts \
  src/components/git-panel/phase8GitContract.test.tsx

rtk npx playwright test tests/e2e/phase8-git.spec.ts
```

Then run repository gates:

```bash
rtk npm run typecheck
rtk npm run build
rtk npm run lint
rtk npm run ux:audit
rtk npm run test:server
rtk npm run test:frontend
rtk npm run test:desktop
rtk npm run test:e2e
rtk npm run test:a11y
rtk npm run build-storybook
```

Do not claim completion from a subset alone. If a full gate fails because of the pre-existing dirty baseline, retain the exact command/output, prove the focused generator checks pass, and state the unresolved release impact.

## Acceptance checklist

### Behavior

- [ ] The Generator is inline and explicit; it never auto-runs.
- [ ] Only the actual staged index informs the message.
- [ ] Commit never restages working-tree content.
- [ ] Generated and committed snapshots are linked by a server fingerprint.
- [ ] Manual typing works with no provider configured.
- [ ] A non-empty or concurrently edited draft is never overwritten.
- [ ] All four catalog providers use the exact validated profile/model selection.
- [ ] No cross-provider fallback occurs silently.
- [ ] Repo style is used when sufficiently represented; Conventional Commit fallback works without history.
- [ ] Large/binary/many-file inputs produce bounded, explicit partial analysis.
- [ ] Cancel, timeout, Retry, Agent Settings, and staged-change recovery are truthful.
- [ ] No failure is rendered as a generic successful message.

### Safety and privacy

- [ ] Provider execution receives no registered project cwd and cannot mutate the project.
- [ ] No generation path uses bypass/auto-approval/skip-permission behavior.
- [ ] No automatic stage, unstage, edit, commit, push, publish, or remote action occurs.
- [ ] No visible CloudCLI Chat session or run notification is created.
- [ ] Raw diffs, paths, prompts, subjects, generated messages, and secrets are absent from logs.
- [ ] The inline disclosure names the selected provider and sent data categories.

### UX contract

- [ ] `Commit` is the sole visually primary CTA.
- [ ] Generator and all auxiliary/recovery controls are neutral.
- [ ] Every disabled primary/secondary action has a nearby enabling explanation.
- [ ] Errors preserve input and provide an outcome-labelled recovery.
- [ ] Progress/result/error remains in context and is not toast-only.
- [ ] Keyboard, focus, screen-reader status, reduced motion, contrast, and 44 px targets pass.
- [ ] Desktop and 320 px layouts do not clip or hide active work.
- [ ] `UX_Design.md` Source Control registry/checklist reflects the shipped behavior.

### Engineering

- [ ] Generator business logic is in typed services; routes are thin.
- [ ] Cross-module Provider access uses `server/modules/providers/index.ts` only.
- [ ] No new module-local backend `types.ts`, `interfaces.ts`, or `utils.ts` is introduced.
- [ ] Public exports are necessary, documented, and consumed.
- [ ] User-owned dirty-tree changes are preserved.
- [ ] Focused tests and applicable full release gates have recorded evidence.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Existing dirty-tree work is overwritten | Re-read live files, use focused patches, compare focused diffs before and after, never restore from `HEAD`. |
| Message describes unstaged content | Use only cached diff; remove Commit restaging; validate expected staged set and optional fingerprint. |
| External Git changes the same staged path | Recompute the full snapshot immediately before Commit and return a 409 conflict. |
| Provider output formats differ | Normalize in one Providers-owned service and test every registered provider with real event shapes. |
| Prompt injection inside code/diff | Delimit as untrusted data, provide no project cwd, use read-only/no-tool execution, validate output. |
| Very large commit biases the prompt | Include complete bounded metadata, allocate excerpts fairly, return explicit partial-analysis metadata. |
| Provider run survives browser cancellation | Use a transient runtime id, bind disconnect/timeout to runtime abort, ignore all late responses. |
| Generator pollutes Chat history/notifications | Do not create an app session, use an isolated cwd and writer without notification user id, verify history/session counts. |
| New UI creates competing CTAs | Commit stays primary; assert neutral styles and MCTA rules in tests. |

## Rollback and graceful degradation

- There is no database migration and no destructive data rewrite.
- Manual Commit remains the fallback when the provider catalog or generation endpoint fails.
- The frontend Generator wiring, Git suggestion service, and Provider completion boundary can be reverted independently if their contracts remain isolated.
- Do not restore the legacy fake-success generator as a fallback.
- If any catalog provider cannot satisfy the read-only contract, manual Commit remains available, but this four-provider feature is blocked from acceptance until the provider is made safe or the product scope is explicitly revised. Do not silently ship a partial provider matrix.

## Out of scope

- Automatic staging, commit, push, publish, PR creation, release, or changelog generation.
- Splitting changes into multiple commits.
- Generating branch names.
- A provider/model/profile picker inside Source Control.
- Per-run custom instructions, tone controls, language controls, or format controls.
- Persisting a history of generated suggestions.
- Editing provider-native third-party history files.
- A repository-wide rewrite of the large Git router or provider runtimes unrelated to the safe completion boundary.
- Cloud, Hosted, Pro, remote Shell, or feature-flag work.

## Handoff completion report format

The implementer must return:

1. Summary of behavior shipped.
2. Files changed, grouped by UX, frontend, Git backend, Providers backend, and tests.
3. Evidence for every acceptance group.
4. Exact verification commands and outcomes.
5. Any baseline failures separated from newly introduced failures.
6. Remaining risks or deviations from this plan.
7. Confirmation that no branch, commit, rebase, or push was performed unless separately requested.
