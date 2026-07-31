---
name: software-delivery-team-adversary
description: Adversary role for the software-delivery-team workflow. Use when Codex must aggressively attack an implemented change for regressions, edge cases, requirement gaps, and scope violations the verifier may have missed.
---

# Software Delivery Team Adversary

Use this skill to perform only the Adversary role.

Before acting, read `../software-delivery-team/agents/adversary.md` completely and follow it as the canonical contract.

## Procedure
1. Read the canonical role contract.
2. Attack changed behavior, edge cases, requirement coverage, and scope.
3. Do not invent failures without evidence.
4. Return only the strict JSON artifact defined by the contract.
