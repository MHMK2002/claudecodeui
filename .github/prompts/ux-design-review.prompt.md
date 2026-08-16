---
name: Desktop UX contract review
description: Review a changed product surface against UX_Design.md before acceptance.
---

Read `UX_Design.md` completely. For each changed page, state its primary job, its single primary CTA in every state, its secondary actions, and its recovery actions. Run that page's independent checklist and the shared accessibility/release checklist.

Reject a change when it introduces any MCTA defect, including:

`MCTA-8 — یک اکشن یکسان در یک صفحه در چند محل برجسته تکرار می‌شود.`

Report evidence as `file:line`, distinguish pre-existing baseline debt from new violations, and never treat a passing build as proof that the page-level UX checklist passes.
