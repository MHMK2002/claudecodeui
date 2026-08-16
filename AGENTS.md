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
