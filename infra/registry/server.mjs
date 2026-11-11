// SIMULADO: Registro Académico institucional de mentira para desarrollo y pruebas (CAR-09). NO forma parte del LMS.
// Expone un REST mínimo de solo lectura con estudiantes ficticios por sección (código + período) y un modo "caída"
// configurable para probar reintentos, fallos y alertas (EAC-06). Datos en memoria, sembrados desde sections.json.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT ?? 4010);
const apiKey = process.env.REGISTRY_API_KEY ?? '';
if (apiKey.length < 16) { console.error('REGISTRY_API_KEY (>= 16 chars) is required'); process.exit(1); }
const seed = JSON.parse(readFileSync(new URL(process.env.REGISTRY_SEED ?? './sections.json', import.meta.url), 'utf8'));
const sections = new Map(seed.sections.map(section => [key(section.code, section.period), section.students]));
/** up: normal; down: every data request answers 503; slow: answers after 8 s (timeouts). failNext: next N requests fail. */
let mode = ['up', 'down', 'slow'].includes(process.env.REGISTRY_MODE) ? process.env.REGISTRY_MODE : 'up';
let failNext = 0;
let requests = 0;

function key(code, period) { return `${String(code).trim().toUpperCase()}/${String(period).trim().toUpperCase()}`; }
function authorized(request) {
  const given = Buffer.from(String(request.headers['x-registry-key'] ?? '')); const expected = Buffer.from(apiKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Simulated': 'true' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw new Error('too large'); }
  return JSON.parse(raw || '{}');
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://registry');
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { status: mode === 'down' ? 'degraded' : 'ok', mode, simulated: true, failNext, requests, sections: sections.size });
    if (!authorized(request)) return send(response, 401, { error: 'UNAUTHORIZED' });
    // Simulator control (tests and demo only): change mode, inject failures or replace a section roster.
    if (request.method === 'PUT' && url.pathname === '/admin/mode') {
      const body = await readJson(request);
      if (body.mode !== undefined) { if (!['up', 'down', 'slow'].includes(body.mode)) return send(response, 400, { error: 'INVALID_MODE' }); mode = body.mode; }
      if (body.failNext !== undefined) { if (!Number.isInteger(body.failNext) || body.failNext < 0 || body.failNext > 100) return send(response, 400, { error: 'INVALID_FAIL_NEXT' }); failNext = body.failNext; }
      return send(response, 200, { mode, failNext, simulated: true });
    }
    const admin = url.pathname.match(/^\/admin\/sections\/([^/]+)\/([^/]+)$/);
    if (request.method === 'PUT' && admin) {
      const body = await readJson(request);
      if (!Array.isArray(body.students) || body.students.length > 5000 || body.students.some(student => typeof student?.email !== 'string')) return send(response, 400, { error: 'INVALID_STUDENTS' });
      sections.set(key(decodeURIComponent(admin[1]), decodeURIComponent(admin[2])), body.students.map(({ email, code, name }) => ({ email, code: code ?? null, name: name ?? null })));
      return send(response, 200, { updated: true, simulated: true });
    }
    const match = url.pathname.match(/^\/api\/v1\/sections\/([^/]+)\/([^/]+)\/students$/);
    if (request.method === 'GET' && match) {
      requests++;
      if (mode === 'down') return send(response, 503, { error: 'REGISTRY_DOWN', simulated: true });
      if (failNext > 0) { failNext--; return send(response, 503, { error: 'INJECTED_FAILURE', simulated: true }); }
      if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 8000));
      const students = sections.get(key(decodeURIComponent(match[1]), decodeURIComponent(match[2])));
      if (!students) return send(response, 404, { error: 'SECTION_NOT_FOUND' });
      return send(response, 200, { code: decodeURIComponent(match[1]).toUpperCase(), period: decodeURIComponent(match[2]).toUpperCase(), simulated: true, students });
    }
    return send(response, 404, { error: 'NOT_FOUND' });
  } catch { return send(response, 400, { error: 'BAD_REQUEST' }); }
});
server.listen(port, '0.0.0.0', () => console.log(`SIMULATED Academic Registry listening on ${port} (mode ${mode}, ${sections.size} sections)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
