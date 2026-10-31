import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'src/components/typescript');
const paths: readonly string[] = [
  resolve(root, 'src/api/typescript.ts'),
  resolve(root, 'src/views/TypescriptRuntimeView.vue'),
  resolve(root, 'src/composables/unsaved.ts'),
  resolve(root, 'src/utils/workflow-model.ts'),
  resolve(root, 'scripts/ts-strict-check.ts'),
  ...(await readdir(directory))
    .filter(name => name.endsWith('.vue') || name.endsWith('.ts'))
    .map(name => resolve(directory, name)),
];
const failures: string[] = [];
for (const path of paths) {
  const original = await readFile(path, 'utf8');
  const script = path.endsWith('.vue')
    ? original.match(/<script\s+setup\s+lang="ts">([\s\S]*?)<\/script>/)?.[1]
    : original;
  if (script === undefined) throw new Error(`Missing typed script: ${path}`);
  if (/@ts-(?:ignore|nocheck)/.test(script)) failures.push(`${path}: typecheck bypass directive`);
  const source = ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      failures.push(`${path}:${line}: forbidden unchecked type escape (${ts.SyntaxKind[node.kind]})`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`TypeScript workbench and build gate: ${paths.length} files checked; no any, assertions, non-null escapes, or typecheck bypasses.`);
