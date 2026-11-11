import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
const root = path.resolve('apps/api/src/modules');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? entry.name === 'generated' ? [] : walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
function dependencies(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      result.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) {
      assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), `${file}: dynamic dependency must be statically verifiable`);
      result.push(node.arguments[0].text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) result.push(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(source); return result;
}
function violations(file, imports) {
  const [moduleName, layer] = path.relative(root, file).split(path.sep);
  const errors = [];
  for (const specifier of imports) {
    const local = specifier.startsWith('.');
    const target = local ? path.resolve(path.dirname(file), specifier) : '';
    const [targetModule, targetLayer] = path.relative(root, target).split(path.sep);
    const allowed = layer === 'domain' ? ['domain', 'public'] : layer === 'application' ? ['domain', 'application', 'public'] : layer === 'public' ? ['public'] : null;
    if (allowed && (!local || targetModule !== moduleName || !allowed.includes(targetLayer))) errors.push(`${layer} -> ${specifier}`);
    if (local && target.startsWith(root + path.sep) && targetModule !== moduleName && targetLayer !== 'public') errors.push(`private module import: ${specifier}`);
    if (!local && (specifier.includes('prisma') || specifier === 'pg') && layer !== 'infrastructure') errors.push(`ORM outside adapter: ${specifier}`);
    if (local && layer === 'infrastructure' && targetModule === moduleName && target.includes(`${path.sep}http${path.sep}`) && file.includes(`${path.sep}persistence${path.sep}`)) errors.push(`outbound -> inbound: ${specifier}`);
  }
  return errors;
}
const files = walk(root).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'));
test('production imports respect module boundaries, hexagon and ORM isolation', () => {
  assert.ok(files.length > 10, 'Architecture check must inspect real production files');
  for (const file of files) assert.deepEqual(violations(file, dependencies(file)), [], file);
});
test('checker rejects representative forbidden dependencies', () => {
  for (const [file, imports] of [
    ['identity/domain/example.ts', ['@nestjs/common']], ['identity/application/example.ts', ['../infrastructure/repository']],
    ['identity/public/example.ts', ['../domain/user']], ['courses/infrastructure/example.ts', ['../../identity/domain/user']],
    ['courses/infrastructure/example.ts', ['../../identity/application/ports']], ['identity/application/example.ts', ['@prisma/client']],
  ]) assert.ok(violations(path.join(root, file), imports).length, `${file}: checker must reject ${imports}`);
  assert.deepEqual(violations(path.join(root, 'courses/infrastructure/example.ts'), ['../../identity/public']), []);
});
test('every planned business module has its own hexagon', () => {
  const modules = JSON.parse(readFileSync('docs/modules.json', 'utf8'));
  for (const module of modules) for (const layer of ['domain', 'application', 'infrastructure', 'public'])
    assert.ok(readdirSync(path.join(root, module.id, layer)), `${module.id}/${layer}`);
});
test('planned synchronous contract dependencies form an acyclic graph', () => {
  const modules = JSON.parse(readFileSync('docs/modules.json', 'utf8'));
  const catalog = new Map(modules.map(module => [module.id, module.dependencies]));
  const complete = new Set();
  function visit(id, stack = new Set()) {
    assert.ok(catalog.has(id), `Unknown module: ${id}`);
    assert.ok(!stack.has(id), `Dependency cycle through ${id}`);
    if (complete.has(id)) return;
    const next = new Set(stack); next.add(id);
    for (const dependency of catalog.get(id)) visit(dependency, next);
    complete.add(id);
  }
  for (const id of catalog.keys()) visit(id);
});
