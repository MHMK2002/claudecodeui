#!/usr/bin/env node
// orchestrator.mjs - drives the software-delivery-team workflows.
//
// Each role is a prompt contract in ../agents/<role>.md. The default engine is
// Codex (`codex exec`), with Claude kept as an explicit compatibility option.
//
// Usage:
//   node orchestrator.mjs [--mode review|request]
//                         [--target working|staged|<gitRange>] [--target-file <path>]
//                         [--request <text>] [--request-file <path>] [--answers-file <path>]
//                         [--level simple|medium|high]
//                         [--until review|intake|requirements|plan|implement|verify|final]
//                         [--engine codex|claude]
//                         [--model <m>] [--heavy-model <m>] [--run-dir <dir>] [--dry-run]

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');
const AGENTS_DIR = join(SKILL_DIR, 'agents');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const THRESHOLDS = { review: 85, plan: 80, verify: 90 };

const ROUND_CAPS = {
  simple: { review: 1, plan: 1, verify: 1 },
  medium: { review: 3, plan: 2, verify: 2 },
  high: { review: 5, plan: 3, verify: 3 },
};

const REVIEW_PHASE_ORDER = ['review', 'plan', 'implement', 'verify', 'final'];
const REQUEST_PHASE_ORDER = ['intake', 'requirements', 'plan', 'implement', 'verify', 'final'];
const ENGINES = new Set(['codex', 'claude']);
const MODES = new Set(['review', 'request']);

// Claude-only tool policy. Codex uses sandbox + approval policy instead.
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git:*)'];
const WRITE_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'Bash'];

const HEAVY_ROLES = new Set([
  'request_reviewer',
  'question_resolver',
  'requirements_writer',
  'arbiter',
  'plan_critic',
  'verifier',
  'adversary',
  'final_arbiter',
]);

function parseArgs(argv) {
  const args = {
    mode: null,
    target: 'working',
    targetFile: null,
    request: null,
    requestFile: null,
    answersFile: null,
    level: 'medium',
    until: null,
    engine: process.env.SDT_ENGINE || 'codex',
    model: process.env.SDT_MODEL || process.env.CODEX_MODEL || null,
    heavyModel: process.env.SDT_HEAVY_MODEL || process.env.CODEX_HEAVY_MODEL || null,
    runDir: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '--mode': args.mode = next(); break;
      case '--target': args.target = next(); break;
      case '--target-file': args.targetFile = next(); break;
      case '--request': args.request = next(); break;
      case '--request-file': args.requestFile = next(); break;
      case '--answers-file': args.answersFile = next(); break;
      case '--level': args.level = next(); break;
      case '--until': args.until = next(); break;
      case '--engine': args.engine = next(); break;
      case '--model': args.model = next(); break;
      case '--heavy-model': args.heavyModel = next(); break;
      case '--run-dir': args.runDir = next(); break;
      case '--dry-run': args.dryRun = true; break;
      case '-h': case '--help': printHelp(); process.exit(0); break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }

  if (!ROUND_CAPS[args.level]) throw new Error(`invalid --level: ${args.level}`);
  if (!ENGINES.has(args.engine)) throw new Error(`invalid --engine: ${args.engine}`);

  args.mode ??= (args.request || args.requestFile) ? 'request' : 'review';
  if (!MODES.has(args.mode)) throw new Error(`invalid --mode: ${args.mode}`);

  if (args.mode === 'request' && !args.request && !args.requestFile) {
    throw new Error('--mode request requires --request or --request-file');
  }
  if (args.mode === 'review' && (args.request || args.requestFile || args.answersFile)) {
    throw new Error('request flags can only be used with --mode request');
  }

  args.until ??= args.mode === 'request' ? 'requirements' : 'verify';
  if (!phaseOrderFor(args.mode).includes(args.until)) {
    throw new Error(`invalid --until for ${args.mode} mode: ${args.until}`);
  }

  if (args.engine === 'claude') {
    args.model ||= process.env.CLAUDE_MODEL || 'sonnet';
    args.heavyModel ||= process.env.CLAUDE_HEAVY_MODEL || 'opus';
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  # Codex-first request intake. Stops after requirements unless --until goes further.
  node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \\
    --mode request --request "Add archived tab restore" --until requirements

  # Continue a clarified request through implementation and verification.
  node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \\
    --mode request --request-file request.md --answers-file answers.md --until verify

  # Review an existing working-tree diff.
  node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \\
    --target working --level medium --until verify

  # Keep the old Claude backend explicitly.
  node .agents/skills/software-delivery-team/workflow/orchestrator.mjs \\
    --target HEAD~1..HEAD --engine claude --level high --until final
`.trim());
}

function phaseOrderFor(mode) {
  return mode === 'request' ? REQUEST_PHASE_ORDER : REVIEW_PHASE_ORDER;
}

function reached(args, phase) {
  const order = phaseOrderFor(args.mode);
  return order.indexOf(phase) <= order.indexOf(args.until);
}

// ---------------------------------------------------------------------------
// Target and request resolution
// ---------------------------------------------------------------------------

function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { encoding: 'utf8', maxBuffer: 1 << 28 });
}

function gitOrEmpty(cmdArgs) {
  try {
    return git(cmdArgs).trim();
  } catch {
    return '';
  }
}

function resolveTarget(args) {
  if (args.targetFile) {
    const path = resolve(args.targetFile);
    return { kind: 'file', label: path, diff: readFileSync(path, 'utf8') };
  }
  if (args.target === 'working') {
    return {
      kind: 'diff',
      label: 'uncommitted working-tree changes',
      diff: git(['diff']) + git(['diff', '--stat']),
    };
  }
  if (args.target === 'staged') {
    return {
      kind: 'diff',
      label: 'staged changes',
      diff: git(['diff', '--cached']) + git(['diff', '--cached', '--stat']),
    };
  }
  return {
    kind: 'diff',
    label: `git ${args.target}`,
    diff: git(['diff', args.target]) + git(['diff', '--stat', args.target]),
  };
}

function resolveRequest(args) {
  const requestPath = args.requestFile ? resolve(args.requestFile) : null;
  const answerPath = args.answersFile ? resolve(args.answersFile) : null;
  const text = requestPath ? readFileSync(requestPath, 'utf8') : args.request;
  if (!text?.trim()) throw new Error('request text is empty');
  return {
    kind: 'request',
    label: requestPath || 'inline request',
    text,
    answers: answerPath ? readFileSync(answerPath, 'utf8') : null,
    answerLabel: answerPath,
  };
}

function repositoryContext() {
  return {
    status: gitOrEmpty(['status', '--short']),
    recent_commits: gitOrEmpty(['log', '--oneline', '--decorate', '-n', '30']),
  };
}

function currentDiffTarget() {
  return {
    kind: 'diff',
    label: 'current working-tree changes',
    diff: git(['diff']) + git(['diff', '--stat']),
  };
}

// ---------------------------------------------------------------------------
// Agent invocation
// ---------------------------------------------------------------------------

function agentSystemPrompt(role) {
  return readFileSync(join(AGENTS_DIR, `${role}.md`), 'utf8');
}

function extractJson(text) {
  if (!text || !text.trim()) throw new Error('agent returned empty output');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced
    ? fenced[1]
    : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    throw new Error(`could not parse agent JSON: ${err.message}\n--- raw ---\n${text.slice(0, 2000)}`);
  }
}

function modelForRole(args, role) {
  return HEAVY_ROLES.has(role) ? args.heavyModel : args.model;
}

function runAgent(role, userMessage, opts) {
  const { args, allowWrite = false } = opts;
  const model = modelForRole(args, role);

  if (args.dryRun) {
    console.log(`\n[dry-run] ${role} (engine=${args.engine}, model=${model || 'config-default'}, write=${allowWrite})`);
    console.log(`  message: ${userMessage.slice(0, 240).replace(/\n/g, ' ')}...`);
    return { __dryRun: true, role };
  }

  if (args.engine === 'claude') return runClaudeAgent(role, userMessage, args, allowWrite);
  return runCodexAgent(role, userMessage, args, allowWrite);
}

function runClaudeAgent(role, userMessage, args, allowWrite) {
  const model = modelForRole(args, role);
  const tools = allowWrite ? WRITE_TOOLS : READ_TOOLS;
  const cliArgs = [
    '-p', userMessage,
    '--append-system-prompt', agentSystemPrompt(role),
    '--output-format', 'json',
    '--model', model,
    '--allowedTools', ...tools,
  ];
  if (!allowWrite) cliArgs.push('--permission-mode', 'plan');

  const raw = execFileSync('claude', cliArgs, { encoding: 'utf8', maxBuffer: 1 << 28 });
  let wrapper;
  try {
    wrapper = JSON.parse(raw);
  } catch {
    wrapper = { result: raw };
  }
  return extractJson(wrapper.result ?? raw);
}

function runCodexAgent(role, userMessage, args, allowWrite) {
  const model = modelForRole(args, role);
  const tempDir = mkdtempSync(join(tmpdir(), 'sdt-codex-'));
  const outputPath = join(tempDir, `${role}.txt`);
  const prompt = [
    'You are executing one structured role in the software-delivery-team workflow.',
    'Follow ROLE_CONTRACT exactly. Return only the strict JSON artifact requested by that contract.',
    'Use repository files and git history as evidence when the role calls for research.',
    'If you cannot continue safely, report the blocker or clarification questions in the JSON schema.',
    '--- ROLE_CONTRACT ---',
    agentSystemPrompt(role),
    '--- TASK ---',
    userMessage,
  ].join('\n\n');

  const cliArgs = [
    'exec',
    '--cd', process.cwd(),
    '--sandbox', allowWrite ? 'workspace-write' : 'read-only',
    '--ask-for-approval', 'never',
    '--ephemeral',
    '--output-last-message', outputPath,
  ];
  if (model) cliArgs.push('--model', model);
  cliArgs.push('-');

  try {
    execFileSync('codex', cliArgs, { input: prompt, encoding: 'utf8', maxBuffer: 1 << 28 });
    return extractJson(readFileSync(outputPath, 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const block = (label, obj) =>
  `--- ${label} ---\n${typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)}\n`;

function reviewerPrompt(target, priorArbitration) {
  let p = `Review the following ${target.label}. Output findings per your schema.\n\n${block('TARGET', target.diff)}`;
  if (priorArbitration) {
    p += `\nA previous round produced this arbitration. Address its directives and drop rejected findings, keeping ids stable.\n${block('PRIOR_ARBITRATION', priorArbitration)}`;
  }
  return p;
}

const responderPrompt = (target, findings) =>
  `Respond to each finding per your schema.\n\n${block('TARGET', target.diff)}${block('FINDINGS', findings)}`;

const arbiterPrompt = (findings, responses) =>
  `Arbitrate this review debate per your schema. Set an honest convergence score.\n\n${block('FINDINGS', findings)}${block('RESPONSES', responses)}`;

const requestReviewerPrompt = (request, context) =>
  `Review this raw user request before implementation. Find ambiguity, conflict with prior decisions, product-decision gaps, technical risk, hidden assumptions, and likely implementation problems. Do not ask the user yet; produce candidate concerns per your schema after inspecting repository context as needed.\n\n${block('USER_REQUEST', request.text)}${block('REPOSITORY_CONTEXT', context)}`;

const questionResolverPrompt = (request, review) => {
  let p = 'Resolve each candidate concern against repository code, docs, and git history. Ask the user only for decisions that are not answered or defensibly inferable from existing context. Output per your schema.';
  p += `\n\n${block('USER_REQUEST', request.text)}${block('REQUEST_REVIEW', review)}`;
  if (request.answers) p += `${block('USER_ANSWERS', request.answers)}`;
  return p;
};

const requirementsWriterPrompt = (request, review, resolution) =>
  `Convert the clarified request into an implementation-ready requirements document per your schema. If required questions remain unresolved, return status "blocked" and do not invent requirements.\n\n${block('USER_REQUEST', request.text)}${block('REQUEST_REVIEW', review)}${block('QUESTION_RESOLUTION', resolution)}${request.answers ? block('USER_ANSWERS', request.answers) : ''}`;

const plannerPrompt = (target, arbitration, priorCritique) => {
  let p = `Turn the confirmed findings into a minimal, ordered plan per your schema.\n\n${block('TARGET', target.diff)}${block('ARBITRATION', arbitration)}`;
  if (priorCritique) p += `\nRevise to address this critique.\n${block('PLAN_CRITIQUE', priorCritique)}`;
  return p;
};

const plannerFromRequirementsPrompt = (requirements, priorCritique) => {
  let p = `Turn the approved requirements into a minimal, ordered implementation plan per your schema.\n\n${block('REQUIREMENTS', requirements)}`;
  if (priorCritique) p += `\nRevise to address this critique.\n${block('PLAN_CRITIQUE', priorCritique)}`;
  return p;
};

const planCriticPrompt = (plan) =>
  `Attack this plan per your schema.\n\n${block('PLAN', plan)}`;

const implementerPrompt = (plan, requirements) => {
  let p = `Implement ONLY the approved plan below, in order, staying strictly in scope. If the plan or requirements are ambiguous, emit clarification questions or blockers instead of guessing. Report per your schema.\n\n${block('APPROVED_PLAN', plan)}`;
  if (requirements) p += `${block('REQUIREMENTS', requirements)}`;
  return p;
};

const verifierPrompt = (plan, impl, target, requirements) => {
  let p = `Verify the implementation against the plan per your schema.\n\n${block('PLAN', plan)}${block('IMPLEMENTATION', impl)}${block('CURRENT_DIFF', target.diff)}`;
  if (requirements) p += `${block('REQUIREMENTS', requirements)}`;
  return p;
};

const planArbiterPrompt = (plan, critique) =>
  `Adjudicate this implementation plan. The planner (proposer) produced it; the plan critic (challenger) attacked it. Decide per your schema and set an honest convergence score - ${THRESHOLDS.plan}+ means the plan is acceptable. Use each plan step id or critic issue id as the finding_id.\n\n${block('PLAN', plan)}${block('PLAN_CRITIQUE', critique)}`;

const adversaryPrompt = (plan, impl, target, requirements) => {
  let p = `Adversarially attack the implemented change. Try hard to break it and find what the verifier missed. Report per your schema.\n\n${block('APPROVED_PLAN', plan)}${block('IMPLEMENTATION', impl)}${block('CURRENT_DIFF', target.diff)}`;
  if (requirements) p += `${block('REQUIREMENTS', requirements)}`;
  return p;
};

const verifyArbiterPrompt = (verification, adversarial) =>
  `Adjudicate whether the implementation is truly done. The verifier (proposer) checked plan-conformance; the adversary (challenger) hunted regressions. Decide per your schema and set an honest convergence score - ${THRESHOLDS.verify}+ means done. Use each verifier item or regression id as the finding_id.\n\n${block('VERIFICATION', verification)}${block('ADVERSARY', adversarial)}`;

const finalArbiterPrompt = (state) =>
  `Make the final release decision per your schema, reviewing the full chain.\n\n${block('RUN_STATE', state)}`;

// ---------------------------------------------------------------------------
// Convergence / stop-condition helpers
// ---------------------------------------------------------------------------

const SEVERE = new Set(['high', 'critical']);

function hasUnresolvedSevere(arbitration) {
  const verdicts = arbitration?.verdicts ?? [];
  return verdicts.some(
    (v) => v.verdict === 'needs_more_evidence' && SEVERE.has((v.final_severity || '').toLowerCase()),
  );
}

const reviewConverged = (arb) =>
  (arb?.convergence ?? 0) >= THRESHOLDS.review && !hasUnresolvedSevere(arb);

const planGatePassed = (arb, critique) =>
  (critique?.approval ?? 'revise') !== 'reject' &&
  (arb?.convergence ?? 0) >= THRESHOLDS.plan &&
  !hasUnresolvedSevere(arb);

const severeRegression = (report) =>
  (report?.regressions ?? []).some((r) => SEVERE.has((r.severity || '').toLowerCase()));

function verifyGatePassed(arb, verification, adversarial) {
  const planMiss = (verification?.verdicts ?? []).some((v) => ['missing', 'incorrect'].includes(v.status));
  return (arb?.convergence ?? 0) >= THRESHOLDS.verify &&
    !hasUnresolvedSevere(arb) &&
    !planMiss &&
    !severeRegression(verification) &&
    !severeRegression(adversarial);
}

const questionResolutionBlocked = (resolution) =>
  resolution?.blocked === true || (resolution?.questions ?? []).length > 0;

const requirementsBlocked = (requirements) =>
  requirements?.status === 'blocked' || (requirements?.open_questions ?? []).length > 0;

const implementationBlocked = (implementation) =>
  (implementation?.blockers ?? []).length > 0 || (implementation?.questions ?? []).length > 0;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function makeRunDir(args) {
  if (args.runDir) {
    mkdirSync(args.runDir, { recursive: true });
    return args.runDir;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(SKILL_DIR, 'runs', stamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function save(runDir, name, obj) {
  if (obj?.__dryRun) return;
  writeFileSync(join(runDir, name), JSON.stringify(obj, null, 2));
}

function saveRequirementsMarkdown(runDir, requirements) {
  const markdown = requirements?.requirements_markdown;
  if (typeof markdown === 'string' && markdown.trim()) {
    writeFileSync(join(runDir, 'requirements.md'), markdown);
  }
}

function saveClarifyingQuestions(runDir, resolution) {
  save(runDir, 'clarifying_questions.json', {
    blocked: resolution?.blocked ?? false,
    questions: resolution?.questions ?? [],
    summary: resolution?.summary ?? '',
  });
}

function writeRunLog(runDir, state) {
  save(runDir, 'last-run.json', state);
  const L = [];
  L.push('# Multi-agent review run\n');
  L.push(`- mode: ${state.mode}`);
  L.push(`- target: ${state.target}`);
  L.push(`- engine: ${state.engine}`);
  L.push(`- level: ${state.level}`);
  L.push(`- phases run: ${state.phasesRun.join(' -> ')}`);
  L.push(`- review rounds: ${state.reviewRounds}`);
  L.push(`- plan rounds: ${state.planRounds}`);
  L.push(`- verify rounds: ${state.verifyRounds}`);
  if (state.reviewConvergence != null) L.push(`- review convergence: ${state.reviewConvergence}`);
  if (state.planConvergence != null) L.push(`- plan convergence: ${state.planConvergence}`);
  if (state.verifyConvergence != null) L.push(`- verify convergence: ${state.verifyConvergence}`);
  if (state.finalDecision) L.push(`- final decision: **${state.finalDecision.decision}** - ${state.finalDecision.reason}`);
  L.push('');

  const confirmed = (state.arbitration?.verdicts ?? []).filter((v) => v.verdict === 'confirmed');
  if (confirmed.length) {
    L.push(`## Confirmed findings (${confirmed.length})`);
    for (const v of confirmed) L.push(`- ${v.finding_id} [${v.final_severity}] - ${v.reason}`);
    L.push('');
  }

  const questions = state.questionResolution?.questions ?? [];
  if (questions.length) {
    L.push(`## Clarifying questions (${questions.length})`);
    for (const q of questions) L.push(`- ${q.id}: ${q.question}`);
    L.push('');
  }

  const reqs = state.requirements?.requirements ?? [];
  if (reqs.length) {
    L.push(`## Requirements (${reqs.length})`);
    for (const r of reqs) L.push(`- ${r.id} [${r.type}] - ${r.statement}`);
    L.push('');
  }

  if (state.plan) {
    L.push(`## Accepted plan: ${state.plan.goal ?? state.plan.plan_id ?? ''}`);
    for (const s of state.plan.steps ?? []) L.push(`- ${s.id} (${s.risk}) - ${s.title}`);
    L.push('');
  }

  if (state.implementation) {
    L.push('## Implementation');
    for (const c of state.implementation.changes ?? []) L.push(`- ${c.step_id}: ${c.status} - ${c.notes}`);
    if (state.implementation.blockers?.length) L.push(`- blockers: ${state.implementation.blockers.join('; ')}`);
    if (state.implementation.questions?.length) {
      for (const q of state.implementation.questions) L.push(`- question ${q.id}: ${q.question}`);
    }
    L.push('');
  }

  if (state.verification) {
    L.push('## Verification');
    for (const v of state.verification.verdicts ?? []) L.push(`- ${v.item}: ${v.status} - ${v.reason}`);
    L.push('');
  }

  writeFileSync(join(runDir, 'last-run.md'), L.join('\n'));
}

// ---------------------------------------------------------------------------
// Shared phase runners
// ---------------------------------------------------------------------------

function runPlanLoop(args, runDir, state, plannerMessage) {
  let plan, planCritique, planArbitration;
  for (let r = 1; r <= ROUND_CAPS[args.level].plan; r++) {
    state.planRounds = r;
    console.log(`. plan round ${r}/${ROUND_CAPS[args.level].plan}`);
    plan = runAgent('planner', plannerMessage(planCritique), { args });
    planCritique = runAgent('plan_critic', planCriticPrompt(plan), { args });
    planArbitration = runAgent('arbiter', planArbiterPrompt(plan, planCritique), { args });
    save(runDir, 'plan.json', plan);
    save(runDir, 'plan_review.json', planCritique);
    save(runDir, 'plan_arbitration.json', planArbitration);
    state.plan = plan;
    state.planCritique = planCritique;
    state.planArbitration = planArbitration;
    state.planConvergence = planArbitration?.convergence;
    if (!args.dryRun && planGatePassed(planArbitration, planCritique)) {
      console.log('  [ok] plan accepted by arbiter');
      break;
    }
  }
  state.phasesRun.push('plan');
  return { plan, planCritique, planArbitration };
}

function runImplementation(args, runDir, state, plan, requirements) {
  console.log('. implement');
  const implementation = runAgent('implementer', implementerPrompt(plan, requirements), { args, allowWrite: true });
  save(runDir, 'implementation_report.json', implementation);
  state.implementation = implementation;
  state.phasesRun.push('implement');
  if (!args.dryRun && implementationBlocked(implementation)) {
    console.log('  [blocked] implementer reported blockers or questions');
  }
  return implementation;
}

function runVerificationLoop(args, runDir, state, plan, implementation, target, requirements) {
  let verification, adversarial, verifyArbitration;
  for (let r = 1; r <= ROUND_CAPS[args.level].verify; r++) {
    state.verifyRounds = r;
    console.log(`. verify round ${r}/${ROUND_CAPS[args.level].verify}`);
    verification = runAgent('verifier', verifierPrompt(plan, implementation, target, requirements), { args });
    adversarial = runAgent('adversary', adversaryPrompt(plan, implementation, target, requirements), { args });
    verifyArbitration = runAgent('arbiter', verifyArbiterPrompt(verification, adversarial), { args });
    save(runDir, 'verification_report.json', verification);
    save(runDir, 'adversary_report.json', adversarial);
    save(runDir, 'verify_arbitration.json', verifyArbitration);
    state.verification = verification;
    state.adversarial = adversarial;
    state.verifyArbitration = verifyArbitration;
    state.verifyConvergence = verifyArbitration?.convergence;
    if (!args.dryRun && verifyGatePassed(verifyArbitration, verification, adversarial)) {
      console.log('  [ok] verification passed');
      break;
    }
  }
  state.phasesRun.push('verify');
}

function planRejected(planCritique, planArbitration) {
  return planCritique?.approval === 'reject' || hasUnresolvedSevere(planArbitration);
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

function runReviewWorkflow(args, runDir, state) {
  const target = resolveTarget(args);
  state.target = target.label;

  console.log(`> software-delivery-team | mode=review | target=${target.label} | engine=${args.engine} | level=${args.level} | until=${args.until}`);
  console.log(`  run dir: ${runDir}${args.dryRun ? '  (DRY RUN)' : ''}\n`);

  let findings, responses, arbitration;
  for (let r = 1; r <= ROUND_CAPS[args.level].review; r++) {
    state.reviewRounds = r;
    console.log(`. review round ${r}/${ROUND_CAPS[args.level].review}`);
    findings = runAgent('reviewer', reviewerPrompt(target, arbitration), { args });
    responses = runAgent('responder', responderPrompt(target, findings), { args });
    arbitration = runAgent('arbiter', arbiterPrompt(findings, responses), { args });
    save(runDir, 'findings.json', findings);
    save(runDir, 'responses.json', responses);
    save(runDir, 'arbitration.json', arbitration);
    state.arbitration = arbitration;
    state.reviewConvergence = arbitration?.convergence;
    if (!args.dryRun && reviewConverged(arbitration)) {
      console.log('  [ok] review converged');
      break;
    }
  }
  state.phasesRun.push('review');
  if (!reached(args, 'plan')) return finish(runDir, state);

  const { plan, planCritique, planArbitration } = runPlanLoop(
    args,
    runDir,
    state,
    (priorCritique) => plannerPrompt(target, arbitration, priorCritique),
  );
  if (!reached(args, 'implement')) return finish(runDir, state);

  if (!args.dryRun && planRejected(planCritique, planArbitration)) {
    console.log('  [blocked] plan rejected - stopping before implementation');
    return finish(runDir, state);
  }

  const implementation = runImplementation(args, runDir, state, plan, null);
  if (!reached(args, 'verify') || (!args.dryRun && implementationBlocked(implementation))) {
    return finish(runDir, state);
  }

  const diffAfterImplementation = args.dryRun ? target : currentDiffTarget();
  runVerificationLoop(args, runDir, state, plan, implementation, diffAfterImplementation, null);
  if (!reached(args, 'final')) return finish(runDir, state);

  return runFinalDecision(args, runDir, state);
}

function runRequestWorkflow(args, runDir, state) {
  const request = resolveRequest(args);
  state.target = request.label;
  state.request = request.text;

  console.log(`> software-delivery-team | mode=request | target=${request.label} | engine=${args.engine} | level=${args.level} | until=${args.until}`);
  console.log(`  run dir: ${runDir}${args.dryRun ? '  (DRY RUN)' : ''}\n`);

  console.log('. request intake');
  const requestReview = runAgent(
    'request_reviewer',
    requestReviewerPrompt(request, repositoryContext()),
    { args },
  );
  const questionResolution = runAgent(
    'question_resolver',
    questionResolverPrompt(request, requestReview),
    { args },
  );
  save(runDir, 'request_review.json', requestReview);
  save(runDir, 'question_resolution.json', questionResolution);
  state.requestReview = requestReview;
  state.questionResolution = questionResolution;
  state.phasesRun.push('intake');

  if (!args.dryRun && questionResolutionBlocked(questionResolution)) {
    saveClarifyingQuestions(runDir, questionResolution);
    console.log('  [blocked] clarification needed - wrote clarifying_questions.json');
    return finish(runDir, state);
  }
  if (!reached(args, 'requirements')) return finish(runDir, state);

  console.log('. requirements');
  const requirements = runAgent(
    'requirements_writer',
    requirementsWriterPrompt(request, requestReview, questionResolution),
    { args },
  );
  save(runDir, 'requirements.json', requirements);
  saveRequirementsMarkdown(runDir, requirements);
  state.requirements = requirements;
  state.phasesRun.push('requirements');

  if (!args.dryRun && requirementsBlocked(requirements)) {
    console.log('  [blocked] requirements still contain open questions');
    return finish(runDir, state);
  }
  if (!reached(args, 'plan')) return finish(runDir, state);

  const { plan, planCritique, planArbitration } = runPlanLoop(
    args,
    runDir,
    state,
    (priorCritique) => plannerFromRequirementsPrompt(requirements, priorCritique),
  );
  if (!reached(args, 'implement')) return finish(runDir, state);

  if (!args.dryRun && planRejected(planCritique, planArbitration)) {
    console.log('  [blocked] plan rejected - stopping before implementation');
    return finish(runDir, state);
  }

  const implementation = runImplementation(args, runDir, state, plan, requirements);
  if (!reached(args, 'verify') || (!args.dryRun && implementationBlocked(implementation))) {
    return finish(runDir, state);
  }

  const diffAfterImplementation = args.dryRun ? { label: 'dry-run diff', diff: '' } : currentDiffTarget();
  runVerificationLoop(args, runDir, state, plan, implementation, diffAfterImplementation, requirements);
  if (!reached(args, 'final')) return finish(runDir, state);

  return runFinalDecision(args, runDir, state);
}

function runFinalDecision(args, runDir, state) {
  console.log('. final decision');
  const finalDecision = runAgent('final_arbiter', finalArbiterPrompt(state), { args });
  save(runDir, 'final_decision.json', finalDecision);
  state.finalDecision = finalDecision;
  state.phasesRun.push('final');
  return finish(runDir, state);
}

function finish(runDir, state) {
  writeRunLog(runDir, state);
  console.log(`\n[done] artifacts + last-run.md in:\n  ${runDir}`);
  if (state.finalDecision) console.log(`  final: ${state.finalDecision.decision}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDir = makeRunDir(args);
  const state = {
    mode: args.mode,
    engine: args.engine,
    level: args.level,
    until: args.until,
    phasesRun: [],
    reviewRounds: 0,
    planRounds: 0,
    verifyRounds: 0,
  };

  if (args.mode === 'request') return runRequestWorkflow(args, runDir, state);
  return runReviewWorkflow(args, runDir, state);
}

main().catch((err) => {
  console.error(`\n[failed] orchestrator failed: ${err.message}`);
  process.exit(1);
});
