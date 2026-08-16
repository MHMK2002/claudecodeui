# Desktop UX baseline

Captured before implementation on 2026-08-15 at `6043e6b` (`main`, one commit ahead of `origin/main`).

## Preserved working-tree inventory

The only pre-existing working-tree change was `AGENTS.md`, with six user-owned learned notes:

- Keep Report Issue hidden until the central issue tracker URL is configured.
- Make Desktop Shell a local project terminal independent of provider authentication.
- Keep Voice Settings and simplify it with progressive disclosure.
- Hide Cloud launcher surfaces when the Cloud feature flag is disabled.
- Keep `UX_Design.md` at the repository root as the design source of truth.
- Run schedules only while Desktop or its local server is active; mark missed runs without automatic replay.

These lines are not implementation output and must be preserved.

## Static UX debt

`ux-baseline.json` is the machine-readable baseline. `npm run ux:audit` fingerprints the normalized violation and fails for any new or replacement fingerprint, including in an existing file; line-number-only movement does not fail and reductions are accepted.

| Rule | Initial count |
| --- | ---: |
| Non-semantic click target | 28 |
| Suppressed focus without replacement | 1 |
| Icon button without detected name | 0 |
| Image without alt | 3 |
| Detected undersized icon target | 0 |
| Browser alert/confirm feedback | 23 |
| Raw color value outside canonical token sources | 139 |
| Raw full-screen modal surface | 41 |
| Palette-specific Tailwind color | 2,798 |
| Useful text opacity | 105 |
| **Total** | **3,138** |

The zero counts are conservative static detections, not proof that the repository has no runtime accessibility defect. Phase 12 adds axe, contrast, keyboard, and viewport checks.
