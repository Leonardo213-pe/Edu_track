import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Profile } from './api';
import { courseApi, courseStates, openCourseFile, type CourseMaterial, type CourseUnit, type CourseView, type MaterialVersion } from './courses-api';
type Summary = Omit<CourseView, 'units' | 'reviews' | 'syllabus'> & { unitCount: number; sessionCount: number };
type Teacher = { id: string; displayName: string };
function Field({ label, name, value, long = false, required = true, max = 160 }: { label: string; name: string; value?: string; long?: boolean; required?: boolean; max?: number }) {
  const id = `academic-${name}`;
  return <label>{label}{long ? <textarea id={id} name={name} defaultValue={value} maxLength={max} required={required} rows={name === 'syllabus' ? 10 : 3} /> : <input id={id} name={name} defaultValue={value} maxLength={max} required={required} />}</label>;
}
function FieldsForm({ children, submit, button, busy, label }: { children: ReactNode; submit(data: FormData): Promise<void>; button: string; busy: boolean; label?: string }) {
  async function send(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await submit(new FormData(event.currentTarget)); }
  return <form onSubmit={send} aria-label={label}>{children}<button className="primary" disabled={busy} type="submit">{button}<span>→</span></button></form>;
}
function Progress({ value }: { value?: CourseView['progress'] }) { return value ? <div className="course-progress"><progress max={100} value={value.percentage} /><span>{value.percentage}% · {value.completed}/{value.total} materiales completados</span></div> : null; }

export function CoursesWorkspace({ token, profile, failed }: { token: string; profile: Profile; failed(error: unknown): void }) {
  const [courses, setCourses] = useState<Summary[]>([]); const [current, setCurrent] = useState<CourseView | null>(null); const [create, setCreate] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[]>([]); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(''); const [tab, setTab] = useState('content'); const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ url: string; version: MaterialVersion } | null>(null);
  const [activity, setActivity] = useState<{ userId: string; completed: number; total: number; percentage: number }[] | null>(null);
  const designer = profile.role === 'INSTRUCTIONAL_DESIGNER'; const student = profile.role === 'STUDENT'; const administrator = profile.role === 'ADMIN';
  const manager = !!current && (administrator || profile.role === 'TEACHER' && current.teacherId === profile.id);
  const editable = manager && current?.status === 'BORRADOR';
  async function load() {
    setLoading(true);
    try { setCourses(await courseApi<Summary[]>('', token)); if (administrator) setTeachers(await courseApi<Teacher[]>('/teachers', token)); }
    catch (error) { failed(error); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [token]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  async function open(id: string) { setBusy(true); try { setCurrent(await courseApi<CourseView>(`/${id}`, token)); setCreate(false); setTab('content'); setNotice(''); setActivity(null); } catch (error) { failed(error); } finally { setBusy(false); } }
  async function mutate(path: string, input: unknown, method?: 'PATCH') {
    setBusy(true); setNotice(''); try { setCurrent(await courseApi<CourseView>(path, token, input, method)); setNotice('Cambios guardados.'); await load(); } catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function newCourse(data: FormData) {
    setBusy(true); try { const course = await courseApi<CourseView>('', token, { ...Object.fromEntries(data), teacherId: administrator ? data.get('teacherId') : profile.id }); setCurrent(course); setCreate(false); setTab('settings'); await load(); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function transition(decision: string, observations = '') { if (current) await mutate(`/${current.id}/transitions`, { revision: current.revision, decision, observations }); }
  async function file(material: CourseMaterial, version: MaterialVersion, view = false) {
    if (!current) return; setBusy(true);
    try { const url = await openCourseFile(`/${current.id}/materials/${material.id}/versions/${version.id}/file`, token, version, view); if (url) setPreview({ url, version }); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function order(type: 'units' | 'sessions' | 'materials', parentId: string, items: { id: string }[], index: number, direction: number) {
    if (!current) return; const ids = items.map(item => item.id); const other = index + direction; if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!]; await mutate(`/${current.id}/order`, { revision: current.revision, type, parentId, ids });
  }
  function orderButtons(type: 'units' | 'sessions' | 'materials', parentId: string, items: { id: string }[], index: number) {
    return editable && <span className="order-buttons"><button className="quiet" disabled={busy || index === 0} aria-label={`Subir ${type} ${index + 1}`} onClick={() => order(type, parentId, items, index, -1)}>↑</button><button className="quiet" disabled={busy || index === items.length - 1} aria-label={`Bajar ${type} ${index + 1}`} onClick={() => order(type, parentId, items, index, 1)}>↓</button></span>;
  }
  function materialView(material: CourseMaterial, sessionId: string, index: number, siblings: CourseMaterial[]) {
    const latest = material.versions[material.versions.length - 1]!;
    return <article className="material-row" key={material.id}><div className="section-title"><div><span className="eyebrow">{latest.kind === 'FILE' ? latest.filename : latest.kind === 'VIDEO' ? 'VIDEO EXTERNO' : 'ENLACE'}</span><h4>{material.title}</h4><small>Versión {latest.number} · {latest.size ? `${(latest.size / 1024).toFixed(1)} KB` : 'Recurso externo'}</small></div>{orderButtons('materials', sessionId, siblings, index)}</div>
      <div className="material-actions">{latest.kind === 'FILE' ? <><button className="quiet" disabled={busy} onClick={() => file(material, latest)}>Descargar ↓</button>
        <button className="quiet" disabled={busy} onClick={() => file(material, latest, true)}>Visualizar ↗</button></> : <a className="text-button" href={latest.url!} target="_blank" rel="noopener noreferrer">Abrir recurso ↗</a>}
        {student && <button className="quiet" disabled={busy || current?.completedVersions?.includes(latest.id)} onClick={() => mutate(`/${current!.id}/materials/${material.id}/complete`, {})}>{current?.completedVersions?.includes(latest.id) ? '✓ Completado' : 'Marcar completado'}</button>}</div>
      {!student && <details><summary>Historial de versiones ({material.versions.length})</summary>{[...material.versions].reverse().map(version => <div className="history-row" key={version.id}><span>v{version.number} · {new Date(version.createdAt).toLocaleString('es-PE')} {version.id === latest.id ? '· Vigente' : ''}</span>
        {version.kind === 'FILE' ? <button className="quiet" onClick={() => file(material, version)}>Descargar {version.filename}</button> : <a href={version.url!} target="_blank" rel="noopener noreferrer">Abrir enlace</a>}</div>)}</details>}
      {editable && <details><summary>Crear una nueva versión</summary><MaterialForm busy={busy} title={material.title} submit={data => upload(data, sessionId, material.id)} /></details>}</article>;
  }
  async function upload(data: FormData, sessionId: string, materialId?: string) {
    if (!current) return; const kind = data.get('kind'); const body = new FormData(); body.set('revision', String(current.revision)); body.set('title', String(data.get('title'))); body.set('kind', String(kind));
    if (materialId) body.set('materialId', materialId); if (kind === 'FILE') { const file = data.get('file'); if (!(file instanceof File) || !file.size) { failed(new Error('Selecciona un archivo.')); return; } body.set('file', file); }
    else body.set('url', String(data.get('url'))); await mutate(`/${current.id}/sessions/${sessionId}/materials`, body);
  }
  function unitView(unit: CourseUnit, index: number) {
    return <section className="course-unit panel" key={unit.id}><div className="section-title"><div><span className="eyebrow">UNIDAD {index + 1}</span><h3>{unit.title}</h3></div>{orderButtons('units', current!.id, current!.units, index)}</div>
      {editable && <details><summary>Editar unidad</summary><FieldsForm busy={busy} button="Guardar unidad" submit={data => mutate(`/${current!.id}/units/${unit.id}`, { revision: current!.revision, title: data.get('title') }, 'PATCH')}><Field name={`title`} label="Nombre de unidad" value={unit.title} /></FieldsForm></details>}
      {unit.sessions.map((session, sessionIndex) => <section className="course-session" key={session.id}><div className="section-title"><h4>{index + 1}.{sessionIndex + 1} · {session.title}</h4>{orderButtons('sessions', unit.id, unit.sessions, sessionIndex)}</div><p className="muted preserve-text">{session.description}</p>
        {editable && <details><summary>Editar sesión</summary><FieldsForm busy={busy} button="Guardar sesión" submit={data => mutate(`/${current!.id}/sessions/${session.id}`, { revision: current!.revision, ...Object.fromEntries(data) }, 'PATCH')}><Field name="title" label="Nombre de sesión" value={session.title} /><Field name="description" label="Descripción de sesión" value={session.description} long required={false} max={5000} /></FieldsForm></details>}
        {session.materials.map((material, materialIndex) => materialView(material, session.id, materialIndex, session.materials))}
        {!session.materials.length && <p className="muted">Esta sesión aún no tiene materiales.</p>}
        {editable && <details><summary>+ Agregar material</summary><MaterialForm busy={busy} submit={data => upload(data, session.id)} /></details>}</section>)}
      {editable && <details><summary>+ Agregar sesión</summary><FieldsForm busy={busy} button="Crear sesión" submit={data => mutate(`/${current!.id}/units/${unit.id}/sessions`, { revision: current!.revision, ...Object.fromEntries(data) })}><Field name="title" label="Nombre de sesión" /><Field name="description" label="Descripción de sesión" long required={false} max={5000} /></FieldsForm></details>}</section>;
  }
  const title = student ? 'Mis cursos' : designer ? 'Revisión académica' : 'Gestión de cursos';
  return <section className="academic-space"><div className="section-title"><div><span className="eyebrow">ESPACIO ACADÉMICO</span><h2>{title}</h2></div><div className="inline-actions"><button className="quiet" disabled={busy} onClick={async () => { if (current) await open(current.id); else await load(); }}>Recargar ↻</button>
    {['ADMIN', 'TEACHER'].includes(profile.role) && <button className="small-primary" onClick={() => { setCurrent(null); setCreate(true); }}>+ Crear curso</button>}</div></div>
    {notice && <p className="success" role="status">{notice}</p>}
    {create && <section className="panel course-editor"><h3>Nuevo curso</h3><FieldsForm label="Crear curso" busy={busy} button="Crear borrador" submit={newCourse}><CourseFields teachers={teachers} administrator={administrator} /><button type="button" className="quiet" onClick={() => setCreate(false)}>Cancelar</button></FieldsForm></section>}
    {!current && !create && <><label className="course-search">Buscar cursos<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Nombre, código o estado" /></label>
      {loading ? <p role="status">Cargando cursos…</p> : <div className="course-grid">{courses.filter(course => `${course.name} ${course.code} ${courseStates[course.status]}`.toLowerCase().includes(filter.toLowerCase())).map(course => <article className="panel course-card" key={course.id}>
        <div className="section-title"><span className="eyebrow">{course.code} · {course.period}</span><span className={`course-badge ${course.status}`}>{courseStates[course.status]}</span></div><h3>{course.name}</h3><p className="muted">{course.description}</p><p className="course-owner">Docente: {course.teacherName}</p><small>{course.unitCount} unidades · {course.sessionCount} sesiones</small><Progress value={course.progress} />
        <button className="text-button" disabled={busy} onClick={() => open(course.id)}>{designer && course.status === 'EN_REVISION' ? 'Revisar curso →' : 'Abrir curso →'}</button></article>)}</div>}
      {!loading && !courses.length && <div className="panel empty-courses"><h3>Tu siguiente curso comienza aquí.</h3><p className="muted">{student ? 'Aún no hay cursos publicados disponibles para tu cuenta.' : 'No hay cursos disponibles. Los cursos pendientes aparecerán aquí.'}</p></div>}</>}
    {current && <><button className="text-button" onClick={() => { setCurrent(null); setActivity(null); }}>← Volver a cursos</button><section className="panel course-hero"><span className={`course-badge ${current.status}`}>{courseStates[current.status]}</span><span className="eyebrow">{current.code} · {current.period}</span><h2>{current.name}</h2><p>{current.description}</p><p className="muted">Docente responsable: {current.teacherName ?? current.teacherId} · Revisión {current.revision}</p><Progress value={current.progress} />
      <div className="material-actions">{manager && current.status === 'BORRADOR' && <button className="small-primary" disabled={busy} onClick={() => transition('SUBMITTED')}>Enviar a revisión</button>}
        {manager && current.status === 'PUBLICADO' && <button className="small-primary" disabled={busy} onClick={() => transition('REOPENED', 'Nueva revisión de contenido solicitada')}>Volver a borrador para editar</button>}
        {manager && ['BORRADOR', 'PUBLICADO'].includes(current.status) && <button className="quiet" disabled={busy} onClick={() => transition('ARCHIVED')}>Archivar curso</button>}</div>
      {manager && current.status === 'PUBLICADO' && <p className="muted">Para modificar contenido debes volver a Borrador. El curso dejará de estar disponible para estudiantes hasta su nueva aprobación.</p>}</section>
      <nav className="workspace-nav" aria-label="Detalle del curso">{[['content', 'Contenido'], ['syllabus', 'Sílabo'], ...(!student ? [['reviews', 'Historial de revisión']] : []), ...(editable ? [['settings', 'Editar curso']] : [])].map(([key, label]) => <button key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key!)}>{label}</button>)}</nav>
      {tab === 'content' && <>{current.units.map(unitView)}{!current.units.length && <p className="muted">Aún no hay unidades.</p>}{editable && <section className="panel"><h3>Nueva unidad</h3><FieldsForm label="Nueva unidad" busy={busy} button="Crear unidad" submit={data => mutate(`/${current.id}/units`, { revision: current.revision, title: data.get('title') })}><Field name="title" label="Nombre de la nueva unidad" /></FieldsForm></section>}</>}
      {tab === 'syllabus' && <section className="panel"><h3>Sílabo del curso</h3><p className="preserve-text">{current.syllabus || 'El sílabo aún no está registrado.'}</p>{editable && <FieldsForm key={current.revision} busy={busy} button="Guardar sílabo" submit={data => mutate(`/${current.id}`, { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: data.get('syllabus'), revision: current.revision }, 'PATCH')}><Field name="syllabus" label="Editar sílabo" value={current.syllabus} long max={50000} /></FieldsForm>}</section>}
      {tab === 'settings' && editable && <section className="panel course-editor"><h3>Datos del curso</h3><FieldsForm key={current.revision} busy={busy} button="Guardar curso" submit={data => mutate(`/${current.id}`, { ...Object.fromEntries(data), teacherId: administrator ? data.get('teacherId') : current.teacherId, syllabus: current.syllabus, revision: current.revision }, 'PATCH')}><CourseFields course={current} administrator={administrator} teachers={teachers} /></FieldsForm></section>}
      {tab === 'reviews' && !student && <section className="panel"><h3>Historial de revisión</h3>{!current.reviews.length && <p className="muted">Aún no hay decisiones de revisión.</p>}{[...current.reviews].reverse().map(review => <article key={review.id} className="review-entry"><strong>{{ SUBMITTED: 'Enviado a revisión', APPROVED: 'Aprobado y publicado', REJECTED: 'Rechazado', REOPENED: 'Devuelto a borrador', ARCHIVED: 'Archivado' }[review.decision]}</strong><small>{new Date(review.createdAt).toLocaleString('es-PE')} · revisión {review.revision}</small><p className="preserve-text">{review.observations || 'Sin observaciones adicionales.'}</p></article>)}</section>}
      {designer && current.status === 'EN_REVISION' && <section className="panel review-panel"><span className="eyebrow">CONTROL INSTRUCCIONAL</span><h3>Decisión de revisión</h3><p className="muted">Revisa el sílabo, las sesiones y los materiales antes de publicar.</p><FieldsForm busy={busy} button="Registrar decisión" submit={data => transition(String(data.get('decision')), String(data.get('observations')))}><label>Decisión<select name="decision" defaultValue="APPROVED"><option value="APPROVED">Aprobar y publicar</option><option value="REJECTED">Rechazar y devolver a borrador</option></select></label><Field name="observations" label="Observaciones de revisión (obligatorias si rechazas)" required={false} long max={5000} /></FieldsForm></section>}
      {manager && <section className="panel course-activity"><h3>Seguimiento de contenidos</h3><p className="muted">Estudiantes con actividad registrada. Este listado no representa la matrícula total.</p><button className="quiet" onClick={async () => { try { setActivity(await courseApi(`/${current.id}/progress`, token)); } catch (error) { failed(error); } }}>Consultar avance</button>{activity && <div className="table-scroll"><table><thead><tr><th>Estudiante (ID)</th><th>Materiales vigentes</th><th>Avance</th></tr></thead><tbody>{activity.map(row => <tr key={row.userId}><td><code>{row.userId}</code></td><td>{row.completed}/{row.total}</td><td>{row.percentage}%</td></tr>)}</tbody></table>{!activity.length && <p className="muted">Sin actividad registrada.</p>}</div>}</section>}
    </>}
    {preview && <section className="file-viewer panel" role="dialog" aria-modal="false" aria-label="Visor de material"><div className="section-title"><h3>{preview.version.filename}</h3><button className="quiet" onClick={() => setPreview(null)}>Cerrar visor ✕</button></div>
      {preview.version.mimeType?.startsWith('video/') ? <video src={preview.url} controls /> : ['application/pdf', 'text/plain'].includes(preview.version.mimeType ?? '') ? <iframe src={preview.url} title="Material académico" sandbox="allow-same-origin" /> : <p className="muted">Este formato se visualiza en una aplicación externa. Descarga el archivo para abrirlo.</p>}</section>}
  </section>;
}
function CourseFields({ course, teachers, administrator }: { course?: CourseView; teachers: Teacher[]; administrator: boolean }) {
  return <><div className="form-columns"><Field name="code" label="Código del curso" value={course?.code} max={40} /><Field name="period" label="Período académico" value={course?.period} max={40} /></div><Field name="name" label="Nombre del curso" value={course?.name} /><Field name="description" label="Descripción del curso" value={course?.description} long max={5000} />
    {administrator && <label>Docente responsable<select name="teacherId" defaultValue={course?.teacherId ?? ''} required><option value="" disabled>Selecciona un docente activo</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.displayName}</option>)}</select></label>}</>;
}
function MaterialForm({ submit, busy, title }: { submit(data: FormData): Promise<void>; busy: boolean; title?: string }) {
  const [kind, setKind] = useState('FILE');
  return <FieldsForm busy={busy} button={title ? 'Guardar nueva versión' : 'Agregar material'} submit={submit}><Field name="title" label="Título del material" value={title} /><label>Tipo de material<select name="kind" value={kind} onChange={event => setKind(event.target.value)}><option value="FILE">Archivo</option><option value="LINK">Enlace</option><option value="VIDEO">Video externo</option></select></label>
    {kind === 'FILE' ? <label>Archivo del material<input name="file" type="file" accept=".pdf,.docx,.pptx,.txt,.mp4,.webm" required /><small>PDF, DOCX, PPTX, TXT, MP4 o WebM. Máximo 25 MB.</small></label> : <label>URL del recurso<input name="url" type="url" required maxLength={2048} placeholder="https://…" /></label>}</FieldsForm>;
}
