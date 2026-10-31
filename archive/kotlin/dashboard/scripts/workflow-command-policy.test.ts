import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredRuntimeState, runtimeStateCapabilities, runtimeStateLabels } from '../../typescript/packages/contracts/src/index.ts';
import { commandPolicyByState, restrictedCommandDefinitions } from '../../typescript/packages/contracts/src/command-policy.ts';
import { commandDefinitionsForState, commandEnvironmentText, commandInputText, commandToolNotice } from '../src/components/typescript/command-policy-model.ts';

test('every restricted command shown in the Dashboard uses the authoritative syntax entry', () => {
  for (const state of ['operator', 'senior_operator']) {
    if (state !== 'operator' && state !== 'senior_operator') continue;
    const rows=commandDefinitionsForState(state);
    assert.deepEqual(rows.map(row=>row.name).sort(),[...commandPolicyByState[state].commands].sort());
    assert.equal(new Set(rows.map(row=>row.name)).size,rows.length);
    for(const row of rows){assert.ok(restrictedCommandDefinitions.includes(row));assert.ok(row.syntax.trim());assert.ok(row.summary.trim());}
  }
});

test('the minimum exec role is not displayed as full Shell access', () => {
  const minimum=requiredRuntimeState(['process.execute.restricted']);
  assert.equal(minimum,'operator');
  assert.equal(commandPolicyByState[minimum].fullShell,false);
  assert.equal(requiredRuntimeState(['process.execute']),'elite_operator');
  assert.equal(runtimeStateCapabilities.operator.includes('process.execute'),false);
  assert.equal(runtimeStateCapabilities.senior_operator.includes('process.execute'),false);
  const notice=commandToolNotice('exec_command');assert.ok(notice);
  assert.match(notice,/最低运行态.*允许的命令与参数/);
  assert.ok(notice.includes(runtimeStateLabels.elite_operator));
  assert.equal(commandToolNotice('memory_recall'),undefined);
});

test('only the full-Shell state shows terminal input support', () => {
  assert.equal(runtimeStateCapabilities.operator.includes('process.pty'),false);
  assert.equal(runtimeStateCapabilities.senior_operator.includes('process.pty'),false);
  assert.equal(runtimeStateCapabilities.elite_operator.includes('process.pty'),true);
  assert.match(commandInputText('operator'),/不能向进程写入/);
  assert.match(commandInputText('senior_operator'),/不能向进程写入/);
  assert.match(commandInputText('elite_operator'),/可以向进程写入/);
  assert.match(commandToolNotice('write_stdin') ?? '',/高级资深干员态.*进程轮询/);
});

test('restricted environment guidance cannot imply trusted-host execution is available', () => {
  assert.equal(commandPolicyByState.operator.requiresContainer,true);
  assert.equal(commandPolicyByState.senior_operator.requiresContainer,true);
  assert.match(commandEnvironmentText('operator'),/^仅 Docker 或 SDK Docker/);
  assert.match(commandEnvironmentText('senior_operator'),/^仅 Docker 或 SDK Docker/);
  assert.equal(commandPolicyByState.elite_operator.fullShell,true);
  assert.deepEqual(commandDefinitionsForState('elite_operator'),[]);
  assert.match(commandEnvironmentText('elite_operator'),/服务账户权限/);
});
