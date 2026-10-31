import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandPolicyByState, RestrictedCommandSchema } from '../packages/contracts/src/command-policy.js';
import { runtimeStateCapabilities } from '../packages/contracts/src/index.js';
import { CommandPolicyError, compileCommandPolicy } from '../packages/core/src/command-policy.js';

void test('runtime states expose only the documented command subsets and privileged terminal input',()=>{
  assert.deepEqual(commandPolicyByState.operator.commands,['pwd','ls','cat','head','tail','wc','grep','find','stat','du']);
  assert.deepEqual(commandPolicyByState.senior_operator.commands,['pwd','ls','cat','head','tail','wc','grep','find','stat','du','mkdir','cp','mv','touch','curl']);
  assert.equal(commandPolicyByState.operator.requiresContainer,true);assert.equal(commandPolicyByState.senior_operator.requiresContainer,true);assert.equal(commandPolicyByState.elite_operator.fullShell,true);
  assert.equal(runtimeStateCapabilities.operator.includes('process.execute.restricted'),true);
  assert.equal(runtimeStateCapabilities.operator.includes('process.execute'),false);
  assert.equal(runtimeStateCapabilities.senior_operator.includes('process.execute'),false);
  assert.equal(runtimeStateCapabilities.operator.includes('process.pty'),false);assert.equal(runtimeStateCapabilities.senior_operator.includes('process.pty'),false);assert.equal(runtimeStateCapabilities.elite_operator.includes('process.pty'),true);
});
void test('read commands normalize quoted parameters without retaining a shell command',()=>{
  assert.deepEqual(compileCommandPolicy('ls -al "./docs folder//"','operator'),{mode:'restricted',operation:{name:'ls',paths:['docs folder'],all:true,long:true},requiredCapabilities:['process.execute.restricted','files.read']});
  assert.deepEqual(compileCommandPolicy("cat 'notes one.txt' docs/two.txt",'operator').mode,'restricted');
  assert.deepEqual(compileCommandPolicy('head -n 25 ./notes.txt','operator'),{mode:'restricted',operation:{name:'head',paths:['notes.txt'],lines:25},requiredCapabilities:['process.execute.restricted','files.read']});
  assert.deepEqual(compileCommandPolicy('tail notes.txt','operator'),{mode:'restricted',operation:{name:'tail',paths:['notes.txt'],lines:10},requiredCapabilities:['process.execute.restricted','files.read']});
  assert.deepEqual(compileCommandPolicy('wc -c notes.txt','operator'),{mode:'restricted',operation:{name:'wc',paths:['notes.txt'],mode:'bytes'},requiredCapabilities:['process.execute.restricted','files.read']});
});
void test('grep always uses literal text and find accepts only bounded traversal predicates',()=>{
  const grep=compileCommandPolicy('grep -Fin "a.*(b); literal" "notes file.txt"','operator');assert.equal(grep.mode,'restricted');if(grep.mode!=='restricted')throw new Error('Expected restricted plan');
  assert.deepEqual(grep.operation,{name:'grep',paths:['notes file.txt'],pattern:'a.*(b); literal',ignoreCase:true,lineNumbers:true});
  assert.deepEqual(compileCommandPolicy('find ./docs -maxdepth 2 -type f -name "*.txt"','operator'),{mode:'restricted',operation:{name:'find',path:'docs',maxDepth:2,fileType:'file',namePattern:'*.txt'},requiredCapabilities:['process.execute.restricted','files.read']});
  assert.deepEqual(compileCommandPolicy('find','operator'),{mode:'restricted',operation:{name:'find',path:'.',maxDepth:3,fileType:'any',namePattern:null},requiredCapabilities:['process.execute.restricted','files.read']});
});
void test('senior operations have explicit normalized file and download arguments',()=>{
  assert.deepEqual(compileCommandPolicy('mkdir -p "reports/new folder"','senior_operator'),{mode:'restricted',operation:{name:'mkdir',paths:['reports/new folder'],parents:true},requiredCapabilities:['process.execute.restricted','files.write']});
  assert.deepEqual(compileCommandPolicy('cp old.txt new.txt','senior_operator'),{mode:'restricted',operation:{name:'cp',source:'old.txt',target:'new.txt'},requiredCapabilities:['process.execute.restricted','files.read','files.write']});
  assert.deepEqual(compileCommandPolicy('mv old.txt archive/new.txt','senior_operator'),{mode:'restricted',operation:{name:'mv',source:'old.txt',target:'archive/new.txt'},requiredCapabilities:['process.execute.restricted','files.read','files.write']});
  assert.deepEqual(compileCommandPolicy('curl "https://example.com/file?x=1&y=2" -o downloads/result.txt','senior_operator'),{mode:'restricted',operation:{name:'curl',url:'https://example.com/file?x=1&y=2',output:'downloads/result.txt'},requiredCapabilities:['process.execute.restricted','files.write','external.write']});
});
void test('operator cannot reach write commands and neither restricted role can launch interpreters or binaries',()=>{
  for(const command of ['mkdir x','cp a b','mv a b','touch x','curl https://example.com -o x'])assert.throws(()=>compileCommandPolicy(command,'operator'),CommandPolicyError);
  for(const state of ['operator','senior_operator'] satisfies ('operator'|'senior_operator')[]){
    for(const command of ['rm a','sh -c ls','bash -c ls','python -c pass','node -e process.exit()','env ls','sudo ls','busybox ls','command ls','exec ls','xargs cat','tar xf a.tar','./ls','/bin/ls','/usr/bin/env ls','PATH=/tmp ls','LD_PRELOAD=evil.so ls','"ls"','l"s"','\\ls','LS'])assert.throws(()=>compileCommandPolicy(command,state),CommandPolicyError,command);
  }
});
void test('shell syntax cannot be hidden through chains, expansion, escapes or comments',()=>{
  for(const command of ['ls; touch x','ls && touch x','ls | cat','cat x > y','cat x < y','ls\ntouch x','ls\r\ntouch x','ls\u2028touch x','cat $(pwd)/x','cat "$(pwd)/x"',"cat '$HOME/x'",'cat `pwd`/x','ls # comment','(ls)','{ ls; }','ls &','cat x\\;touch y','cat "unterminated','cat bad\\npath','ls\0'])assert.throws(()=>compileCommandPolicy(command,'senior_operator'),CommandPolicyError,command);
  const escaped=compileCommandPolicy('cat notes\\ one.txt','operator');assert.equal(escaped.mode,'restricted');if(escaped.mode==='restricted')assert.deepEqual(escaped.operation,{name:'cat',paths:['notes one.txt']});
});
void test('all path-bearing variants reject traversal, absolute paths, stdin and glob expansion',()=>{
  for(const path of ['../secret','a/../secret','/etc/passwd','//server/file','C:/Windows/file','~/secret','-','*.txt','a?b','foo/[ab]','safe;rm','file:secret']){
    for(const prefix of ['cat','head','tail','wc','stat','du','touch','mkdir'])assert.throws(()=>compileCommandPolicy(`${prefix} "${path}"`,'senior_operator'),CommandPolicyError,`${prefix}: ${path}`);
    assert.throws(()=>compileCommandPolicy(`cp safe.txt "${path}"`,'senior_operator'),CommandPolicyError,path);
    assert.throws(()=>compileCommandPolicy(`mv "${path}" safe.txt`,'senior_operator'),CommandPolicyError,path);
    assert.throws(()=>compileCommandPolicy(`curl https://example.com -o "${path}"`,'senior_operator'),CommandPolicyError,path);
  }
  assert.throws(()=>RestrictedCommandSchema.parse({name:'cat',paths:['../secret']}));
});
void test('unknown or dangerous flags are refused rather than forwarded to a command implementation',()=>{
  for(const command of ['ls -R','ls --help','cat -n a','head -c 10 a','tail -f a','wc -lw a','grep -E x a','grep -r x .','grep --include=x x a','find . -exec sh -c x','find . -delete','find . -L','find . -name x -name y','find . -maxdepth 11','find . -type l','find . -name "[ab]"','mkdir -m 777 x','cp -r a b','cp --parents a b','mv -t dir a','touch -r a b','curl -K config -o x','curl --config config -o x','curl -H "x: y" https://example.com -o x','curl -T file https://example.com -o x','curl -d data https://example.com -o x','curl -L https://example.com -o x','curl --url https://example.com -o x','curl https://example.com -o -','curl https://example.com','curl file:///etc/passwd -o x','curl https://user:pass@example.com -o x','curl "https://example.com/#fragment" -o x','curl https://example.com -o x -o y'])assert.throws(()=>compileCommandPolicy(command,'senior_operator'),CommandPolicyError,command);
});
void test('full-shell mode preserves privileged commands while still refusing impossible input',()=>{
  const command='printf hello | cat\nrm -- "old file"';assert.deepEqual(compileCommandPolicy(command,'elite_operator'),{mode:'full_shell',command,requiredCapabilities:['process.execute']});
  assert.throws(()=>compileCommandPolicy('   ','elite_operator'),CommandPolicyError);assert.throws(()=>compileCommandPolicy('ls\0','elite_operator'),CommandPolicyError);
});
