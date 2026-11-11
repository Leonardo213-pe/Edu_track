import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Profile } from './api';
import {
  courseApi, courseStates, enrollmentApi, formatMinutes, openCourseFile,
  type CourseMaterial, type CourseSession, type CourseUnit, type CourseView, type HistoryEntry, type MaterialVersion, type Roster,
} from './courses-api';

type Summary = Omit<CourseView, 'units' | 'reviews' | 'syllabus'> & { unitCount: number; sessionCount: number };
type Teacher = { id: string; displayName: string };
type Activity = { userId: string; displayName: string; completed: number; total: number; percentage: number };
type StructureType = 'units' | 'sessions' | 'materials';

const decisions: Record<string, string> = {
  SUBMITTED: 'Enviado a revisión', APPROVED: 'Aprobado y publicado', REJECTED: 'Rechazado', REOPENED: 'Devuelto a borrador', ARCHIVED: 'Archivado',
};
const historyLabels: Record<string, string> = {
  COURSE_CREATED: 'Curso creado', METADATA_EDITED: 'Datos del curso editados', SYLLABUS_EDITED: 'Sílabo actualizado', TEACHER_ASSIGNED: 'Docente reasignado',
  UNIT_ADDED: 'Unidad agregada', UNIT_EDITED: 'Unidad editada', UNIT_REMOVED: 'Unidad eliminada', SESSION_ADDED: 'Sesión agregada', SESSION_EDITED: 'Sesión editada',
  SESSION_REMOVED: 'Sesión eliminada', MATERIAL_ADDED: 'Material agregado', MATERIAL_VERSION_ADDED: 'Nueva versión de material', MATERIAL_REMOVED: 'Material eliminado',
  STRUCTURE_REORDERED: 'Estructura reordenada', STATUS_CHANGED: 'Cambio de estado',
};
function historySummary(entry: HistoryEntry): string {
  const detail = entry.detail;
  if (entry.action === 'STATUS_CHANGED') return `${courseStates[detail.before as keyof typeof courseStates] ?? detail.before} → ${courseStates[detail.after as keyof typeof courseStates] ?? detail.after}`;
  if (entry.action === 'SYLLABUS_EDITED') return `${String(detail.before ?? '').length} → ${String(detail.after ?? '').length} caracteres`;
  if (entry.action === 'METADATA_EDITED' || entry.action === 'SESSION_EDITED') {
    return Object.entries(detail).filter(([key]) => key !== 'sessionId').map(([key, value]) => {
      const change = value as { before?: unknown; after?: unknown }; return `${key}: «${String(change.before)}» → «${String(change.after)}»`;
    }).join(' · ');
  }
  if (typeof detail.title === 'string') return `${detail.title}${typeof detail.number === 'number' ? ` · v${detail.number}` : ''}`;
  return '';
}

function Field({ label, name, value, long = false, required = true, max = 160 }: { label: string; name: string; value?: string; long?: boolean; required?: boolean; max?: number }) {
  const id = `academic-${name}`;
  return <label>{label}{long
    ? <textarea id={id} name={name} defaultValue={value} maxLength={max} required={required} rows={name === 'syllabus' ? 10 : 3} />
    : <input id={id} name={name} defaultValue={value} maxLength={max} required={required} />}</label>;
}
function DurationField({ value }: { value?: number }) {
  return <label>Duración de la sesión (minutos)<input name="durationMinutes" type="number" min={0} max={1440} step={1} defaultValue={value ?? 0} /></label>;
}
function FieldsForm({ children, submit, button, busy, label }: { children: ReactNode; submit(data: FormData): Promise<void>; button: string; busy: boolean; label?: string }) {
  async function send(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await submit(new FormData(event.currentTarget)); }
  return <form onSubmit={send} aria-label={label}>{children}<button className="primary" disabled={busy} type="submit">{button}<span>→</span></button></form>;
}
function Progress({ value }: { value?: CourseView['progress'] }) {
  return value ? <div className="course-progress"><progress max={100} value={value.percentage} /><span>{value.percentage}% · {value.completed}/{value.total} materiales completados</span></div> : null;
}
function sessionInput(data: FormData) {
  return { title: data.get('title'), description: data.get('description') ?? '', durationMinutes: Number(data.get('durationMinutes') ?? 0) };
}

export function CoursesWorkspace({ token, profile, failed }: { token: string; profile: Profile; failed(error: unknown): void }) {
  const [courses, setCourses] = useState<Summary[]>([]);
  const [current, setCurrent] = useState<CourseView | null>(null);
  const [create, setCreate] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('content');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ url: string; version: MaterialVersion } | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const designer = profile.role === 'INSTRUCTIONAL_DESIGNER';
  const student = profile.role === 'STUDENT';
  const administrator = profile.role === 'ADMIN';
  const manager = !!current && (administrator || profile.role === 'TEACHER' && current.teacherId === profile.id);
  const editable = manager && current?.status === 'BORRADOR';
  const removable = editable && !!current?.removable;

  async function load() {
    setLoading(true);
    try {
      setCourses(await courseApi<Summary[]>('', token));
      if (administrator) setTeachers(await courseApi<Teacher[]>('/teachers', token));
    } catch (error) { failed(error); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [token]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function open(id: string) {
    setBusy(true);
    try { setCurrent(await courseApi<CourseView>(`/${id}`, token)); setCreate(false); setTab('content'); setNotice(''); setActivity(null); setHistory(null); setRoster(null); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function mutate(path: string, input: unknown, method?: 'PATCH' | 'DELETE') {
    setBusy(true); setNotice('');
    try { setCurrent(await courseApi<CourseView>(path, token, input, method)); setHistory(null); setNotice('Cambios guardados.'); await load(); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function newCourse(data: FormData) {
    setBusy(true);
    try {
      const course = await courseApi<CourseView>('', token, { ...Object.fromEntries(data), teacherId: administrator ? data.get('teacherId') : profile.id });
      setCurrent(course); setCreate(false); setTab('settings'); await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function transition(decision: string, observations = '') {
    if (current) await mutate(`/${current.id}/transitions`, { revision: current.revision, decision, observations });
  }
  async function remove(type: StructureType, id: string, label: string) {
    if (!current || !window.confirm(`¿Eliminar ${label}? Esta acción solo es posible porque el curso nunca fue publicado.`)) return;
    const segment = type === 'units' ? 'units' : type === 'sessions' ? 'sessions' : 'materials';
    await mutate(`/${current.id}/${segment}/${id}?revision=${current.revision}`, undefined, 'DELETE');
  }
  async function file(material: CourseMaterial, version: MaterialVersion, view = false) {
    if (!current) return; setBusy(true);
    try {
      const url = await openCourseFile(`/${current.id}/materials/${material.id}/versions/${version.id}/file`, token, version, view);
      if (url) setPreview({ url, version });
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function order(type: StructureType, parentId: string, items: { id: string }[], index: number, direction: number) {
    if (!current) return;
    const ids = items.map(item => item.id); const other = index + direction; if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    await mutate(`/${current.id}/order`, { revision: current.revision, type, parentId, ids });
  }
  async function openTab(key: string) {
    setTab(key); if (!current) return;
    try {
      if (key === 'history') setHistory(await courseApi<HistoryEntry[]>(`/${current.id}/history`, token));
      if (key === 'enrollments') setRoster(await enrollmentApi<Roster>(`/courses/${current.id}`, token));
    } catch (error) { failed(error); }
  }
  async function synchronize(data: FormData) {
    if (!current) return; setBusy(true); setNotice('');
    const emails = String(data.get('emails') ?? '').split(/[\s,;]+/).map(email => email.trim()).filter(Boolean);
    try {
      const result = await enrollmentApi<Roster>(`/courses/${current.id}/roster`, token, { emails }); setRoster(result);
      setNotice(`Lista sincronizada: ${result.added} altas, ${result.removed} bajas, ${result.total} inscritos.`);
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  function orderButtons(type: StructureType, parentId: string, items: { id: string }[], index: number) {
    return editable && <span className="order-buttons">
      <button className="quiet" disabled={busy || index === 0} aria-label={`Subir ${type} ${index + 1}`} onClick={() => order(type, parentId, items, index, -1)}>↑</button>
      <button className="quiet" disabled={busy || index === items.length - 1} aria-label={`Bajar ${type} ${index + 1}`} onClick={() => order(type, parentId, items, index, 1)}>↓</button>
    </span>;
  }
  function removeButton(type: StructureType, id: string, label: string) {
    return removable && <button className="quiet danger" disabled={busy} onClick={() => remove(type, id, label)}>Eliminar {label}</button>;
  }
  async function upload(data: FormData, sessionId: string, materialId?: string) {
    if (!current) return;
    const kind = data.get('kind'); const body = new FormData();
    body.set('revision', String(current.revision)); body.set('title', String(data.get('title'))); body.set('kind', String(kind));
    if (materialId) body.set('materialId', materialId);
    if (kind === 'FILE') {
      const chosen = data.get('file');
      if (!(chosen instanceof File) || !chosen.size) { failed(new Error('Selecciona un archivo.')); return; }
      body.set('file', chosen);
    } else body.set('url', String(data.get('url')));
    await mutate(`/${current.id}/sessions/${sessionId}/materials`, body);
  }

  function materialView(material: CourseMaterial, sessionId: string, index: number, siblings: CourseMaterial[]) {
    const latest = material.versions[material.versions.length - 1]!;
    const done = current?.completedVersions?.includes(latest.id);
    return <article className="material-row" key={material.id}>
      <div className="section-title"><div>
        <span className="eyebrow">{latest.kind === 'FILE' ? latest.filename : latest.kind === 'VIDEO' ? 'VIDEO EXTERNO' : 'ENLACE'}</span>
        <h4>{material.title}</h4>
        <small>Versión {latest.number} · {latest.size ? `${(latest.size / 1024).toFixed(1)} KB` : 'Recurso externo'}</small>
      </div>{orderButtons('materials', sessionId, siblings, index)}</div>
      <div className="material-actions">
        {latest.kind === 'FILE'
          ? <><button className="quiet" disabled={busy} onClick={() => file(material, latest)}>Descargar ↓</button>
            <button className="quiet" disabled={busy} onClick={() => file(material, latest, true)}>Visualizar ↗</button></>
          : <a className="text-button" href={latest.url!} target="_blank" rel="noopener noreferrer">Abrir recurso ↗</a>}
        {student && <button className="quiet" disabled={busy || done} onClick={() => mutate(`/${current!.id}/materials/${material.id}/complete`, {})}>{done ? '✓ Completado' : 'Marcar completado'}</button>}
        {removeButton('materials', material.id, 'material')}
      </div>
      {!student && <details><summary>Historial de versiones ({material.versions.length})</summary>{[...material.versions].reverse().map(version =>
        <div className="history-row" key={version.id}>
          <span>v{version.number} · {new Date(version.createdAt).toLocaleString('es-PE')} {version.id === latest.id ? '· Vigente' : ''}</span>
          {version.kind === 'FILE' ? <button className="quiet" onClick={() => file(material, version)}>Descargar {version.filename}</button> : <a href={version.url!} target="_blank" rel="noopener noreferrer">Abrir enlace</a>}
        </div>)}</details>}
      {editable && <details><summary>Crear una nueva versión</summary><MaterialForm busy={busy} title={material.title} submit={data => upload(data, sessionId, material.id)} /></details>}
    </article>;
  }
  function sessionView(unit: CourseUnit, unitIndex: number, session: CourseSession, sessionIndex: number) {
    return <section className="course-session" key={session.id}>
      <div className="section-title">
        <h4>{unitIndex + 1}.{sessionIndex + 1} · {session.title}</h4>{orderButtons('sessions', unit.id, unit.sessions, sessionIndex)}
      </div>
      <p className="muted">{formatMinutes(session.durationMinutes)}</p>
      <p className="muted preserve-text">{session.description}</p>
      {editable && <details><summary>Editar sesión</summary>
        <FieldsForm busy={busy} button="Guardar sesión" submit={data => mutate(`/${current!.id}/sessions/${session.id}`, { revision: current!.revision, ...sessionInput(data) }, 'PATCH')}>
          <Field name="title" label="Nombre de sesión" value={session.title} />
          <Field name="description" label="Descripción de sesión" value={session.description} long required={false} max={5000} />
          <DurationField value={session.durationMinutes} />
        </FieldsForm></details>}
      {removeButton('sessions', session.id, 'sesión')}
      {session.materials.map((material, materialIndex) => materialView(material, session.id, materialIndex, session.materials))}
      {!session.materials.length && <p className="muted">Esta sesión aún no tiene materiales.</p>}
      {editable && <details><summary>+ Agregar material</summary><MaterialForm busy={busy} submit={data => upload(data, session.id)} /></details>}
    </section>;
  }
  function unitView(unit: CourseUnit, index: number) {
    return <section className="course-unit panel" key={unit.id}>
      <div className="section-title"><div><span className="eyebrow">UNIDAD {index + 1}</span><h3>{unit.title}</h3></div>{orderButtons('units', current!.id, current!.units, index)}</div>
      {editable && <details><summary>Editar unidad</summary>
        <FieldsForm busy={busy} button="Guardar unidad" submit={data => mutate(`/${current!.id}/units/${unit.id}`, { revision: current!.revision, title: data.get('title') }, 'PATCH')}>
          <Field name="title" label="Nombre de unidad" value={unit.title} />
        </FieldsForm></details>}
      {removeButton('units', unit.id, 'unidad')}
      {unit.sessions.map((session, sessionIndex) => sessionView(unit, index, session, sessionIndex))}
      {editable && <details><summary>+ Agregar sesión</summary>
        <FieldsForm busy={busy} button="Crear sesión" submit={data => mutate(`/${current!.id}/units/${unit.id}/sessions`, { revision: current!.revision, ...sessionInput(data) })}>
          <Field name="title" label="Nombre de sesión" />
          <Field name="description" label="Descripción de sesión" long required={false} max={5000} />
          <DurationField />
        </FieldsForm></details>}
    </section>;
  }

  function courseList() {
    const visible = courses.filter(course => `${course.name} ${course.code} ${courseStates[course.status]}`.toLowerCase().includes(filter.toLowerCase()));
    return <>
      <label className="course-search">Buscar cursos<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Nombre, código o estado" /></label>
      {loading ? <p role="status">Cargando cursos…</p> : <div className="course-grid">{visible.map(course => <article className="panel course-card" key={course.id}>
        <div className="section-title"><span className="eyebrow">{course.code} · {course.period}</span><span className={`course-badge ${course.status}`}>{courseStates[course.status]}</span></div>
        <h3>{course.name}</h3><p className="muted">{course.description}</p><p className="course-owner">Docente: {course.teacherName}</p>
        <small>{course.unitCount} unidades · {course.sessionCount} sesiones · {formatMinutes(course.durationMinutes)}</small><Progress value={course.progress} />
        <button className="text-button" disabled={busy} onClick={() => open(course.id)}>{designer && course.status === 'EN_REVISION' ? 'Revisar curso →' : 'Abrir curso →'}</button>
      </article>)}</div>}
      {!loading && !courses.length && <div className="panel empty-courses"><h3>Tu siguiente curso comienza aquí.</h3>
        <p className="muted">{student ? 'Aún no estás inscrito en cursos publicados. La inscripción proviene del Registro Académico.' : 'No hay cursos disponibles. Los cursos pendientes aparecerán aquí.'}</p></div>}
    </>;
  }
  function historyPanel(course: CourseView) {
    return <section className="panel"><h3>Historial del curso</h3>
      <h4>Decisiones de revisión</h4>
      {!course.reviews.length && <p className="muted">Aún no hay decisiones de revisión.</p>}
      {[...course.reviews].reverse().map(review => <article key={review.id} className="review-entry">
        <strong>{decisions[review.decision] ?? review.decision}</strong><small>{new Date(review.createdAt).toLocaleString('es-PE')} · revisión {review.revision}</small>
        <p className="preserve-text">{review.observations || 'Sin observaciones adicionales.'}</p></article>)}
      <h4>Cambios registrados</h4>
      {!history ? <p role="status">Cargando historial…</p> : !history.length ? <p className="muted">Sin cambios registrados.</p>
        : <div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Cambio</th><th>Detalle</th><th>Responsable</th></tr></thead><tbody>
          {[...history].reverse().map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('es-PE')}</td><td>{historyLabels[entry.action] ?? entry.action}</td>
            <td>{historySummary(entry)}</td><td>{entry.actorName}</td></tr>)}</tbody></table></div>}
    </section>;
  }
  function enrollmentPanel(course: CourseView) {
    return <section className="panel"><h3>Estudiantes inscritos</h3>
      <p className="muted">Pega la lista oficial de inscritos del Registro Académico (un correo por línea). La lista reemplaza la anterior: se registran altas y bajas. EduTrack no crea matrículas propias.</p>
      {!roster ? <p role="status">Cargando inscritos…</p> : <>
        <FieldsForm key={roster.runs[0]?.id ?? 'empty'} label="Lista oficial de inscritos" busy={busy} button="Sincronizar lista oficial" submit={synchronize}>
          <label>Correos de estudiantes inscritos<textarea name="emails" rows={6} defaultValue={roster.students.map(item => item.email).filter(Boolean).join('\n')} /></label>
        </FieldsForm>
        <p className="muted">{roster.students.length} estudiantes inscritos en {course.code}.</p>
        {!!roster.students.length && <div className="table-scroll"><table><thead><tr><th>Estudiante</th><th>Correo</th></tr></thead><tbody>
          {roster.students.map(item => <tr key={item.id}><td>{item.displayName}</td><td>{item.email}</td></tr>)}</tbody></table></div>}
        {!!roster.runs.length && <details><summary>Sincronizaciones anteriores ({roster.runs.length})</summary>{roster.runs.map(run =>
          <div className="history-row" key={run.id}><span>{new Date(run.occurredAt).toLocaleString('es-PE')}</span><span>{run.added} altas · {run.removed} bajas · {run.total} inscritos</span></div>)}</details>}
      </>}
    </section>;
  }
  function courseDetail(course: CourseView) {
    const tabs: [string, string][] = [['content', 'Contenido'], ['syllabus', 'Sílabo'],
      ...(!student ? [['history', 'Historial'] as [string, string]] : []),
      ...(administrator ? [['enrollments', 'Inscritos'] as [string, string]] : []),
      ...(editable ? [['settings', 'Editar curso'] as [string, string]] : [])];
    return <>
      <button className="text-button" onClick={() => { setCurrent(null); setActivity(null); }}>← Volver a cursos</button>
      <section className="panel course-hero">
        <span className={`course-badge ${course.status}`}>{courseStates[course.status]}</span><span className="eyebrow">{course.code} · {course.period}</span>
        <h2>{course.name}</h2><p>{course.description}</p>
        <p className="muted">Docente responsable: {course.teacherName ?? course.teacherId} · Duración total: {formatMinutes(course.durationMinutes)}{!student && ` · Revisión ${course.revision}`}</p>
        <Progress value={course.progress} />
        <div className="material-actions">
          {manager && course.status === 'BORRADOR' && <button className="small-primary" disabled={busy} onClick={() => transition('SUBMITTED')}>Enviar a revisión</button>}
          {manager && course.status === 'PUBLICADO' && <button className="small-primary" disabled={busy} onClick={() => transition('REOPENED', 'Nueva revisión de contenido solicitada')}>Volver a borrador para editar</button>}
          {manager && ['BORRADOR', 'PUBLICADO'].includes(course.status) && <button className="quiet" disabled={busy} onClick={() => { if (window.confirm('¿Archivar el curso? El archivado es definitivo.')) void transition('ARCHIVED'); }}>Archivar curso</button>}
        </div>
        {manager && course.status === 'PUBLICADO' && <p className="muted">Para modificar contenido debes volver a Borrador. El curso dejará de estar disponible para estudiantes hasta su nueva aprobación.</p>}
        {editable && !course.removable && <p className="muted">Este curso ya fue publicado: su estructura se conserva y solo puede ampliarse o versionarse.</p>}
      </section>
      <nav className="workspace-nav" aria-label="Detalle del curso">{tabs.map(([key, label]) =>
        <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => void openTab(key)}>{label}</button>)}</nav>
      {tab === 'content' && <>
        {course.units.map(unitView)}{!course.units.length && <p className="muted">Aún no hay unidades.</p>}
        {editable && <section className="panel"><h3>Nueva unidad</h3>
          <FieldsForm label="Nueva unidad" busy={busy} button="Crear unidad" submit={data => mutate(`/${course.id}/units`, { revision: course.revision, title: data.get('title') })}>
            <Field name="title" label="Nombre de la nueva unidad" />
          </FieldsForm></section>}
      </>}
      {tab === 'syllabus' && <section className="panel"><h3>Sílabo del curso</h3><p className="preserve-text">{course.syllabus || 'El sílabo aún no está registrado.'}</p>
        {editable && <FieldsForm key={course.revision} busy={busy} button="Guardar sílabo" submit={data => mutate(`/${course.id}`, { code: course.code, name: course.name, description: course.description,
          period: course.period, teacherId: course.teacherId, syllabus: data.get('syllabus'), revision: course.revision }, 'PATCH')}>
          <Field name="syllabus" label="Editar sílabo" value={course.syllabus} long max={50000} />
        </FieldsForm>}</section>}
      {tab === 'settings' && editable && <section className="panel course-editor"><h3>Datos del curso</h3>
        <FieldsForm key={course.revision} busy={busy} button="Guardar curso" submit={data => mutate(`/${course.id}`, { ...Object.fromEntries(data),
          teacherId: administrator ? data.get('teacherId') : course.teacherId, syllabus: course.syllabus, revision: course.revision }, 'PATCH')}>
          <CourseFields course={course} administrator={administrator} teachers={teachers} />
        </FieldsForm></section>}
      {tab === 'history' && !student && historyPanel(course)}
      {tab === 'enrollments' && administrator && enrollmentPanel(course)}
      {designer && course.status === 'EN_REVISION' && <section className="panel review-panel"><span className="eyebrow">CONTROL INSTRUCCIONAL</span><h3>Decisión de revisión</h3>
        <p className="muted">Revisa el sílabo, las sesiones y los materiales antes de publicar.</p>
        <FieldsForm busy={busy} button="Registrar decisión" submit={data => transition(String(data.get('decision')), String(data.get('observations')))}>
          <label>Decisión<select name="decision" defaultValue="APPROVED"><option value="APPROVED">Aprobar y publicar</option><option value="REJECTED">Rechazar y devolver a borrador</option></select></label>
          <Field name="observations" label="Observaciones de revisión (obligatorias si rechazas)" required={false} long max={5000} />
        </FieldsForm></section>}
      {manager && <section className="panel course-activity"><h3>Seguimiento de contenidos</h3>
        <p className="muted">Avance de los estudiantes con actividad registrada sobre las versiones vigentes.</p>
        <button className="quiet" onClick={async () => { try { setActivity(await courseApi<Activity[]>(`/${course.id}/progress`, token)); } catch (error) { failed(error); } }}>Consultar avance</button>
        {activity && <div className="table-scroll"><table><thead><tr><th>Estudiante</th><th>Materiales vigentes</th><th>Avance</th></tr></thead><tbody>
          {activity.map(row => <tr key={row.userId}><td>{row.displayName}</td><td>{row.completed}/{row.total}</td><td>{row.percentage}%</td></tr>)}</tbody></table>
          {!activity.length && <p className="muted">Sin actividad registrada.</p>}</div>}
      </section>}
    </>;
  }

  const title = student ? 'Mis cursos' : designer ? 'Revisión académica' : 'Gestión de cursos';
  return <section className="academic-space">
    <div className="section-title"><div><span className="eyebrow">ESPACIO ACADÉMICO</span><h2>{title}</h2></div>
      <div className="inline-actions">
        <button className="quiet" disabled={busy} onClick={async () => { if (current) await open(current.id); else await load(); }}>Recargar ↻</button>
        {['ADMIN', 'TEACHER'].includes(profile.role) && <button className="small-primary" onClick={() => { setCurrent(null); setCreate(true); }}>+ Crear curso</button>}
      </div></div>
    {notice && <p className="success" role="status">{notice}</p>}
    {create && <section className="panel course-editor"><h3>Nuevo curso</h3>
      <FieldsForm label="Crear curso" busy={busy} button="Crear borrador" submit={newCourse}>
        <CourseFields teachers={teachers} administrator={administrator} /><button type="button" className="quiet" onClick={() => setCreate(false)}>Cancelar</button>
      </FieldsForm></section>}
    {!current && !create && courseList()}
    {current && courseDetail(current)}
    {preview && <section className="file-viewer panel" role="dialog" aria-modal="false" aria-label="Visor de material">
      <div className="section-title"><h3>{preview.version.filename}</h3><button className="quiet" onClick={() => setPreview(null)}>Cerrar visor ✕</button></div>
      {preview.version.mimeType?.startsWith('video/') ? <video src={preview.url} controls />
        : ['application/pdf', 'text/plain'].includes(preview.version.mimeType ?? '') ? <iframe src={preview.url} title="Material académico" sandbox="allow-same-origin" />
        : <p className="muted">Este formato se visualiza en una aplicación externa. Descarga el archivo para abrirlo.</p>}
    </section>}
  </section>;
}
function CourseFields({ course, teachers, administrator }: { course?: CourseView; teachers: Teacher[]; administrator: boolean }) {
  return <>
    <div className="form-columns"><Field name="code" label="Código del curso" value={course?.code} max={40} /><Field name="period" label="Período académico" value={course?.period} max={40} /></div>
    <Field name="name" label="Nombre del curso" value={course?.name} /><Field name="description" label="Descripción del curso" value={course?.description} long max={5000} />
    {administrator && <label>Docente responsable<select name="teacherId" defaultValue={course?.teacherId ?? ''} required>
      <option value="" disabled>Selecciona un docente activo</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}
    </select></label>}
  </>;
}
function MaterialForm({ submit, busy, title }: { submit(data: FormData): Promise<void>; busy: boolean; title?: string }) {
  const [kind, setKind] = useState('FILE');
  return <FieldsForm busy={busy} button={title ? 'Guardar nueva versión' : 'Agregar material'} submit={submit}>
    <Field name="title" label="Título del material" value={title} />
    <label>Tipo de material<select name="kind" value={kind} onChange={event => setKind(event.target.value)}>
      <option value="FILE">Archivo</option><option value="LINK">Enlace</option><option value="VIDEO">Video externo</option></select></label>
    {kind === 'FILE'
      ? <label>Archivo del material<input name="file" type="file" accept=".pdf,.docx,.pptx,.txt,.mp4,.webm" required /><small>PDF, DOCX, PPTX, TXT, MP4 o WebM. Máximo 25 MB.</small></label>
      : <label>URL del recurso<input name="url" type="url" required maxLength={2048} placeholder="https://…" /></label>}
  </FieldsForm>;
}
