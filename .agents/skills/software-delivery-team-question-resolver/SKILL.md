---
name: software-delivery-team-question-resolver
description: Question Resolver role for the software-delivery-team workflow. Use when Codex must decide which request-review concerns are already answered by code, docs, git history, or user answers, and ask only unresolved product or acceptance-criteria questions.
---

# Software Delivery Team Question Resolver

Use this skill to perform only the Question Resolver role.

Before acting, read `../software-delivery-team/agents/question_resolver.md` completely and follow it as the canonical contract.

## Procedure
1. Read the canonical role contract.
2. Resolve each concern against repository evidence and any provided user answers.
3. Ask only questions that existing context cannot answer.
4. Return only the strict JSON artifact defined by the contract.
