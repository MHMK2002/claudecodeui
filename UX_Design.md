# Desktop UX Design Contract

This document is the design source of truth for CloudCLI Desktop. Every design or UX change must satisfy the page checklist in this document in addition to its feature-specific tests.

## Product goal

A user installs the app on a laptop and reaches a local workspace without creating or signing in to a CloudCLI product account. Project, Chat, Shell, Git, Tasks, and Schedules must be simple to start, easy to recover, and usable with a keyboard.

Provider authentication for Claude, Codex, Cursor, or other agents is separate from product authentication and remains available only when an AI action needs it.

## Product boundaries

- Desktop local use is passwordless and loopback-only.
- LAN and remote access require explicit authentication and a real server restart.
- Cloud, Hosted, and Pro are feature-flagged and disabled by default.
- There is no replacement community promotion. `Join Community` and Discord product links are absent.
- `Report Issue` is absent while the central issue tracker URL is `null`.
- Desktop Shell is a local project terminal, independent of provider authentication.
- Schedules run only while Desktop or its local server is active. Missed runs are recorded and are never replayed automatically.
- The visual language is evolved, not replaced. Desktop is the primary target; 320 px remains a required smoke-test width.

## Interaction contract

### One primary job

Every page has one primary job and at most one visually primary CTA for its current state. A state transition may change that CTA, but must not leave the old primary CTA visible.

Secondary actions use neutral styling. Destructive actions are explicit, confirmed when data can be lost, and never compete visually with the primary job.

### State completeness

Every data-backed surface distinguishes:

- initial loading;
- delayed loading, with skeleton or progress;
- empty success;
- permission or authentication failure;
- validation failure;
- network/server failure;
- partial success when applicable;
- recovery in context.

Errors preserve the user's input and focus the first actionable problem. Recovery labels describe an outcome (`Retry`, `Choose another folder`, `Open Settings`) rather than an implementation detail.

### Progressive disclosure

Basic paths show only the inputs needed for the common case. Credentials, raw paths, cron, provider URLs, model overrides, and diagnostics remain hidden until their relevant failure or an explicit Advanced action.

### Feedback

Long-running work exposes truthful stages, cancellation when safe, and a terminal Success or Recovery state. Save, Upload, Clone, Task start, Schedule save, Voice autosave, and server startup never rely on a transient toast alone.

### Accessibility

- Useful text has at least 4.5:1 contrast and is not dimmed with opacity.
- Every interactive control has a visible `focus-visible` state.
- Icon-only controls have an accessible name.
- Status never relies on color alone.
- Dialogs and menus support Escape, initial focus, focus containment where modal, and focus return.
- Complete primary jobs are keyboard-operable.
- Touch/mobile targets are at least 44 by 44 CSS pixels.
- Motion respects `prefers-reduced-motion`.

## Multiple competing task/action mistakes

The MCTA rules are release-blocking UX defects for changed surfaces.

- `MCTA-1` — More than one action is styled as the primary CTA in the same state.
- `MCTA-2` — A secondary, navigation, or destructive action visually competes with the primary job.
- `MCTA-3` — An error state explains the failure but provides no contextual recovery action.
- `MCTA-4` — A CTA label describes a mechanism instead of the user's intended outcome.
- `MCTA-5` — A disabled primary CTA has no nearby explanation of what enables it.
- `MCTA-6` — A routine workspace task is forced into a modal that hides the context needed to complete it.
- `MCTA-7` — Setup, authentication, or configuration is requested before the user reaches the action that requires it.
- `MCTA-8` — یک اکشن یکسان در یک صفحه در چند محل برجسته تکرار می‌شود. The same action is repeated in multiple prominent locations on one page.

## Page jobs and CTA registry

| Surface / state | Primary job | Primary CTA | Secondary actions |
| --- | --- | --- | --- |
| Desktop launcher | Enter the local workspace | `Open Local Workspace` | `Open in browser`, local settings |
| Launcher startup | Understand startup and wait or recover | Current stage; on failure `Retry` | `Copy diagnostics` |
| Compatibility failure | Repair the bundled local runtime | `Restart and repair` | `Copy diagnostics` |
| Create Project / choose mode | Choose the source of a project | `Continue` after selecting `Open existing folder` or `Clone repository` | Cancel |
| Create Project / local | Register an existing folder | `Review` then `Open project` | Browse, Back |
| Create Project / clone | Clone into a chosen destination | `Review` then `Clone repository` | Change credential when needed, Cancel |
| Files / browse | Find and open a file | File selection/opening | Search, Upload, Save |
| Chat / idle | Send the next instruction | `Send` | Attach, voice, provider/model menus, header Export |
| Chat / running | Control active inference | `Stop` | Queue/edit draft where supported |
| Chat / catalog failure | Restore provider selection | `Retry` | `Open Agent Settings` |
| Shell | Work in the registered project's local terminal | Terminal input | Restart, reconnect, copy/paste |
| Git / Changes | Record selected changes | `Commit` | `Generate message`, Cancel, Use/Dismiss/Update suggestion, Keep current message, Fetch, Pull, Push, Publish |
| Git / no repository | Create the repository | `Initialize repository` | Open Git settings when Git is missing |
| Git / conflict | Resolve the active operation | `Resolve conflicts`, then `Continue merge` or `Continue rebase` | Abort with confirmation |
| Project drawer | Inspect or configure the current project without losing context | Active tab's job | One Collapse/Close control |
| Tasks / not initialized | Set up task management | `Set up Tasks` | Import/Create PRD |
| Tasks / empty | Create the first task | `Create task` | Import/Create PRD |
| Tasks / ready | Start the selected next task | `Start task` | Search, filter, sort |
| Tasks / filtered empty | Recover visible tasks | `Clear filters` | Change sort |
| Schedules | Create or edit a project schedule | `Save schedule` | `Run now`, Delete |
| Settings | Change one setting group | State-specific Save only when autosave is not used | Section navigation |
| Voice / Basic | Enable and validate voice input | `Test voice input` | Advanced |
| Report Issue preview | Review redacted issue data | `Open issue tracker` | `Copy diagnostics` |

## Independent completion checklists

### Desktop launcher and onboarding

- [x] Default build exposes no Cloud navigation, account, logout, hosted environment, or Cloud refresh surface.
- [x] Title bar does not imply a CloudCLI product account is required.
- [x] The only primary launcher CTA is `Open Local Workspace`.
- [x] Startup announces `Starting local server`, `Checking compatibility`, then `Opening workspace`.
- [x] Failure offers `Retry` and neutral `Copy diagnostics` without losing startup logs.
- [x] A fresh install reaches the workspace in no more than three interactions.
- [x] Navigation with more than seven destinations is grouped.

### Compatibility repair

- [x] Frontend, Electron, live server, and bundled archive share a non-empty immutable `version + buildId`.
- [x] Electron checks server identity before opening a workspace.
- [x] A mismatched old process is stopped and the bundled matching server is started automatically.
- [x] Failed repair exposes one primary `Restart and repair` and secondary `Copy diagnostics`.
- [x] Cache, archive metadata, and checksums are keyed and validated by build identity.

### Local access boundary

- [x] Runtime mode is one of `desktop-local`, `desktop-lan`, `standalone-web`, or `platform`.
- [x] `desktop-local` binds only to loopback and creates an invisible internal principal on fresh install.
- [x] Electron exchanges a random secret through a one-time bootstrap endpoint; no token appears in URLs, WebSocket queries, UI, logs, or diagnostics.
- [x] Existing users and data survive migration.
- [x] Token expiry and restart recover without showing Login.
- [x] REST, WebSocket, Voice, Shell, Schedules, and `ProtectedRoute` apply the same mode-aware boundary.
- [x] LAN requires explicit auth and restart; Shell is disabled for LAN/remote by default.
- [x] Provider Login remains available at the point of AI use or in Settings.

### Create Project

- [x] The first decision is `Open existing folder` versus `Clone repository`.
- [x] Local mode contains only a folder picker; clone contains only `Repository URL` and destination initially.
- [x] Credentials appear only after a private/auth failure.
- [x] Review states the exact operation and canonical destination.
- [x] Invalid/unwritable path, non-empty destination, duplicate project, missing Git, invalid URL, auth required, missing repository, offline network, clone conflict, and cancellation are structurally distinct.
- [x] Every structured error includes a matching recovery action.
- [x] Clone has an attempt ID, progress, and cancellation; cleanup removes only artifacts created by that attempt.
- [x] Failed input is preserved and focus moves to its problem.

### Files

- [x] Loading, empty success, permission failure, and server failure are distinct.
- [x] A fetch failure is never rendered as an empty folder.
- [x] Search and browse remain available.
- [x] Save and Upload expose persistent progress/result feedback.
- [x] Delete uses trash and Undo when supported, otherwise confirmation.
- [x] All controls have keyboard behavior and accessible names.

### Provider catalog and Chat

- [x] `/api/providers/selection-catalog` always returns the typed JSON contract.
- [x] Frontend validates status and content type before parsing; HTML never becomes `Unexpected token '<'`.
- [x] Catalog recovery is `Retry` plus secondary `Open Agent Settings`; the draft is preserved.
- [x] Exactly one Export control exists, in the header, backed by the session store.
- [x] One menu provides Markdown, HTML, PDF, and ZIP.
- [x] Export and other failures render inline feedback, never `window.alert`.
- [x] Session title truncates with tooltip and reserves action width.
- [x] Delayed session loading shows a skeleton.
- [x] Streaming/activity text drives inference status.
- [x] `Send` is replaced by `Stop` while inference runs.

### Shell

- [x] The primary Shell uses `interactive-terminal` and sends a registered project ID, never a provider or provider session ID.
- [x] Server resolves cwd from the project's canonical stored path and rejects client-supplied arbitrary paths.
- [x] The OS login shell is spawned directly without `bash -c` on macOS, Windows, and Linux.
- [x] WebSocket auth is not carried in the query string.
- [x] Input, resize, copy/paste, restart, reconnect, and terminal state feedback work.
- [x] Provider login and auth-URL detection are absent from local Shell.
- [x] Missing project, unavailable cwd, unavailable shell, and socket failure each have contextual recovery.
- [x] Remote Shell remains disabled and out of scope.

### Source Control

- [x] `Commit` is the only primary Changes CTA; transport actions are neutral.
- [x] Current branch and ahead/behind appear above the fold.
- [x] Branch selector and search are keyboard-operable.
- [x] No-repo has only primary `Initialize repository`.
- [x] Missing Git, missing remote, auth/network failure, detached HEAD, dirty switch, conflict, and permission failure have distinct recovery.
- [x] Conflict flow is `Resolve conflicts` followed by the applicable Continue action.
- [x] Discard, delete, and revert require confirmation; temporary patch Undo is used when feasible.
- [x] Text/icon status accompanies color.
- [x] Commit-message generation is explicit and inline; every generator, cancellation, comparison, and recovery action is neutral while `Commit` remains the only primary CTA.
- [x] Suggestions analyze only a bounded server-derived staged-index snapshot, disclose the selected provider and sent data categories, and remain linked to that snapshot until committed or explicitly converted to manual text.
- [x] Existing or concurrently edited draft text is never overwritten; provider/catalog failures preserve it and recover through `Retry`, `Review staged changes`, or `Open Agent Settings` in context.
- [x] Generation is cancellable, ignores late responses, exposes partial analysis, and never stages, edits, commits, pushes, publishes, or creates a visible Chat session.

### Project drawer

- [x] Quick Settings and Right Sidebar share one canonical implementation.
- [x] Desktop drawer is docked, non-modal, has no backdrop/blur/focus trap, and resizes the workspace.
- [x] Exactly one Collapse/Close control is present.
- [x] Width, open state, and active tab persist; drag is optional enhancement only.
- [x] Task/Schedule creation opens in the main workspace and Provider Connect opens Settings.

### Task Manager

- [x] There is one canonical initializer; no modal shells out to `npx task-master init`.
- [x] Touched initializer code is TypeScript and routes remain thin.
- [x] Setup proceeds through Analyze, Preview changes, Confirm, streamed progress, and Success/Recovery.
- [x] Writes are backed up, project-locked, idempotent, and recover through rollback or Repair after failure/cancel.
- [x] Default model never changes without preview.
- [x] Board exposes exactly one primary CTA for uninitialized, empty, and ready states.
- [x] PRD actions are secondary; filter/sort/search are grouped; filtered empty offers `Clear filters`.
- [x] Start task shows staged progress, Cancel, and Retry.

### Schedules

- [x] Editor is a main-workspace surface, not a modal stacked over the drawer.
- [x] Current project is selected by default; Basic has no raw project path.
- [x] Daily, Weekly, and Custom time are primary; raw cron is Advanced only.
- [x] Timezone is detected and the next three runs are previewed.
- [x] Provider/profile/model come from the shared catalog; unavailable provider offers `Open Settings`.
- [x] `Run now` remains secondary; Delete has confirmation and Undo.
- [x] Before Save, UI states that execution requires Desktop/local server to remain active.
- [x] Missed runs are marked `Missed` and never replayed automatically.
- [x] DST, restart, moved/deleted project, provider logout, and duplicate execution are tested.

### Settings and Voice

- [x] Settings groups are General (Appearance, Notifications, Voice), AI & integrations (Agents, API Tokens, Browser, Plugins), Project tools (Git, Tasks), and System (About), with at most four items each.
- [x] Voice Basic contains Enable, microphone, permission, hold-to-talk, read-aloud, language, and `Test voice input`.
- [x] Test flow visibly moves Listening → Transcribing → Sample result.
- [x] Advanced contains provider, URL, API key, STT/TTS, context, and cleanup, showing only fields relevant to the active provider.
- [x] Catalog data loads only when Advanced opens.
- [x] Autosave exposes Saving, Saved, and Failed—Retry.
- [x] Missing microphone and denied permission have recovery.
- [x] Secrets are masked and stored in secure storage; legacy localStorage secrets are removed only after successful read-back.
- [x] Profile/model failures are visible.

### Report Issue

- [x] The surface is absent when `issueTrackerUrl` is `null`.
- [x] A valid GitHub or GitLab tracker opens a preview before leaving the app.
- [x] Version and OS are prefilled only after consent; diagnostics are separately opt-in.
- [x] Local paths, email, project names, local URLs, tokens, and secrets are redacted.
- [x] `Open issue tracker` is the only primary CTA; `Copy diagnostics` is neutral.

## Shared configuration contract

The repository has one `shared/` product manifest with:

- `productName`;
- `homepageUrl`;
- `repositoryUrl`;
- `issueTrackerUrl`, nullable and `null` by default;
- `documentationUrl`;
- `updateFeedUrl`;
- `features.cloud`, `features.hosted`, and `features.pro`, all `false` by default.

Frontend, Electron, server, package metadata validation, and release scripts consume this source. Builds reject invalid or insecure public URLs. Default-build tests prove there is no Cloud request path or Cloud UI.

## Build and release gate

- [x] Narrow module tests pass.
- [x] `npm run build` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes without new baseline violations.
- [x] `npm run test:server`, `test:frontend`, `test:desktop`, `test:e2e`, and `test:a11y` pass.
- [x] Launcher, Project, Chat, Shell, Git, Tasks, Schedules, and Voice Playwright paths pass.
- [x] axe, contrast, keyboard smoke, and 320 px smoke pass.
- [x] Desktop packaging smoke rejects empty identity, bad checksum, and incompatible archive.
- [x] New/shared UI components include Storybook stories.
- [x] Every changed surface passes its independent checklist above and has no MCTA violation.

## Dependency order

```text
UX contract/config
        ↓
build identity
        ↓
local auth boundary
        ↓
launcher + onboarding
        ↓
project creation
        ├── files
        ├── source control
        └── local shell
        ↓
provider catalog + chat
        ↓
canonical project drawer
        ├── task manager
        └── schedules
        ↓
settings + voice
        ↓
accessibility + full verification
```

## Non-goals

- Building Cloud, Hosted, or Pro.
- Replacing Community.
- Remote Shell.
- Background scheduler or operating-system autostart.
- A complete mobile redesign.
- Changing the nature of provider authentication.
- A complete visual redesign.
- Commit, branch, push, release, or publish without a separate explicit request.

## Rollback invariants

- Existing web/LAN authentication remains until local bootstrap is verified.
- Task initialization creates a backup before writes.
- Clone cleanup is scoped to the originating attempt.
- Each phase has an independent acceptance gate and can be reverted without discarding unrelated user changes.
