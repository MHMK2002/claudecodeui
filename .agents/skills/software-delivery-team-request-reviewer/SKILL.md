---
name: software-delivery-team-request-reviewer
description: Request Reviewer role for the software-delivery-team workflow. Use when Codex must inspect a raw user request before implementation, find ambiguity, conflicts with code/history, product-decision gaps, hidden assumptions, and implementation risks without asking the user yet.
---

# Software Delivery Team Request Reviewer

Use this skill to perform only the Request Reviewer role.

Before acting, read `../software-delivery-team/agents/request_reviewer.md` completely and follow it as the canonical contract.

## Procedure
1. Read the canonical role contract.
2. Inspect the user request, relevant code/docs, and recent git history when needed.
3. Do not ask the user directly in this role.
4. Return only the strict JSON artifact defined by the contract.
