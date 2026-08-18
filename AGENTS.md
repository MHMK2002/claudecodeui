# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

## Initial Documents

- At the start of work in this repository, read this file first.

@RTK.md
@UX_Design.md

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Learned notes

- Enforce the repository UX design contract and its completion checklist on every design task.
- Remove Join Community from the product UI.
- Keep local Desktop passwordless; require authentication only for explicit LAN or remote access.
- Centralize product branding, repository, issue tracker, documentation, and update-feed links.
- Keep Hosted and Pro features behind feature flags that are disabled by default.
- Keep Report Issue hidden until the central issue tracker URL is configured.
- Make Desktop Shell a local project terminal independent of provider authentication.
- Keep Voice Settings and simplify them with progressive disclosure.
- Hide Cloud launcher surfaces when the Cloud feature flag is disabled.
- Keep UX_Design.md at the repository root as the design source of truth.
- Run schedules only while Desktop or its local server is active; mark missed runs without automatic replay.
- Ship internally built macOS, Linux, and Windows desktop releases with in-app automatic updates.
- Use the user's GitHub repository as the canonical source and release host.
- Minimize provider token usage for commit-message generation.
- Open the local Desktop workspace automatically; do not require an `Open Local Workspace` click.
- Keep first-run Provider credentials and Soniox setup optional and non-blocking.
- Present optional first-run Provider and Soniox setup as a step-by-step modal flow.
- Let first-run Provider connection use either interactive sign-in or a provider token.
- Limit first-run Provider tokens to Claude and Codex; let users set an optional Base URL and custom agent title, then store them as encrypted profiles.
- Scope Claude CLI runtime authorization to authenticated execution principals; do not add global project/session ownership migration as part of that feature.
- Restrict phase-one Claude CLI runtime to encrypted api_key profiles; keep auth_token, OAuth, and profile-less sessions on SDK.
- Stage session side effects and commit them only after the corresponding runtime turn reaches input_accepted.
- Use one typed input-acceptance boundary for SDK and CLI turns, and commit turn side effects idempotently with turn/generation compare-and-set.
- Treat SDK turns as acceptance_unknown after iteration starts without explicit accepted evidence; never automatically resend uncertain turns.
- Keep durable provider-session mappings independent from process-generation claims; store generation only on claims and turn receipts.
- Allow normal multi-turn after accepted receipts; block sends only while acceptance_unknown remains unresolved.
- Resolve acceptance_unknown only through explicit authenticated and audited recovery actions; never retry an unknown turn.
- Backfill Claude CLI mappings only from top-level runtime_kind=cli sessions and roll back on provider-session collisions.
- Bind turn recovery to the originating execution principal and persist recovery resolutions exactly once.
- Treat accepted turns without a confirmed terminal boundary as completion_unknown requiring explicit recovery.
- Persist recovery successor links in a separate table and centrally guard superseded sessions as read-only.
- Start Claude CLI implementation only after the CLI contract and sterile api_key probes pass, and keep its feature flag off through all rollout gates.
- Check recovery successor links in both directions before deleting either linked session.
- Keep recovery routes thin; centralize recovery authorization, transactions, audit, and idempotency in chat-turn-recovery.service.ts.
- Make final implementation plans include every confirmed decision, invariant, gate, test, and rollback policy from review.
- Treat all legacy, imported, and ambiguous sessions as SDK; allow CLI runtime only for newly created sessions with explicit CLI selection.
- Require a versioned Phase 0 CLI contract before schema or adapter work, and deliver the feature through independently gated M0-M7 milestones.
- Decide runtime_kind server-side from Chat intent, flag, eligibility, and preflight; never accept it from the client.
- Bind a new CLI Session to its authenticated execution principal transactionally before creating runtime claims.
- Treat a successful SDK query invocation without explicit provider input-accepted evidence as acceptance_unknown.
- Stage TaskMaster proposal writes until input acceptance, then commit them with turn/generation CAS.
- Route CLI-ineligible Chat sessions to SDK, but fail eligible CLI sessions on preflight failure without INSERT or SDK fallback.
- Run CLI preflight outside SQLite, then CAS its immutable snapshot in a short transaction before Session and principal-binding INSERTs.
- Do not continue external, legacy, imported, or ambiguous sessions through local CLI in phase one.
- When missing-credential recovery continues without replay, discard all staged side effects and persist only the audited resolution.
- Allow at most one active CLI coordinator per database through a DB-backed lease; mismatched instances fail CLI closed while SDK/read-only remain available.
- Accept Chat projectId only; resolve canonical project paths server-side and keep CLI Desktop-local until explicit project-access grants exist.
- Store Chat attachments in a principal-bound asset registry and accept immutable assetId references instead of client paths.
- Enforce CLI execution bindings on all read/list/history/export/search/token-usage/provider-id paths and broadcasts, returning indistinguishable 404s cross-principal.
- Fence CLI coordinator takeover with a DB coordinatorEpoch, owner-death/PID proof, active-claim resolution, and epoch checks in claims, generations, descriptors, and socket handshakes.
- Bind every Chat WebSocket to a principal-aware connection context; authorize attach, replay, permission, metadata, and broadcasts through that context.
- Stage principal-owned assets with O_NOFOLLOW, exclusive immutable copies, fsync/hash verification, and fail-closed ASSET_MUTATED handling.
- Return a generic terminal session_unavailable WebSocket event for missing or unauthorized targets without exposing session metadata.
- Execute the ConversationShell runtime as one sequential change set and never mark it complete before the S1 end-to-end fixture passes.
