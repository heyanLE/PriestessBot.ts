import { commandPolicyByState, hasCommandControlCharacters, isRestrictedNamePattern, isRestrictedRelativePath, restrictedCommandDefinitions, RestrictedCommandNameSchema, RestrictedCommandSchema, type CommandExecutionPlan, type RestrictedCommand, type RestrictedCommandName } from '../../contracts/src/command-policy.js';
import type { Capability, RuntimeState } from '../../contracts/src/index.js';

export class CommandPolicyError extends Error { readonly code='command_not_allowed'; }
interface Token { value:string; quoted:boolean; escaped:boolean; }

/** Lexical subset only. Nothing returned from this parser is evaluated by a shell. */
function tokenize(command:string):Token[] {
  if(command.length>8192)throw new CommandPolicyError('受限命令最多 8192 个字符。请拆分为多次调用。');
  if(hasCommandControlCharacters(command,true)||/[$`]/u.test(command))throw new CommandPolicyError('受限命令不支持换行、控制字符、变量或命令替换。');
  const tokens:Token[]=[];let value='';let active=false;let quoted=false;let escaped=false;let quote: 'single'|'double'|undefined;
  const finish=():void=>{if(active){tokens.push({value,quoted,escaped});value='';active=false;quoted=false;escaped=false;}if(tokens.length>64)throw new CommandPolicyError('受限命令最多 64 个参数。');};
  for(let index=0;index<command.length;index++){
    const character=command[index];if(character===undefined)break;
    if(quote==='single'){if(character==="'")quote=undefined;else value+=character;continue;}
    if(quote==='double'){
      if(character==='"'){quote=undefined;continue;}
      if(character==='\\'){const next=command[++index];if(next!=='"'&&next!=='\\')throw new CommandPolicyError('双引号内只支持引号和反斜杠转义。');value+=next;escaped=true;continue;}
      value+=character;continue;
    }
    if(character===' '||character==='\t'){finish();continue;}
    if(/[;&|<>(){}#]/u.test(character))throw new CommandPolicyError('受限命令不支持管道、重定向、命令链、分组或注释。');
    active=true;
    if(character==="'"||character==='"'){quote=character==="'"?'single':'double';quoted=true;continue;}
    if(character==='\\'){const next=command[++index];if(next===undefined||![' ','\t',"'",'"','\\'].includes(next))throw new CommandPolicyError('不支持此转义。请用引号包住包含空格的参数。');value+=next;escaped=true;continue;}
    value+=character;
  }
  if(quote!==undefined)throw new CommandPolicyError('引号没有闭合。请检查命令参数。');
  finish();return tokens;
}
function usage(name:RestrictedCommandName,reason:string):never {const definition=restrictedCommandDefinitions.find(item=>item.name===name);throw new CommandPolicyError(`${reason} 用法：${definition?.syntax ?? name}`);}
function normalizePath(value:string,name:RestrictedCommandName,file=false):string {
  if(!isRestrictedRelativePath(value))usage(name,'路径不受支持。请使用工作目录内的相对路径，不要使用 ..、绝对路径、通配符或标准输入。');
  const normalized=value.split('/').filter(part=>part&&part!=='.').join('/')||'.';
  if(!isRestrictedRelativePath(normalized)||file&&normalized==='.')usage(name,'请指定工作目录内的文件或子目录。');
  return normalized;
}
function paths(values:readonly string[],name:RestrictedCommandName,file=false,defaults=false):string[] {
  const list=values.length?values:defaults?['.']:[];
  if(!list.length||list.length>20)usage(name,'请提供 1 到 20 个路径。');
  return list.map(value=>normalizePath(value,name,file));
}
function integer(value:string|undefined,name:RestrictedCommandName,min:number,max:number):number {
  if(value===undefined||!/^\d+$/u.test(value))usage(name,`请填写 ${min} 到 ${max} 的整数。`);
  const number=Number(value);if(!Number.isSafeInteger(number)||number<min||number>max)usage(name,`请填写 ${min} 到 ${max} 的整数。`);return number;
}
function noFlags(values:readonly string[],name:RestrictedCommandName):string[] {
  const result=values[0]==='--'?values.slice(1):[...values];
  if(result.some(value=>value.startsWith('-')))usage(name,'不支持此参数。');return result;
}
function parse(name:RestrictedCommandName,args:readonly string[]):RestrictedCommand {
  switch(name){
    case 'pwd':if(args.length)usage(name,'pwd 不接受参数。');return{name};
    case 'ls':{
      let all=false;let long=false;let index=0;
      for(;index<args.length;index++){const arg=args[index];if(arg==='--'){index++;break;}if(!arg?.startsWith('-'))break;if(!/^-[al]+$/u.test(arg))usage(name,'ls 只支持 -a 和 -l。');all ||= arg.includes('a');long ||= arg.includes('l');}
      return{name,paths:paths(args.slice(index),name,false,true),all,long};
    }
    case 'cat':return{name,paths:paths(noFlags(args,name),name,true)};
    case 'head':case 'tail':{
      let lines=10;let index=0;
      if(args[0]==='-n'){lines=integer(args[1],name,1,1000);index=2;}
      return{name,paths:paths(noFlags(args.slice(index),name),name,true),lines};
    }
    case 'wc':{
      let mode:'all'|'lines'|'words'|'bytes'='all';let index=0;
      if(args[0]==='-l'){mode='lines';index=1;}else if(args[0]==='-w'){mode='words';index=1;}else if(args[0]==='-c'){mode='bytes';index=1;}
      return{name,paths:paths(noFlags(args.slice(index),name),name,true),mode};
    }
    case 'grep':{
      let ignoreCase=false;let lineNumbers=false;let index=0;
      for(;index<args.length;index++){const arg=args[index];if(arg==='--'){index++;break;}if(!arg?.startsWith('-'))break;if(!/^-[Fin]+$/u.test(arg))usage(name,'grep 只支持固定字符串搜索及 -F、-i、-n。');ignoreCase ||= arg.includes('i');lineNumbers ||= arg.includes('n');}
      const pattern=args[index++];if(!pattern||pattern.length>1024)usage(name,'搜索文字须为 1 到 1024 个字符。');
      return{name,paths:paths(noFlags(args.slice(index),name),name,true),pattern,ignoreCase,lineNumbers};
    }
    case 'find':{
      let index=0;let path='.';let maxDepth=3;let fileType:'any'|'file'|'directory'='any';let namePattern:string|null=null;const seen=new Set<string>();
      const first=args[0];if(first!==undefined&&!first.startsWith('-')){path=normalizePath(first,name);index++;}
      while(index<args.length){const flag=args[index++];if(flag===undefined||seen.has(flag))usage(name,'不支持重复或缺失的查找条件。');seen.add(flag);const value=args[index++];
        if(flag==='-maxdepth')maxDepth=integer(value,name,0,10);
        else if(flag==='-type'){if(value!=='f'&&value!=='d')usage(name,'-type 只支持 f 或 d。');fileType=value==='f'?'file':'directory';}
        else if(flag==='-name'){if(!value||!isRestrictedNamePattern(value))usage(name,'-name 仅支持文件名以及 *、? 通配符。');namePattern=value;}
        else usage(name,'find 只支持 -maxdepth、-type 和 -name，不支持执行或删除。');
      }
      return{name,path,maxDepth,fileType,namePattern};
    }
    case 'stat':case 'du':return{name,paths:paths(noFlags(args,name),name,false,name==='du')};
    case 'mkdir':{const parents=args[0]==='-p';return{name,paths:paths(noFlags(args.slice(parents?1:0),name),name,true),parents};}
    case 'cp':case 'mv':{const list=noFlags(args,name);if(list.length!==2)usage(name,'请提供一个源文件和一个目标路径。不支持递归或其他参数。');const source=list[0];const target=list[1];if(source===undefined||target===undefined)usage(name,'源文件或目标路径缺失。');return{name,source:normalizePath(source,name,true),target:normalizePath(target,name,true)};}
    case 'touch':return{name,paths:paths(noFlags(args,name),name,true)};
    case 'curl':{
      let url:string|undefined;let output:string|undefined;
      for(let index=0;index<args.length;index++){const arg=args[index];if(arg==='-o'||arg==='--output'){if(output!==undefined)usage(name,'只允许一个输出文件。');const value=args[++index];if(!value)usage(name,'-o 后必须填写输出文件。');output=normalizePath(value,name,true);}
        else if(arg?.startsWith('-'))usage(name,'curl 只支持 -o 或 --output。不支持请求头、上传、配置文件和重定向参数。');
        else {if(!arg||url!==undefined)usage(name,'只允许一个 HTTP(S) 地址。');url=arg;}}
      if(url===undefined||output===undefined)usage(name,'必须指定一个 HTTP(S) 地址和 -o 输出文件。');
      const parsed=RestrictedCommandSchema.safeParse({name,url,output});if(!parsed.success)usage(name,'请填写不带账号、密码或片段的 HTTP(S) 地址。不支持 IPv6 字面量或反斜杠。');return parsed.data;
    }
  }
}
function requiredCapabilities(operation:RestrictedCommand):readonly Capability[] {
  switch(operation.name){
    case 'mkdir':case 'touch':return ['process.execute.restricted','files.write'];
    case 'cp':case 'mv':return ['process.execute.restricted','files.read','files.write'];
    case 'curl':return ['process.execute.restricted','files.write','external.write'];
    default:return ['process.execute.restricted','files.read'];
  }
}
/** `state` must be supplied by trusted RunContext, never model arguments. */
export function compileCommandPolicy(command:string,state:RuntimeState):CommandExecutionPlan {
  if(!command.trim()||command.includes('\0'))throw new CommandPolicyError('命令不能为空，也不能包含空字符。');
  if(state==='elite_operator')return {mode:'full_shell',command,requiredCapabilities:['process.execute']};
  const tokens=tokenize(command);const first=tokens[0];
  if(!first||first.quoted||first.escaped||!/^[a-z]+$/u.test(first.value))throw new CommandPolicyError('请直接填写命令名。不能使用命令路径、引号、转义或环境变量启动命令。');
  const parsedName=RestrictedCommandNameSchema.safeParse(first.value);
  if(!parsedName.success||!commandPolicyByState[state].commands.includes(parsedName.data))throw new CommandPolicyError(`当前运行态不允许此命令。允许：${commandPolicyByState[state].commands.join('、')}。`);
  const operation=RestrictedCommandSchema.parse(parse(parsedName.data,tokens.slice(1).map(token=>token.value)));
  return {mode:'restricted',operation,requiredCapabilities:requiredCapabilities(operation)};
}
