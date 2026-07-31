---
name: software-delivery-team
description: Codex-first structured adversarial multi-agent workflow for diff review and request intake. Use for rigorous review of a diff/commit/branch/PR, or when a raw user request must be checked for ambiguity, conflicts with code/history, product decisions, clarified through focused questions, converted into requirements, planned, implemented, verified, and finally accepted/revised/rejected with evidence. Not for tiny cosmetic edits unless risky.
---

# Software Delivery Team / Request Intake

## Purpose
This skill orchestrates a structured, adversarial, multi-agent workflow that:
1. reviews an existing change, or reviews a raw request before code is changed,
2. challenges ambiguous, conflicting, risky, or under-specified claims,
3. resolves what code, docs, or git history already answer,
4. asks the user only for decisions that cannot be resolved from existing context,
5. converts the clarified request or confirmed findings into a requirements/plan artifact,
6. critiques and arbitrates the plan,
7. executes only the approved plan,
8. verifies the implementation adversarially,
9. and performs a final release decision.

The goal is not just to detect issues, but to force evidence-based convergence before implementation and again before approval.

---

## When to use
Use this skill when:
- a diff, commit, branch, or PR needs rigorous review,
- a user says "I want X" and X needs clarification before implementation,
- a request may conflict with existing product decisions, code behavior, or git history,
- product decisions or acceptance criteria must be separated from implementation details,
- you want disagreement to be resolved explicitly,
- implementation must happen only after a plan is accepted,
- post-implementation verification is required,
- correctness matters more than speed.

Do not use this skill for tiny cosmetic edits unless the change is risky.

---

## Core principle
All agents must operate on **structured artifacts**, not free-form debate.

The workflow progresses through these artifacts:

- `request_review.json`
- `question_resolution.json`
- `clarifying_questions.json`
- `requirements.json`
- `requirements.md`
- `findings.json`
- `responses.json`
- `arbitration.json`
- `plan.json`
- `plan_review.json`
- `plan_arbitration.json`
- `implementation_report.json`
- `verification_report.json`
- `adversary_report.json`
- `verify_arbitration.json`
- `final_decision.json`

Each stage may loop until:
- convergence is reached,
- a maximum number of rounds is hit,
- or a blocker requires human intervention.

---

## Agent roles

### 1. Request Reviewer
Reviews a raw user request before implementation. Finds ambiguity, contradictions with prior decisions, product-decision gaps, hidden assumptions, and likely implementation problems.

### 2. Question Resolver
Checks each request concern against repository code, docs, and git history. Asks the user only for unresolved product decisions or facts that cannot be safely inferred.

### 3. Requirements Writer
Converts a clarified request into implementation-ready requirements with acceptance criteria, explicit scope, assumptions, and handoff notes.

### 4. Reviewer
Finds grounded issues in the target change.

### 5. Responder
Replies to each finding with evidence-based agreement or disagreement.

### 6. Arbiter
Determines whether claims are real or nonsense, and whether the loop should continue.

### 7. Planner
Turns accepted findings or clarified requirements into a concrete implementation plan.

### 8. Plan Critic
Challenges the plan for correctness, scope, and safety.

### 9. Implementer
Implements only the accepted plan. If implementation reveals a real ambiguity, it emits clarification questions/blockers instead of guessing.

### 10. Verifier
Checks the implementation against the plan and looks for regressions.

### 11. Adversary
Adversarially attacks the implemented change to find bugs, regressions, edge cases, and scope violations the verifier may have missed.

### 12. Final Arbiter
Makes the final accept/revise/reject decision.

The Arbiter is reused as the judgment gate in three loops: review (reviewer vs responder), plan (planner vs plan critic), and verification (verifier vs adversary).

Agent prompt contracts live in `agents/*.md`. Each defines its own input, rules, and strict JSON output schema.

Each role also has a repo-level skill wrapper under `.agents/skills/software-delivery-team-*` so Codex can invoke roles independently when needed:

- `$software-delivery-team-request-reviewer`
- `$software-delivery-team-question-resolver`
- `$software-delivery-team-requirements-writer`
- `$software-delivery-team-reviewer`
- `$software-delivery-team-responder`
- `$software-delivery-team-arbiter`
- `$software-delivery-team-planner`
- `$software-delivery-team-plan-critic`
- `$software-delivery-team-implementer`
- `$software-delivery-team-verifier`
- `$software-delivery-team-adversary`
- `$software-delivery-team-final-arbiter`

---

## Workflow overview

### Mode 1: Existing-change review

#### Phase A: Review loop
1. Reviewer inspects the change.
2. Responder answers each finding.
3. Arbiter confirms, rejects, or requests more evidence.
4. If convergence is insufficient, repeat.

**Stop condition**
- no unresolved high-severity issues,
- convergence above threshold,
- and no materially new findings in the last round.

---

### Mode 2: Request intake
1. Request Reviewer inspects the raw request, relevant code, docs, and recent git history.
2. Question Resolver checks which concerns are already answered by code/history.
3. If unresolved product decisions or acceptance criteria remain, it writes `clarifying_questions.json` and stops.
4. After answers are provided through `--answers-file`, Requirements Writer emits `requirements.json` and `requirements.md`.
5. Planner turns the requirements into an implementation plan.

**Stop condition**
- no required unresolved questions,
- no contradiction with accepted repository behavior,
- requirements have clear acceptance criteria,
- scope and non-goals are explicit.

---

### Shared Phase B: Planning loop
1. Planner converts confirmed issues into a change plan.
2. Plan Critic attacks the plan.
3. Arbiter decides whether the plan is acceptable.
4. If needed, revise the plan and repeat.

**Stop condition**
- plan is complete,
- scope is minimal,
- risks are explicit,
- validation is defined.

---

### Shared Phase C: Implementation
1. Implementer applies the approved steps.
2. If a blocker appears, it reports the blocker instead of improvising.
3. If a clarification is needed, it emits implementation questions and stops.
4. Scope must not expand silently.

---

### Shared Phase D: Verification loop
1. Verifier checks implementation against the approved plan.
2. Adversary attacks the final diff to surface regressions and edge cases the verifier missed.
3. Arbiter judges verifier vs adversary and decides whether the implementation is actually correct.

**Stop condition**
- implementation matches plan,
- regressions are absent,
- tests/validation pass or are explained,
- no critical issue remains.

---

### Shared Phase E: Final decision
1. Final Arbiter reviews the full history.
2. It returns one of:
   - `accept`
   - `revise`
   - `reject`

---

## Convergence policy
Use convergence as a **signal of agreement**, not proof of correctness.

Suggested thresholds:
- review convergence: `85`
- plan convergence: `80`
- verification convergence: `90`

If a round converges too quickly with no real challenge, treat the result cautiously.

---

## Required output discipline
Every agent must:
- use its own schema,
- cite evidence,
- avoid vague language,
- avoid free-form essays unless explicitly asked,
- keep ids stable across rounds.

---

## Safety rules
- No agent may broaden scope without explicit justification.
- No implementer may change unrelated code.
- No implementer may guess when the answer changes product behavior, UX, data contracts, or public API behavior.
- No request may become an implementation plan while required questions remain unresolved.
- No final approval if critical/high issues remain unresolved.
- No claim is accepted without evidence.

---

## Recommended orchestration
A practical default:

### Simple changes
- 1 review round
- 1 plan round
- implement
- 1 verification round

### Medium complexity
- 2–3 review rounds
- 2 plan rounds
- implement
- 1–2 verification rounds

### High risk / production critical
- full review loop
- full plan loop
- gated implementation
- full verification loop
- final arbiter decision

---

## Running the orchestrator

`workflow/orchestrator.mjs` drives the whole workflow by invoking each agent prompt contract one artifact at a time. It is Codex-first and uses `codex exec` by default. Use `--engine claude` only when the old Claude CLI backend is intentionally needed.

```bash
# clarify a raw request and stop after requirements
node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \
  --mode request --request "Add restore for archived tabs" --until requirements

# continue a clarified request through implementation and verification
node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \
  --mode request --request-file request.md --answers-file answers.md --until verify

# review the working-tree diff at medium complexity, including implementation if plan is accepted
node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \
  --target working --level medium --until verify

# review the last commit, run the full loop including implementation and final decision
node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \
  --target HEAD~1..HEAD --level high --until final

# see the exact agent calls without spending tokens
node .agents/skills/software-delivery-team/workflow/orchestrator.mjs --dry-run
```

Key flags:

- `--mode` - `review` for an existing diff/commit/branch/PR, or `request` for raw user-request intake. Defaults to `request` when `--request` or `--request-file` is present; otherwise `review`.
- `--target` - `working` (default, uncommitted diff), `staged`, a git range like
  `HEAD~1..HEAD`, or `--target-file <path>` to review an arbitrary artifact.
- `--request` / `--request-file` - raw request text for request-intake mode.
- `--answers-file` - user answers to `clarifying_questions.json`, used to continue request intake.
- `--level` - `simple | medium | high` (default `medium`); controls max rounds per loop.
- `--until` - for review mode: `review | plan | implement | verify | final` (default `verify`); for request mode: `intake | requirements | plan | implement | verify | final` (default `requirements`). Implementation is **gated**: it never runs unless `--until` is `implement`, `verify`, or `final`.
- `--engine` - `codex | claude` (default `codex`).
- `--model` - default model for light roles; heavy roles (request reviewer, question resolver, requirements writer, arbiter, plan critic, verifier, adversary, final arbiter) use `--heavy-model`.
- `--run-dir` - where artifacts and the run log are written (default
  `.agents/skills/software-delivery-team/runs/<timestamp>`).
- `--dry-run` - print the planned role invocations and exit without calling Codex/Claude.

Read/write policy is enforced per role. With Codex, analysis roles run with `--sandbox read-only --ask-for-approval never`; the implementer runs with `--sandbox workspace-write --ask-for-approval never`, and only when the implementation phase is reached. With Claude, the legacy per-tool policy is preserved: analysis roles get read-only tools and only the implementer receives edit tools.

---

## Persistent artifacts
The orchestrator writes each stage's structured output to the run directory
(`request_review.json`, `question_resolution.json`, `clarifying_questions.json`,
`requirements.json`, `requirements.md`, `findings.json`, `responses.json`, `arbitration.json`, `plan.json`,
`plan_review.json`, `plan_arbitration.json`, `implementation_report.json`,
`verification_report.json`, `adversary_report.json`, `verify_arbitration.json`,
`final_decision.json`) plus a human-readable `last-run.md` and machine-readable
`last-run.json`.

The log includes:
- round counts,
- convergence values,
- clarifying questions,
- requirements,
- confirmed findings,
- accepted plan,
- implemented steps,
- verification results,
- final decision.

---

## Output expectations
The skill itself does not perform the reasoning directly.
It defines the workflow, the agent roles, the loop conditions, and the artifact contract.
The orchestrator sequences the agents and persists the artifacts.
