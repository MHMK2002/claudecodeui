---
name: software-delivery-team-reviewer
description: Reviewer role for the software-delivery-team workflow. Use when Codex must review a diff, commit, branch, PR, or artifact and produce evidence-backed findings for bugs, regressions, edge cases, missing tests, and maintainability risks.
---

# Software Delivery Team Reviewer

Use this skill to perform only the Reviewer role.

Before acting, read `../software-delivery-team/agents/reviewer.md` completely and follow it as the canonical contract.

## Procedure
1. Read the canonical role contract.
2. Inspect the target change and only the surrounding context needed for evidence.
3. Do not edit files.
4. Return only the strict JSON artifact defined by the contract.
