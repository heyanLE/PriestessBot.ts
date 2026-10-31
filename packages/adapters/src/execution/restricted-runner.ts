import type { Stats } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { RestrictedCommandSchema, type RestrictedCommand } from '../../../contracts/src/command-policy.js';

/** This function is serialized as a fixed program. All operations use Node built-ins. */
export async function restrictedCommandMain(): Promise<void> {
  const fs = await import('node:fs/promises');
  const constants = (await import('node:fs')).constants;
  const path = await import('node:path');
  const http = await import('node:http');
  const https = await import('node:https');
  const dns = await import('node:dns/promises');
  const tls = await import('node:tls');
  const handles: Awaited<ReturnType<typeof fs.open>>[] = [];
  const deadline = Date.now() + 30_000;
  const readLimit = 1_000_000; const transferLimit = 20 * 1024 * 1024; const outputLimit = 200_000;
  let outputChars = 0; let outputFull = false; let visited = 0;
  function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
  function text(value: unknown): string { if (typeof value !== 'string') throw new Error('命令参数格式错误。'); return value; }
  function strings(value: unknown): string[] { if (!Array.isArray(value)) throw new Error('缺少文件路径。'); const items: unknown[] = value; if (!items.length || items.length > 20) throw new Error('每次最多处理 20 个路径。'); return items.map(text); }
  function boolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('命令开关格式错误。'); return value; }
  function integer(value: unknown, min: number, max: number): number { if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('命令数值超出范围。'); return value; }
  function checkWork(): void { if (Date.now() > deadline) throw new Error('受限命令超过 30 秒，请缩小操作范围。'); }
  function emit(value: string): void {
    if (outputFull) return;
    if (outputChars + value.length > outputLimit) { process.stdout.write(value.slice(0, outputLimit - outputChars)); process.stdout.write('\n[输出达到 200000 字符上限，请缩小操作范围。]\n'); outputFull = true; return; }
    outputChars += value.length; process.stdout.write(value);
  }
  function label(value: string): string { return Array.from(value).some(character => { const point = character.codePointAt(0) ?? 32; return point < 32 || point === 127; }) ? JSON.stringify(value) : value; }
  function segments(value: string): string[] {
    if (!value || value.length > 1024 || path.posix.isAbsolute(value) || value.includes('\\') || value.includes('\0') || value.split('/').includes('..')) throw new Error('只允许工作目录内的相对路径。');
    const pieces = value.split('/').filter(piece => piece && piece !== '.');
    if (pieces.length > 64) throw new Error('路径层级过深。');
    return pieces;
  }
  function isMissing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
  function isExists(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'EEXIST'; }
  function regular(info: Stats): void { if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('只允许普通文件，不允许符号链接、硬链接或特殊文件。'); }
  try {
    if (process.platform !== 'linux') throw new Error('受限命令只能在 Linux Docker 执行环境中运行。');
    const raw: unknown = JSON.parse(Buffer.from(process.argv[1] ?? '', 'base64').toString('utf8'));
    if (!object(raw) || !object(raw['operation'])) throw new Error('命令请求格式错误。');
    const op = raw['operation']; const name = text(op['name']); const root = text(raw['root']); const networkEnabled = boolean(raw['networkEnabled']);
    if (!path.posix.isAbsolute(root) || await fs.realpath(root) !== root || !(await fs.lstat(root)).isDirectory()) throw new Error('工作目录无效。');
    const rootHandle = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(rootHandle);
    const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
    const directoryCache = new Map<string, Awaited<ReturnType<typeof fs.open>>>([['', rootHandle]]);
    function anchor(handle: Awaited<ReturnType<typeof fs.open>>): string { return `/proc/self/fd/${handle.fd}`; }
    async function directory(parts: readonly string[], create = false): Promise<Awaited<ReturnType<typeof fs.open>>> {
      let current = rootHandle; let prefix = '';
      for (const part of parts) {
        prefix = prefix ? `${prefix}/${part}` : part;
        const cached = directoryCache.get(prefix); if (cached) { current = cached; continue; }
        if (directoryCache.size >= 512) throw new Error('目录数量超过 512 个，请缩小范围。');
        checkWork(); const location = `${anchor(current)}/${part}`;
        if (create) { try { await fs.mkdir(location, { mode: 0o700 }); } catch (error) { if (!isExists(error)) throw error; } }
        const info = await fs.lstat(location); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('路径包含链接或非目录对象。');
        const opened = await fs.open(location, directoryFlags); handles.push(opened); directoryCache.set(prefix, opened); current = opened;
      }
      return current;
    }
    async function locate(relative: string): Promise<{ location: string; leaf: string; parent: Awaited<ReturnType<typeof fs.open>> }> {
      const parts = segments(relative); const leaf = parts.pop() ?? '.'; const parent = await directory(parts);
      return { location: leaf === '.' ? anchor(parent) : `${anchor(parent)}/${leaf}`, leaf, parent };
    }
    async function infoAt(relative: string): Promise<Stats> {
      const found = await locate(relative); const info = found.leaf === '.' ? await found.parent.stat() : await fs.lstat(found.location);
      if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile()) || (info.isFile() && info.nlink !== 1)) throw new Error('路径包含链接或特殊文件。'); return info;
    }
    async function openFile(relative: string, writing = false): Promise<Awaited<ReturnType<typeof fs.open>>> {
      const found = await locate(relative); if (found.leaf === '.') throw new Error('请指定普通文件。');
      const handle = await fs.open(found.location, (writing ? constants.O_WRONLY : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      handles.push(handle); regular(await handle.stat()); return handle;
    }
    async function read(relative: string): Promise<{ content: string; bytes: number }> {
      const handle = await openFile(relative); const info = await handle.stat(); if (info.size > readLimit) throw new Error('读取文件超过 1 MB，请先使用文件工具处理较大文件。');
      const buffer = Buffer.alloc(readLimit + 1); let offset = 0;
      while (offset <= readLimit) { checkWork(); const result = await handle.read(buffer, offset, buffer.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (offset > readLimit) throw new Error('读取文件超过 1 MB。'); return { content: buffer.subarray(0, offset).toString('utf8'), bytes: offset };
    }
    async function createFile(relative: string): Promise<{ handle: Awaited<ReturnType<typeof fs.open>>; location: string }> {
      const found = await locate(relative); if (found.leaf === '.') throw new Error('请指定新文件名。');
      const handle = await fs.open(found.location, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(handle);
      return { handle, location: found.location };
    }
    function glob(value: string, pattern: string): boolean {
      let index = 0; let part = 0; let star = -1; let matched = 0;
      while (index < value.length) { if (pattern[part] === '?' || pattern[part] === value[index]) { index++; part++; } else if (pattern[part] === '*') { star = part++; matched = index; } else if (star >= 0) { part = star + 1; index = ++matched; } else return false; }
      while (pattern[part] === '*') part++; return part === pattern.length;
    }
    async function walk(relative: string, depth: number, maxDepth: number, visit: (relative: string, info: Stats) => void): Promise<void> {
      checkWork(); if (++visited > 1000) throw new Error('遍历达到 1000 个路径上限，请缩小目录或深度。');
      const info = await infoAt(relative); visit(relative, info); if (!info.isDirectory() || depth >= maxDepth || outputFull) return;
      const handle = await directory(segments(relative));
      const names = await fs.readdir(anchor(handle)); if (names.length > 1000) throw new Error('目录包含超过 1000 项，请指定更小范围。');
      for (const entry of names.sort()) { const child = path.posix.join(relative, entry); const childInfo = await fs.lstat(`${anchor(handle)}/${entry}`); if (childInfo.isSymbolicLink() || !(childInfo.isDirectory() || childInfo.isFile()) || (childInfo.isFile() && childInfo.nlink !== 1)) continue; await walk(child, depth + 1, maxDepth, visit); if (outputFull) break; }
    }
    function publicIpv4(address: string): boolean {
      const parts = address.split('.').map(Number); if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
      const a = parts[0]; const b = parts[1]; const c = parts[2]; if (a === undefined || b === undefined || c === undefined) return false;
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
    }
    async function download(urlValue: string, output: string): Promise<void> {
      if (!networkEnabled) throw new Error('此执行环境未开启网络。');
      const url = new URL(urlValue); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('只允许无凭据的 HTTP(S) 下载地址。');
      if (url.hostname.includes(':')) throw new Error('受限下载当前只支持公共 IPv4 地址。');
      const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
      const resolved = /^[0-9.]+$/u.test(url.hostname) ? [url.hostname] : await resolver.resolve4(url.hostname);
      if (!resolved.length || resolved.some(item => !publicIpv4(item))) throw new Error('受限下载只允许公共 IPv4 地址，不允许本机或私网地址。');
      const address = resolved[0]; if (!address) throw new Error('下载地址无法解析。');
      let created: Awaited<ReturnType<typeof createFile>> | undefined; let response: IncomingMessage | undefined;
      try {
        created = await createFile(output);
        response = await new Promise<IncomingMessage>((resolve, reject) => {
          const options = { hostname: address, port: url.port || (url.protocol === 'https:' ? 443 : 80), method: 'GET', path: url.pathname + url.search, headers: { Host: url.host, 'User-Agent': 'Priestess-Restricted-Download/1', Accept: '*/*' }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) };
          const request = url.protocol === 'https:' ? https.request({ ...options, servername: url.hostname, rejectUnauthorized: true, checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(url.hostname, certificate) }, resolve) : http.request(options, resolve);
          request.once('error', reject); request.end();
        });
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) { response.destroy(); throw new Error('下载未返回成功状态。受限下载不跟随重定向，请提供最终文件地址。'); }
        const length = Number(response.headers['content-length'] ?? 0); if (length > transferLimit) { response.destroy(); throw new Error('下载文件超过 20 MiB 上限。'); }
        let bytes = 0;
        try {
          for await (const rawChunk of response) {
            checkWork(); const chunk: unknown = rawChunk; if (!(chunk instanceof Uint8Array)) throw new Error('下载内容格式无效。'); bytes += chunk.byteLength;
            if (bytes > transferLimit) throw new Error('下载文件超过 20 MiB 上限。');
            let offset = 0; while (offset < chunk.byteLength) { const written = await created.handle.write(chunk, offset, chunk.byteLength - offset); offset += written.bytesWritten; }
          }
        } finally { response.destroy(); }
        await created.handle.sync(); emit(`已下载 ${bytes} 字节到 ${label(output)}\n`);
      } catch (error) { if (created) throw new Error(`下载未完成。${error instanceof Error ? error.message : ''}目标路径未自动删除，请检查部分文件。`, { cause: error }); throw error; } finally { response?.destroy(); }
    }
    checkWork();
    switch (name) {
      case 'pwd': emit(root + '\n'); break;
      case 'ls': {
        const all = boolean(op['all']); const long = boolean(op['long']);
        for (const relative of strings(op['paths'])) { const info = await infoAt(relative); const values: { name: string; info: Stats }[] = [];
          if (info.isDirectory()) { const handle = await directory(segments(relative)); const names = await fs.readdir(anchor(handle)); if (names.length > 1000) throw new Error('目录包含超过 1000 项，请指定更小范围。'); for (const item of names.sort()) if (all || !item.startsWith('.')) values.push({ name: item, info: await fs.lstat(`${anchor(handle)}/${item}`) }); }
          else values.push({ name: relative, info });
          for (const item of values) emit(`${long ? `${item.info.isSymbolicLink() ? 'link' : item.info.isDirectory() ? 'dir' : item.info.isFile() ? 'file' : 'special'}\t${item.info.size}\t` : ''}${label(item.name)}${item.info.isSymbolicLink() ? ' [链接，不跟随]' : ''}\n`);
        } break;
      }
      case 'cat': case 'head': case 'tail': case 'wc': case 'grep': {
        for (const relative of strings(op['paths'])) { checkWork(); const data = await read(relative); const lines = data.content.split('\n'); if (lines.at(-1) === '') lines.pop();
          if (name === 'cat') emit(data.content);
          else if (name === 'head' || name === 'tail') { const count = integer(op['lines'], 1, 1000); emit((name === 'head' ? lines.slice(0, count) : lines.slice(-count)).join('\n') + '\n'); }
          else if (name === 'wc') { const mode = text(op['mode']); const countLines = (data.content.match(/\n/gu) ?? []).length; const words = data.content.trim() ? data.content.trim().split(/\s+/u).length : 0; const value = mode === 'lines' ? countLines : mode === 'words' ? words : mode === 'bytes' ? data.bytes : `${countLines}\t${words}\t${data.bytes}`; emit(`${value}\t${label(relative)}\n`); }
          else { const pattern = text(op['pattern']); if (!pattern || pattern.length > 1024) throw new Error('搜索文字长度无效。'); const ignoreCase = boolean(op['ignoreCase']); const numbers = boolean(op['lineNumbers']); const needle = ignoreCase ? pattern.toLowerCase() : pattern; lines.forEach((line, index) => { if ((ignoreCase ? line.toLowerCase() : line).includes(needle)) emit(`${label(relative)}:${numbers ? `${index + 1}:` : ''}${line}\n`); }); }
          if (outputFull) break;
        } break;
      }
      case 'find': {
        const relative = text(op['path']); const depth = integer(op['maxDepth'], 0, 10); const type = text(op['fileType']); const pattern = op['namePattern'] === null ? null : text(op['namePattern']); if (pattern !== null && pattern.length > 256) throw new Error('查找名称过长。');
        await walk(relative, 0, depth, (file, info) => { if ((type === 'any' || type === 'file' && info.isFile() || type === 'directory' && info.isDirectory()) && (pattern === null || glob(path.posix.basename(file), pattern))) emit(label(file) + '\n'); }); break;
      }
      case 'stat': for (const relative of strings(op['paths'])) { const info = await infoAt(relative); emit(`${label(relative)}\t${info.isDirectory() ? 'directory' : 'file'}\t${info.size} bytes\t${info.mtime.toISOString()}\n`); } break;
      case 'du': for (const relative of strings(op['paths'])) { let bytes = 0; await walk(relative, 0, 10, (_file, info) => { if (info.isFile()) bytes += info.size; }); emit(`${bytes} bytes\t${label(relative)}\n`); } break;
      case 'mkdir': for (const relative of strings(op['paths'])) { const parts = segments(relative); if (!parts.length) throw new Error('请指定新目录名。'); if (boolean(op['parents'])) await directory(parts, true); else { const found = await locate(relative); await fs.mkdir(found.location, { mode: 0o700 }); } emit(`已创建目录 ${label(relative)}\n`); } break;
      case 'touch': for (const relative of strings(op['paths'])) { let handle: Awaited<ReturnType<typeof fs.open>>; try { handle = await openFile(relative, true); } catch (error) { if (!isMissing(error)) throw error; handle = (await createFile(relative)).handle; } const now = new Date(); await handle.utimes(now, now); emit(`已更新 ${label(relative)}\n`); } break;
      case 'cp': case 'mv': {
        const source = text(op['source']); const target = text(op['target']); const sourceHandle = await openFile(source); const info = await sourceHandle.stat(); if (info.size > transferLimit) throw new Error('复制或移动文件超过 20 MiB 上限。');
        if (name === 'cp') { const destination = await createFile(target); try { const buffer = Buffer.alloc(64 * 1024); let total = 0; for (;;) { checkWork(); const readResult = await sourceHandle.read(buffer, 0, buffer.length, total); if (!readResult.bytesRead) break; total += readResult.bytesRead; if (total > transferLimit) throw new Error('复制文件超过 20 MiB 上限。'); let offset = 0; while (offset < readResult.bytesRead) { const result = await destination.handle.write(buffer, offset, readResult.bytesRead - offset); offset += result.bytesWritten; } } await destination.handle.sync(); } catch (error) { throw new Error(`复制未完成。${error instanceof Error ? error.message : ''}目标路径未自动删除，请检查部分文件。`, { cause: error }); } }
        else { const from = await locate(source); const to = await locate(target); if (to.leaf === '.') throw new Error('目标必须是新文件路径。'); await fs.link(from.location, to.location); try { const linked = await fs.lstat(to.location); const current = await fs.lstat(from.location); if (!linked.isFile() || linked.ino !== info.ino || linked.dev !== info.dev || current.ino !== info.ino || current.dev !== info.dev) throw new Error('源文件在操作期间发生变化。'); await fs.unlink(from.location); } catch (error) { throw new Error(`移动未完成。${error instanceof Error ? error.message : ''}目标路径未自动删除，请检查源文件和目标文件。`, { cause: error }); } }
        emit(`${name === 'cp' ? '已复制' : '已移动'} ${label(source)} → ${label(target)}\n`); break;
      }
      case 'curl': await download(text(op['url']), text(op['output'])); break;
      default: throw new Error('不支持此受限命令。');
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    const message = code === 'EEXIST' ? '目标已存在。请选择新文件名；受限命令不会覆盖文件。' : code === 'ELOOP' ? '路径包含符号链接，操作已拒绝。' : code === 'ENOENT' ? '路径不存在。请检查相对路径。' : error instanceof Error ? error.message : '受限命令执行失败。';
    process.stderr.write(`受限命令失败：${message}\n`); process.exitCode = 1;
  } finally { for (const handle of handles.reverse()) await handle.close().catch(() => undefined); }
}

/** tsx/esbuild may add harmless function-name helpers; embed them inside the emitted function. */
export function restrictedRunnerProgram(): string {
  const source = restrictedCommandMain.toString();
  const helpers = [...new Set([...source.matchAll(/\b(__name\d*)\s*\(/gu)].map(match => match[1]).filter((name): name is string => name !== undefined))];
  const position = source.indexOf('{');
  if (position < 0) throw new Error('Restricted runner source is unavailable');
  const definitions = helpers.map(name => `function ${name}(value){return value;}`).join('');
  return `(${source.slice(0, position + 1)}${definitions}${source.slice(position + 1)})()`;
}
export function quoteShellData(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
export function restrictedRunnerLaunch(operation: RestrictedCommand, root: string, networkEnabled: boolean): { executable: string; args: string[]; shellCommand: string } {
  const payload = Buffer.from(JSON.stringify({ operation: RestrictedCommandSchema.parse(operation), root, networkEnabled })).toString('base64');
  const args = ['-i', 'PATH=/usr/local/bin:/usr/bin:/bin', `HOME=${root}`, 'LANG=C.UTF-8', '/usr/local/bin/node', '--no-addons', '--disable-proto=throw', '--input-type=commonjs', '-e', restrictedRunnerProgram(), '--', payload];
  return { executable: '/usr/bin/env', args, shellCommand: ['/usr/bin/env', ...args].map(quoteShellData).join(' ') };
}
