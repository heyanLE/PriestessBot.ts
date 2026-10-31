import { z } from 'zod';
import { runtimeStateRanks, type Capability, type RuntimeState } from './index.js';

export const RestrictedCommandNameSchema = z.enum(['pwd','ls','cat','head','tail','wc','grep','find','stat','du','mkdir','cp','mv','touch','curl']);
export type RestrictedCommandName = z.infer<typeof RestrictedCommandNameSchema>;
export const restrictedDownloadLimits = Object.freeze({ maxBytes:20*1024*1024, timeoutMs:30_000, addressFamily:'public_ipv4', redirects:false, overwrite:false });
export interface RestrictedCommandDefinition { readonly name: RestrictedCommandName; readonly summary: string; readonly syntax: string; readonly minimumState: RuntimeState; }
export const restrictedCommandDefinitions: readonly RestrictedCommandDefinition[] = [
  {name:'pwd',summary:'显示当前工作目录。',syntax:'pwd',minimumState:'operator'},
  {name:'ls',summary:'列出工作目录中的文件。只支持 -a、-l。',syntax:'ls [-a] [-l] [相对路径...]',minimumState:'operator'},
  {name:'cat',summary:'读取普通文件，不读取标准输入或设备。',syntax:'cat 相对文件路径...',minimumState:'operator'},
  {name:'head',summary:'读取文件开头。默认 10 行，最多 1000 行。',syntax:'head [-n 行数] 相对文件路径...',minimumState:'operator'},
  {name:'tail',summary:'读取文件结尾。不支持持续跟踪。',syntax:'tail [-n 行数] 相对文件路径...',minimumState:'operator'},
  {name:'wc',summary:'统计行数、单词数和字节数。可选择其中一项。',syntax:'wc [-l|-w|-c] 相对文件路径...',minimumState:'operator'},
  {name:'grep',summary:'搜索固定文字。只支持忽略大小写和显示行号，不执行正则表达式。',syntax:'grep [-F] [-i] [-n] "文字" 相对文件路径...',minimumState:'operator'},
  {name:'find',summary:'按名称和类型查找。默认深度 3，最多 10 层；不能执行或删除文件。',syntax:'find [相对目录] [-maxdepth 0..10] [-type f|d] [-name "*.txt"]',minimumState:'operator'},
  {name:'stat',summary:'查看路径属性。',syntax:'stat 相对路径...',minimumState:'operator'},
  {name:'du',summary:'查看路径大小，以字节计。只读取获准工作目录。',syntax:'du [相对路径...]',minimumState:'operator'},
  {name:'mkdir',summary:'创建目录。-p 可同时创建父目录。',syntax:'mkdir [-p] 相对目录...',minimumState:'senior_operator'},
  {name:'cp',summary:'复制一个普通文件。不支持递归复制。',syntax:'cp 相对源文件 相对目标路径',minimumState:'senior_operator'},
  {name:'mv',summary:'移动一个普通文件。不支持递归操作。',syntax:'mv 相对源文件 相对目标路径',minimumState:'senior_operator'},
  {name:'touch',summary:'创建文件或更新普通文件的时间。',syntax:'touch 相对文件路径...',minimumState:'senior_operator'},
  {name:'curl',summary:'从公网 IPv4 地址用 HTTP(S) GET 下载到新文件。不跟随重定向，不接受请求头、上传或配置文件参数。',syntax:'curl "https://example.com/file" -o 相对输出文件',minimumState:'senior_operator'},
];
for(const definition of restrictedCommandDefinitions)Object.freeze(definition);
Object.freeze(restrictedCommandDefinitions);
export interface RuntimeCommandPolicy { readonly fullShell: boolean; readonly requiresContainer: boolean; readonly commands: readonly RestrictedCommandName[]; readonly summary: string; readonly details: string; }
function policy(state: RuntimeState): RuntimeCommandPolicy {
  return Object.freeze({ fullShell: state==='elite_operator', requiresContainer: state!=='elite_operator', commands: Object.freeze(restrictedCommandDefinitions.filter(item=>runtimeStateRanks[item.minimumState]<=runtimeStateRanks[state]).map(item=>item.name)), summary: state==='operator'?'受限读取命令':state==='senior_operator'?'受限文件整理与下载':'完整 Shell 与终端输入', details: state==='elite_operator'?'按所选执行环境和服务账户权限运行。':'只允许列出的单条命令和参数。由受信任执行器处理，不运行 shell 或任意二进制。仅支持 Docker 执行环境。' });
}
export const commandPolicyByState: Readonly<Record<RuntimeState, RuntimeCommandPolicy>> = Object.freeze({ operator:policy('operator'), senior_operator:policy('senior_operator'), elite_operator:policy('elite_operator') });

export function hasCommandControlCharacters(value:string,allowTab=false):boolean {
  for(const character of value){const code=character.charCodeAt(0);if((code<32&&(!allowTab||code!==9))||code===127||code===0x2028||code===0x2029)return true;}
  return false;
}
export function isRestrictedRelativePath(value: string): boolean {
  if (!value || value.length>1024 || value==='-' || value.startsWith('-') || value.startsWith('/') || hasCommandControlCharacters(value) || ['\\',':','~','*','?','[',']','{','}',';','&','|','<','>','$','`'].some(character=>value.includes(character))) return false;
  return !value.split('/').some(segment=>segment==='..');
}
const RelativePathSchema=z.string().refine(isRestrictedRelativePath,'仅允许工作目录内的相对路径；不能使用 ..、绝对路径、通配符或标准输入。');
const FilePathSchema=RelativePathSchema.refine(value=>value!=='.','请指定工作目录内的文件。');
const PathsSchema=z.array(RelativePathSchema).min(1).max(20);
const FilesSchema=z.array(FilePathSchema).min(1).max(20);
export function isRestrictedDownloadUrl(value: string): boolean {
  if (value.length>4096 || hasCommandControlCharacters(value) || /\s/u.test(value) || ['\\','$','`'].some(character=>value.includes(character))) return false;
  try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&!url.hostname.startsWith('[');}catch{return false;}
}
export function isRestrictedNamePattern(value:string):boolean {return value.length>0&&value.length<=256&&!hasCommandControlCharacters(value)&&!['\\','/','[',']','{','}','$','`'].some(character=>value.includes(character));}
export const RestrictedCommandSchema=z.discriminatedUnion('name',[
  z.object({name:z.literal('pwd')}).strict(),
  z.object({name:z.literal('ls'),paths:PathsSchema,all:z.boolean(),long:z.boolean()}).strict(),
  z.object({name:z.literal('cat'),paths:FilesSchema}).strict(),
  z.object({name:z.enum(['head','tail']),paths:FilesSchema,lines:z.number().int().min(1).max(1000)}).strict(),
  z.object({name:z.literal('wc'),paths:FilesSchema,mode:z.enum(['all','lines','words','bytes'])}).strict(),
  z.object({name:z.literal('grep'),paths:FilesSchema,pattern:z.string().min(1).max(1024),ignoreCase:z.boolean(),lineNumbers:z.boolean()}).strict(),
  z.object({name:z.literal('find'),path:RelativePathSchema,maxDepth:z.number().int().min(0).max(10),fileType:z.enum(['any','file','directory']),namePattern:z.string().refine(isRestrictedNamePattern).nullable()}).strict(),
  z.object({name:z.enum(['stat','du']),paths:PathsSchema}).strict(),
  z.object({name:z.literal('mkdir'),paths:FilesSchema,parents:z.boolean()}).strict(),
  z.object({name:z.enum(['cp','mv']),source:FilePathSchema,target:FilePathSchema}).strict(),
  z.object({name:z.literal('touch'),paths:FilesSchema}).strict(),
  z.object({name:z.literal('curl'),url:z.string().refine(isRestrictedDownloadUrl,'只允许不含凭据的 HTTP(S) 地址。'),output:FilePathSchema}).strict(),
]);
export type RestrictedCommand=z.infer<typeof RestrictedCommandSchema>;
export type CommandExecutionPlan={readonly mode:'full_shell';readonly command:string;readonly requiredCapabilities:readonly Capability[]}|{readonly mode:'restricted';readonly operation:RestrictedCommand;readonly requiredCapabilities:readonly Capability[]};
