import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AgentDefinitionSchema, GrantListSchema, GrantSchema, MessageEventSchema, RunIdSchema, RuntimeConfigSchema, PrincipalSchema, runtimeStateCapabilities, requiredRuntimeState, type RunContext } from '../packages/contracts/src/index.js';
import { AuthorizationService, principalKey } from '../packages/core/src/authorization.js';
import { RuntimeStore } from '../packages/core/src/storage.js';
import { simulateFlow } from '../packages/core/src/flow.js';
import { CommandRegistry } from '../packages/core/src/commands.js';
import { migrateFixedStates } from '../tools/migrate-fixed-states.js';

const agent = AgentDefinitionSchema.parse({ id: 'assistant', displayName: 'Assistant', capabilities: ['chat'], resources: { tools: ['read_file', 'exec_command'], directories: ['/allowed'], executionEnvironment: 'sandbox' } });
const principal = PrincipalSchema.parse({ platform: 'qq', senderId: '101', sessionId: 'room', sessionType: 'group' });
const group = GrantSchema.parse({ platform: 'qq', senderIds: ['101', '202'], state: 'elite_operator' });
function context(auth: AuthorizationService): RunContext { return { ...auth.resolve(principal, agent), principal, agentId: agent.id, runId: RunIdSchema.parse('test'), turnId: 'test', generation: 0, configRevision: 0, flowRevision: 0, signal: new AbortController().signal, budget: agent.budget, depth: 0 }; }

void test('fixed role definitions are immutable and classify each operation consistently', () => {
  assert.equal(Object.isFrozen(runtimeStateCapabilities), true);
  for (const capabilities of Object.values(runtimeStateCapabilities)) assert.equal(Object.isFrozen(capabilities), true);
  assert.equal(requiredRuntimeState(['files.read']), 'operator');
  assert.equal(requiredRuntimeState(['files.write','process.execute.restricted']), 'senior_operator');
  assert.equal(requiredRuntimeState(['resources.manage','admin']), 'elite_operator');
  assert.equal(requiredRuntimeState(['process.execute']), 'elite_operator');
});
void test('multiple exact sender IDs share one assigned role without cross-platform or prefix matching', () => {
  const auth = new AuthorizationService([group]);
  assert.equal(auth.state(principal), 'elite_operator');
  assert.equal(auth.state({ ...principal, senderId: '202' }), 'elite_operator');
  assert.equal(auth.state({ ...principal, senderId: '10' }), 'operator');
  assert.equal(auth.state({ ...principal, platform: 'tg' }), 'operator');
  assert.equal(auth.resolve(principal, agent).effectiveCapabilities.includes('admin'), true);
  assert.deepEqual(auth.resolve(principal, agent).resources, agent.resources);
});
void test('canonical IDs are trimmed and deduplicated while legacy role ceilings never elevate defaults', () => {
  assert.deepEqual(GrantSchema.parse({ platform: 'qq', senderIds: ['101',' 101 ','202'], state: 'senior_operator' }).senderIds, ['101','202']);
  const legacy = GrantSchema.parse({ platform:'qq', senderId:'101', maximumState:'elite_operator', defaultState:'operator', capabilities:['admin'], resources:{tools:['anything']} });
  assert.deepEqual(legacy, {platform:'qq',senderIds:['101'],state:'operator'});
  assert.throws(()=>GrantSchema.parse({platform:'qq',senderIds:[''],state:'operator'}));
  assert.throws(()=>GrantSchema.parse({platform:'qq',senderId:'101',maximumState:'operator',defaultState:'elite_operator',capabilities:[],resources:{}}),/默认运行态高于最高运行态/);
});
void test('scope-specific roles are preserved and contradictory roles for the same scope are rejected', () => {
  const privateRole=GrantSchema.parse({platform:'qq',senderIds:['101'],state:'senior_operator',sessionType:'private'});
  const auth=new AuthorizationService([group,privateRole]);
  assert.equal(auth.state({...principal,sessionType:'private'}),'senior_operator');
  assert.equal(auth.state(principal),'elite_operator');
  assert.throws(()=>GrantListSchema.parse([group,{...group,state:'operator'}]),/不同运行态/);
  assert.throws(()=>new AuthorizationService([group,{...group,state:'operator'}]),/不同运行态/);
});
void test('historic requested states and old Agent capability lists cannot override fixed roles', () => {
  const store=new RuntimeStore(':memory:');
  try {
    store.put('requested-state',principalKey(principal),'elite_operator');
    const auth=new AuthorizationService([],store);
    assert.equal(auth.state(principal),'operator');
    assert.equal(auth.resolve(principal,agent).effectiveCapabilities.includes('files.read'),true);
    assert.equal(auth.resolve(principal,agent).effectiveCapabilities.includes('process.execute'),false);
    assert.throws(()=>auth.requestState(principal,'elite_operator'),/管理员分配/);
    assert.equal(auth.requestState(principal,'operator'),'operator');
  } finally {store.close();}
});
void test('role replacement revokes old effects and internal ceilings still restrict delegated authority', () => {
  const auth=new AuthorizationService([group]); const old=context(auth);
  assert.deepEqual(auth.resolve(principal,agent,'operator',['chat']).effectiveCapabilities,['chat']);
  assert.equal(auth.resolve(principal,agent,'senior_operator').effectiveCapabilities.includes('admin'),false);
  auth.replaceGrants([{...group,state:'operator'}]);
  assert.throws(()=>auth.assert(old,'process.execute',agent),/Authorization changed/);
  assert.equal(auth.state({...principal,senderId:'202'}),'operator');
});
void test('legacy global ceilings cannot silently change assigned roles during normal routing', () => {
  const config=RuntimeConfigSchema.parse({runtime:'priestess-ts',schemaVersion:1,agents:[agent],grants:[group],flow:{authorization:{maximumState:'operator'},routing:{defaultAgentId:agent.id,rules:[]},acceptance:{groupPolicy:'all'}}});
  const message=MessageEventSchema.parse({...principal,platformType:'napcat',messageId:'m',timestamp:1,botId:'bot',parts:[{type:'text',text:'hello'}]});
  assert.equal(simulateFlow(config,message).runtimeState,'elite_operator');
});
void test('different command requirements reject unauthorized operations before executing their bodies', async () => {
  const auth=new AuthorizationService([{...group,state:'operator'}]);const registry=new CommandRegistry(auth);let effects=0;
  registry.register({name:'write',usage:'/write',argsSchema:z.array(z.string()).length(0),parse:tokens=>tokens,minimumState:'senior_operator',requiredCapabilities:['files.write'],execute:()=>{effects++;return Promise.resolve('done');},reply:text=>({parts:[{type:'text',text}]})});
  assert.equal((await registry.dispatch('/write',context(auth),agent)).status,'rejected');assert.equal(effects,0);
  auth.replaceGrants([{...group,state:'senior_operator'}]);
  assert.equal((await registry.dispatch('/write',context(auth),agent)).status,'handled');assert.equal(effects,1);
});
void test('minimum-state-only commands recheck revocation even without extra capability declarations', async () => {
  const auth=new AuthorizationService([group]);const old=context(auth);const registry=new CommandRegistry(auth);let effects=0;
  registry.register({name:'restricted',usage:'/restricted',argsSchema:z.array(z.string()).length(0),parse:tokens=>tokens,minimumState:'senior_operator',requiredCapabilities:[],execute:()=>{effects++;return Promise.resolve('done');},reply:text=>({parts:[{type:'text',text}]})});
  auth.replaceGrants([]);
  assert.equal((await registry.dispatch('/restricted',old,agent)).status,'rejected');assert.equal(effects,0);
});

async function fixture() {
  const directory=await mkdtemp(join(tmpdir(),'fixed-state-migration-'));const database=join(directory,'runtime.sqlite');
  const source={runtime:'priestess-ts',schemaVersion:1,revision:7,agents:[{id:'assistant',displayName:'Original',capabilities:['chat'],resources:{tools:['read_file']}}],grants:[{platform:'qq',senderId:'private-sender-value',maximumState:'elite_operator',defaultState:'senior_operator',capabilities:['chat'],resources:{tools:[]}}],flow:{revision:7,routing:{defaultAgentId:'assistant',rules:[]}}};
  const db=new DatabaseSync(database);db.exec('CREATE TABLE configuration(revision INTEGER PRIMARY KEY,value TEXT,created_at INTEGER);CREATE TABLE documents(namespace TEXT,id TEXT,value TEXT,PRIMARY KEY(namespace,id));');
  db.prepare('INSERT INTO configuration VALUES(?,?,?)').run(7,JSON.stringify(source),1);
  db.prepare('INSERT INTO documents VALUES(?,?,?)').run('management-personas','persona',JSON.stringify({name:'Untouched persona',instructions:'Keep this exact text'}));
  db.prepare('INSERT INTO documents VALUES(?,?,?)').run('requested-state','historic',JSON.stringify('elite_operator'));db.close();
  return {directory,database,source};
}
function rawLatest(database:string): unknown {const db=new DatabaseSync(database,{readOnly:true});try{return JSON.parse(z.object({value:z.string()}).parse(db.prepare('SELECT value FROM configuration ORDER BY revision DESC LIMIT 1').get()).value);}finally{db.close();}}
void test('offline migration dry-run discloses changed policy counts without writing or exposing identities', async () => {
  const f=await fixture();try {
    const report=await migrateFixedStates({database:f.database});
    assert.equal(report.applied,false);assert.equal(report.sourceRevision,7);assert.equal(report.legacyRulesConverted,1);assert.equal(report.states.senior_operator,1);assert.equal(report.legacyCeilingsIgnored,1);assert.equal(report.legacyCapabilityPoliciesRetired,1);assert.equal(report.legacyResourcePoliciesRetired,1);assert.equal(report.storedRequestedStatesIgnored,1);
    assert.doesNotMatch(JSON.stringify(report),/private-sender-value|Untouched persona/);
    assert.deepEqual(rawLatest(f.database),f.source);assert.equal((await readdir(f.directory)).some(name=>name.includes('backup')),false);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
void test('offline apply adds a private backup and revision while preserving all persona and historic records', async () => {
  const f=await fixture();try {
    await assert.rejects(migrateFixedStates({database:f.database,apply:true}),/runtime-stopped/);
    const report=await migrateFixedStates({database:f.database,apply:true,runtimeStopped:true});
    assert.equal(report.targetRevision,8);assert.equal(report.backupCreated,true);assert.ok(report.backupPath);assert.equal((await stat(report.backupPath)).mode&0o777,0o600);
    const next=RuntimeConfigSchema.parse(rawLatest(f.database));assert.equal(next.revision,8);assert.equal(next.flow.revision,8);assert.deepEqual(next.grants,[{platform:'qq',senderIds:['private-sender-value'],state:'senior_operator'}]);
    const db=new DatabaseSync(f.database,{readOnly:true});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM configuration').get()?.['n'],2);assert.equal(db.prepare("SELECT value FROM documents WHERE namespace='management-personas'").get()?.['value'],JSON.stringify({name:'Untouched persona',instructions:'Keep this exact text'}));db.close();
    const again=await migrateFixedStates({database:f.database,apply:true,runtimeStopped:true});assert.equal(again.alreadyApplied,true);assert.equal(again.applied,false);assert.equal(again.backupCreated,false);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
void test('rollback writes the original legacy shape as a new revision without removing newer conversation data', async () => {
  const f=await fixture();try {
    await migrateFixedStates({database:f.database,apply:true,runtimeStopped:true});
    const db=new DatabaseSync(f.database);db.prepare('INSERT INTO documents VALUES(?,?,?)').run('management-transcript','new',JSON.stringify({text:'preserve newer message'}));db.close();
    const report=await migrateFixedStates({database:f.database,apply:true,runtimeStopped:true,rollbackRevision:7});assert.equal(report.targetRevision,9);
    const expected={...f.source,revision:9,flow:{...f.source.flow,revision:9}};assert.deepEqual(rawLatest(f.database),expected);
    const check=new DatabaseSync(f.database,{readOnly:true});assert.ok(check.prepare("SELECT value FROM documents WHERE namespace='management-transcript'").get());assert.equal(check.prepare("SELECT 1 FROM documents WHERE namespace='permission-policy'").get(),undefined);check.close();
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
void test('migration refuses active or paused work without changing its state', async () => {
  const f=await fixture();try {
    const db=new DatabaseSync(f.database);db.prepare('INSERT INTO documents VALUES(?,?,?)').run('runs','paused',JSON.stringify({status:'paused'}));db.close();
    await assert.rejects(migrateFixedStates({database:f.database,apply:true,runtimeStopped:true}),/Active or paused/);
    assert.deepEqual(rawLatest(f.database),f.source);
    const check=new DatabaseSync(f.database,{readOnly:true});assert.equal(check.prepare("SELECT value FROM documents WHERE namespace='runs'").get()?.['value'],JSON.stringify({status:'paused'}));check.close();
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
