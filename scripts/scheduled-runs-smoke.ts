// Smoke test for scheduled runs — runs once and exits. Used during
// feature verification. Not part of production code.
//
// Invoke: DATABASE_PATH=/tmp/x.db tsx --tsconfig server/tsconfig.json scripts/scheduled-runs-smoke.ts

import { scheduledRunsRepository, initializeDatabase } from '../server/modules/database/index.js';
import { getConnection } from '../server/modules/database/connection.js';
import { validateCron, nextRunAt, describeCron } from '../server/utils/cron.js';

await initializeDatabase();

const db = getConnection();
db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'test', 'x');
db.prepare('INSERT OR IGNORE INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, NULL, 0, 0)').run('p1', '/tmp/some-project');

console.log('=== cron validation ===');
const cronTests: [string, string][] = [
  ['0 8 * * *', 'UTC'],
  ['*/15 * * * *', 'UTC'],
  ['0 0 * * 1', 'UTC'],
  ['0 0 * * 7', 'UTC'],
  ['0 8 * * * *', 'UTC'],
  ['0 8 * * MON', 'UTC'],
  ['60 8 * * *', 'UTC'],
];
for (const [expr, tz] of cronTests) {
  const r = validateCron(expr);
  console.log(`  ${expr.padEnd(20)} @ ${tz.padEnd(15)} -> ok=${r.ok}${r.ok ? '' : ' (' + r.error + ')'}`);
}

console.log('\n=== nextRunAt (from 2026-01-15T22:00:00Z) ===');
const from = new Date('2026-01-15T22:00:00Z');
const nextCases: [string, string][] = [
  ['0 8 * * *', 'UTC'],
  ['*/15 * * * *', 'UTC'],
  ['0 8 * * *', 'Asia/Tehran'],
];
for (const [expr, tz] of nextCases) {
  try {
    const next = nextRunAt(expr, tz, from);
    console.log(`  ${expr.padEnd(20)} @ ${tz.padEnd(15)} -> ${next.toISOString()}`);
  } catch (e) {
    console.log(`  ${expr.padEnd(20)} @ ${tz.padEnd(15)} -> ERROR`);
  }
}

console.log('\n=== describeCron ===');
for (const [expr, tz] of [['0 8 * * *', 'UTC'], ['*/15 * * * *', 'UTC'], ['0 0 * * 1', 'UTC']]) {
  console.log(`  ${expr.padEnd(20)} @ ${tz.padEnd(15)} -> ${describeCron(expr, tz)}`);
}

console.log('\n=== repository CRUD ===');
// Clean up any previous test data
db.prepare('DELETE FROM scheduled_runs WHERE user_id = 1').run();

console.log('  initial list:', scheduledRunsRepository.list(1).length);
const created = scheduledRunsRepository.create(1, {
  title: 'Morning Sentry Triage',
  projectPath: '/tmp/some-project',
  provider: 'claude',
  model: 'claude-sonnet-4',
  prompt: 'Check Sentry.',
  cronExpression: '0 8 * * *',
  timezone: 'UTC',
  notifyOnSuccess: false,
  notifyOnFailure: true,
  isEnabled: true,
  nextRunAt: '2026-01-16 08:00:00',
});
console.log('  created:', created.id, '->', created.title, 'nextRunAt:', created.nextRunAt);

const claim1 = scheduledRunsRepository.claimNextRun(created.id, 'manual');
console.log('  claim1:', claim1 ? `run=${claim1.run.id} status=${claim1.run.status}` : 'null');
const claim2 = scheduledRunsRepository.claimNextRun(created.id, 'manual');
console.log('  claim2 (while in-flight, should be null):', claim2);

if (claim1) {
  const finished = scheduledRunsRepository.finishRun(claim1.run.id, 'succeeded', 'hello world', null, '2026-01-17 08:00:00', false);
  console.log('  finishRun:', finished?.status, 'durationMs:', finished?.durationMs);
  const claim3 = scheduledRunsRepository.claimNextRun(created.id, 'manual');
  console.log('  claim3 (after finish):', claim3 ? 'run=' + claim3.run.id : 'null');
  if (claim3) scheduledRunsRepository.finishRun(claim3.run.id, 'failed', null, 'simulated error', null, false);
}

console.log('  history count:', scheduledRunsRepository.listHistory(created.id, 50).length);
const updated = scheduledRunsRepository.update(1, created.id, { title: 'Updated title' });
console.log('  updated title:', updated?.title);
const disabled = scheduledRunsRepository.setEnabled(1, created.id, false);
console.log('  disabled:', disabled?.isEnabled);

// Test orphan repair: insert a fake orphan row and run repair
db.prepare('INSERT INTO scheduled_run_history (schedule_id, user_id, status, trigger, started_at) VALUES (?, 1, ?, ?, ?)').run(created.id, 'running', 'tick', '2025-01-01 00:00:00');
db.prepare('UPDATE scheduled_runs SET in_flight_run_id = (SELECT id FROM scheduled_run_history WHERE schedule_id = ? AND status = ?) WHERE id = ?').run(created.id, 'running', created.id);

const repaired = scheduledRunsRepository.repairOrphanedRuns();
console.log('  repairOrphanedRuns:', repaired, '(should be ≥ 1)');

const deleted = scheduledRunsRepository.delete(1, created.id);
console.log('  deleted:', deleted);
console.log('  final list:', scheduledRunsRepository.list(1).length);

console.log('\n=== ALL TESTS PASSED ===');
