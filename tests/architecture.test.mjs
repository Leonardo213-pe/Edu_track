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
const source = path.resolve('apps/api/src');
function rootViolations(file, imports) {
  // The composition root may only wire module entry points (*.module) and public contracts, plus its own root files.
  return imports.filter(specifier => specifier.startsWith('.')).filter(specifier => {
    const target = path.relative(source, path.resolve(path.dirname(file), specifier)).split(path.sep);
    if (target.length === 1) return false;
    return !(target[0] === 'modules' && target.length === 3 && (target[2] === 'public' || target[2].endsWith('.module')));
  }).map(specifier => `composition root -> ${specifier}`);
}
test('the composition root only imports module entry points and public contracts', () => {
  const rootFiles = readdirSync(source).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts')).map(name => path.join(source, name));
  assert.ok(rootFiles.length >= 3);
  for (const file of rootFiles) assert.deepEqual(rootViolations(file, dependencies(file)), [], file);
  assert.ok(rootViolations(path.join(source, 'bootstrap.ts'), ['./modules/identity/infrastructure/http/identity-error.filter']).length);
  assert.deepEqual(rootViolations(path.join(source, 'bootstrap.ts'), ['./modules/identity/identity.module', './modules/enrollments/public', './config']), []);
});
function undeclared(file, imports, catalog) {
  const [moduleName] = path.relative(root, file).split(path.sep);
  return imports.filter(specifier => specifier.startsWith('.')).map(specifier => path.relative(root, path.resolve(path.dirname(file), specifier)).split(path.sep)[0])
    .filter(target => catalog.has(target) && target !== moduleName && !catalog.get(moduleName).includes(target)).map(target => `${moduleName} -> ${target} not declared in modules.json`);
}
test('real cross-module imports are declared synchronous dependencies in modules.json', () => {
  const catalog = new Map(JSON.parse(readFileSync('docs/modules.json', 'utf8')).map(module => [module.id, module.dependencies]));
  for (const file of files) assert.deepEqual(undeclared(file, dependencies(file), catalog), [], file);
  assert.ok(undeclared(path.join(root, 'enrollments/application/example.ts'), ['../../courses/public'], catalog).length, 'enrollments must not depend on courses');
});
const schemaText = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
const ownership = [...schemaText.matchAll(/model (\w+) \{[\s\S]*?@@schema\("(\w+)"\)/g)].map(([, model, schema]) => ({ delegate: model[0].toLowerCase() + model.slice(1), schema }));
function persistenceViolations(moduleName, file, text) {
  const errors = [];
  for (const { delegate, schema } of ownership) if (schema !== moduleName && new RegExp(`\\.${delegate}\\.(find\\w*|create\\w*|update\\w*|upsert|delete\\w*|count|aggregate|groupBy)\\b`).test(text)) errors.push(`${file}: uses ${delegate} owned by ${schema}`);
  const sql = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true); const templates = [];
  (function visit(node) {
    if (ts.isNoSubstitutionTemplateLiteral(node)) templates.push(node.text);
    if (ts.isTemplateExpression(node)) templates.push(node.head.text, ...node.templateSpans.map(span => span.literal.text));
    ts.forEachChild(node, visit);
  })(sql);
  for (const schema of new Set(ownership.map(item => item.schema))) if (schema !== moduleName && templates.some(part => new RegExp(`\\b"?${schema}"?\\.`).test(part))) errors.push(`${file}: raw SQL on schema ${schema}`);
  return errors;
}
test('persistence adapters only touch tables of their own module schema', () => {
  assert.ok(ownership.length >= 12, 'schema models must declare their owning schema');
  for (const file of files.filter(item => item.includes(`${path.sep}persistence${path.sep}`))) {
    const [moduleName] = path.relative(root, file).split(path.sep);
    assert.deepEqual(persistenceViolations(moduleName, file, readFileSync(file, 'utf8')), [], file);
  }
  assert.ok(persistenceViolations('identity', 'x.ts', 'await this.db.course.findMany({})').length);
  assert.ok(persistenceViolations('courses', 'x.ts', 'await tx.$queryRaw`SELECT * FROM identity.users`').length);
  assert.ok(persistenceViolations('enrollments', 'x.ts', 'await tx.$queryRaw`SELECT 1 FROM "courses".courses`').length);
  assert.deepEqual(persistenceViolations('identity', 'x.ts', 'await this.db.user.findMany({}); await tx.$queryRaw`SELECT * FROM identity.users`'), []);
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
