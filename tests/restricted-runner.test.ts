import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileCommandPolicy } from '../packages/core/src/command-policy.js';
import { restrictedRunnerLaunch, restrictedRunnerProgram } from '../packages/adapters/src/execution/restricted-runner.js';
import type { RuntimeState } from '../packages/contracts/src/index.js';

interface Result { code: number; stdout: string; stderr: string; }
function command(executable: string, args: readonly string[], timeout = 30_000): Promise<Result> {
  return new Promise((resolve,reject)=>{
    execFile(executable,args,{encoding:'utf8',timeout,maxBuffer:2_000_000},(error,stdout,stderr)=>{
      const code=error?.code ?? 0;
      if(error && typeof error.code!=='number' || typeof code!=='number'){reject(error instanceof Error ? error : new Error('Process did not return an exit code'));return;}
      resolve({code,stdout,stderr});
    });
  });
}
const image = process.env['RESTRICTED_TEST_IMAGE'] ?? 'priestess-ts:integration';
async function usableDocker(): Promise<boolean> {
  try {return (await command('docker',['run','--rm','--pull=never','--network=none','--read-only','--entrypoint','/usr/local/bin/node',image,'--version'],10_000)).code===0;}catch{return false;}
}
async function run(root:string, input:string, state:RuntimeState='operator',networkEnabled=false):Promise<Result>{
  const plan=compileCommandPolicy(input,state);assert.equal(plan.mode,'restricted');if(plan.mode!=='restricted')throw new Error('Expected restricted plan');
  const launch=restrictedRunnerLaunch(plan.operation,'/workspace',networkEnabled);
  const uid=process.getuid?.() ?? 1000;const gid=process.getgid?.() ?? 1000;
  return command('docker',['run','--rm','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--cpus=1','--user',`${uid}:${gid}`,'--mount',`type=bind,src=${root},dst=/workspace`,'--workdir','/workspace','--env','NODE_OPTIONS=--require /workspace/evil.cjs','--env','NODE_PATH=/workspace/node_modules','--entrypoint',launch.executable,image,...launch.args]);
}

await test('serialized runner is self-contained and does not use process or code execution primitives',()=>{
  const program=restrictedRunnerProgram();
  assert.ok(program.includes('node:fs/promises'));assert.ok(program.includes('/proc/self/fd/'));
  assert.doesNotMatch(program,/node:child_process|\beval\s*\(|\bnew Function\b/);
  const launch=restrictedRunnerLaunch({name:'pwd'},'/workspace',false);
  assert.equal(launch.executable,'/usr/bin/env');assert.equal(launch.args[0],'-i');
  assert.ok(launch.args.includes('/usr/local/bin/node'));assert.ok(launch.args.includes('--'));
  const payload=launch.args.at(-1);assert.ok(payload);const decoded:unknown=JSON.parse(Buffer.from(payload,'base64').toString());
  assert.deepEqual(decoded,{operation:{name:'pwd'},root:'/workspace',networkEnabled:false});
});

await test('Linux restricted runner preserves read-only semantics and rejects filesystem escape objects',{timeout:120_000},async t=>{
  if(!await usableDocker()){t.skip('Local Docker with the preinstalled Node test image is required');return;}
  const root=await mkdtemp(path.join(tmpdir(),'priestess-restricted-read-'));
  try{
    await writeFile(path.join(root,'sample.txt'),'alpha\na.b\naxb\nlast\n');await writeFile(path.join(root,'evil.cjs'),"require('node:fs').writeFileSync('/workspace/executed','bad')");
    await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'nested','note.txt'),'nested');
    await symlink('/etc/passwd',path.join(root,'escape'));await symlink('nested',path.join(root,'linked-directory'));
    await writeFile(path.join(root,'hard-a'),'hardlinked');await link(path.join(root,'hard-a'),path.join(root,'hard-b'));
    assert.equal((await command('mkfifo',[path.join(root,'pipe')])).code,0);
    const pwd=await run(root,'pwd');assert.equal(pwd.code,0,pwd.stderr);assert.equal(pwd.stdout,'/workspace\n');
    const contents=await run(root,'cat sample.txt');assert.equal(contents.code,0,contents.stderr);assert.equal(contents.stdout,'alpha\na.b\naxb\nlast\n');
    assert.equal((await run(root,'head -n 2 sample.txt')).stdout,'alpha\na.b\n');assert.equal((await run(root,'tail -n 1 sample.txt')).stdout,'last\n');
    const grep=await run(root,'grep -n "a.b" sample.txt');assert.equal(grep.stdout,'sample.txt:2:a.b\n');
    assert.match((await run(root,'wc -l sample.txt')).stdout,/^4\s+sample\.txt/);
    const found=await run(root,'find . -name "*.txt"');assert.equal(found.code,0,found.stderr);assert.match(found.stdout,/nested\/note\.txt/);assert.doesNotMatch(found.stdout,/linked-directory/);
    for(const forbidden of ['cat escape','cat hard-a','cat pipe','cat linked-directory/note.txt']) {const result=await run(root,forbidden);assert.equal(result.code,1,forbidden);assert.match(result.stderr,/链接|特殊文件|目录/);}
    await assert.rejects(access(path.join(root,'executed')));
    assert.equal(await readFile(path.join(root,'sample.txt'),'utf8'),'alpha\na.b\naxb\nlast\n');
  }finally{await rm(root,{recursive:true,force:true});}
});

await test('Linux restricted mutations never overwrite and downloads reject private addresses or disabled networking',{timeout:120_000},async t=>{
  if(!await usableDocker()){t.skip('Local Docker with the preinstalled Node test image is required');return;}
  const root=await mkdtemp(path.join(tmpdir(),'priestess-restricted-write-'));
  try{
    await writeFile(path.join(root,'source.txt'),'original');await writeFile(path.join(root,'evil.cjs'),"require('node:fs').writeFileSync('/workspace/executed','bad')");
    const made=await run(root,'mkdir -p outputs/nested','senior_operator');assert.equal(made.code,0,made.stderr);
    const copy=await run(root,'cp source.txt outputs/nested/copy.txt','senior_operator');assert.equal(copy.code,0,copy.stderr);
    const overwrite=await run(root,'cp source.txt outputs/nested/copy.txt','senior_operator');assert.equal(overwrite.code,1);assert.match(overwrite.stderr,/不会覆盖/);
    const moved=await run(root,'mv outputs/nested/copy.txt outputs/moved.txt','senior_operator');assert.equal(moved.code,0,moved.stderr);await assert.rejects(access(path.join(root,'outputs/nested/copy.txt')));
    const touched=await run(root,'touch outputs/moved.txt','senior_operator');assert.equal(touched.code,0,touched.stderr);assert.equal(await readFile(path.join(root,'outputs/moved.txt'),'utf8'),'original');
    const privateUrl=await run(root,'curl http://127.0.0.1/file -o private.txt','senior_operator',true);assert.equal(privateUrl.code,1);assert.match(privateUrl.stderr,/公共 IPv4/);await assert.rejects(access(path.join(root,'private.txt')));
    const offline=await run(root,'curl https://example.com/file -o offline.txt','senior_operator',false);assert.equal(offline.code,1);assert.match(offline.stderr,/未开启网络/);await assert.rejects(access(path.join(root,'offline.txt')));
    const partial=await run(root,'curl http://8.8.8.8/file -o partial.txt','senior_operator',true);assert.equal(partial.code,1);assert.match(partial.stderr,/未自动删除/);assert.equal(await readFile(path.join(root,'partial.txt'),'utf8'),'');
    await assert.rejects(access(path.join(root,'executed')));
  }finally{await rm(root,{recursive:true,force:true});}
});
