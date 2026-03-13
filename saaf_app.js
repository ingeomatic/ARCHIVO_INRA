// =============================================
// SAAF — Sistema de Administración de Archivos
// Dirección General de Administración de Tierras Fiscales · INRA Bolivia
// saaf_app.js v2.0
// =============================================

// ─── CONFIGURACIÓN SUPABASE ───────────────────
// ⚠️ Reemplazar con sus credenciales de Supabase
const SUPABASE_URL = 'https://yygpninikdleotsblnku.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5Z3BuaW5pa2RsZW90c2Jsbmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNjQ5NzgsImV4cCI6MjA4ODk0MDk3OH0.gGCfRfIznHO6UK-CXU2r5rTsaiXrsZiyxEytP53z5jk';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── USUARIOS LOCALES (autenticación sin FK en BD) ──────────────
const USUARIOS_LOCALES = [
  { id: 1, username: 'NAYDA.ALANDIA', password: 'INRA1234', nombre_completo: 'Nayda Alandia', tipo_usuario: 'archivo', cargo: 'Responsable de Archivo Central' },
  { id: 2, username: 'ADRIANA.GOMEZ', password: 'INRA1234', nombre_completo: 'Adriana Gómez', tipo_usuario: 'archivo', cargo: 'Auxiliar de Archivo' },
  { id: 3, username: 'ROMULO.CORDERO', password: 'INRA1234', nombre_completo: 'Rómulo Cordero', tipo_usuario: 'activo', cargo: 'Técnico Jurídico' },
  { id: 4, username: 'VICTOR.CONDORI', password: 'INRA1234', nombre_completo: 'Víctor Condori', tipo_usuario: 'activo', cargo: 'Técnico en Tierras' },
];

// ─── ESTADO GLOBAL ────────────────────────────
let currentUser = null;
let pendientesInterval = null;
let inventarioTipoActual = 'solicitudes_dotacion';
let inventarioData = [];

// =============================================
// AUTENTICACIÓN
// =============================================

async function login(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim().toUpperCase();
  const password = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('show');

  const usuario = USUARIOS_LOCALES.find(u => u.username === username && u.password === password);
  if (!usuario) { errEl.classList.add('show'); return; }

  // Intentar sincronizar ID real con Supabase (sin bloquear si no hay conexión)
  try {
    const { data } = await db.from('usuarios').select('id').eq('username', username).single();
    if (data) usuario.id = data.id;
  } catch (_) { /* Sin conexión Supabase, usar ID local */ }

  currentUser = usuario;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';

  setupUI();
  cargarDashboard();
  actualizarBadgePendientes();
  pendientesInterval = setInterval(actualizarBadgePendientes, 30000);
}

function logout() {
  currentUser = null;
  if (pendientesInterval) clearInterval(pendientesInterval);
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
}

// =============================================
// UI POR ROL
// =============================================

function setupUI() {
  document.getElementById('header-nombre').textContent = currentUser.nombre_completo;
  const tipoEl = document.getElementById('header-tipo');
  tipoEl.textContent = currentUser.tipo_usuario === 'archivo' ? '🗂️ Personal de Archivo' : '👤 Personal Activo';
  tipoEl.className = 'tipo ' + currentUser.tipo_usuario;
  const avatarEl = document.getElementById('header-avatar');
  avatarEl.className = 'user-avatar ' + currentUser.tipo_usuario;
  avatarEl.textContent = currentUser.nombre_completo.charAt(0).toUpperCase();

  document.querySelectorAll('.tab-solo-archivo').forEach(t => t.style.display = currentUser.tipo_usuario === 'archivo' ? 'flex' : 'none');
  document.querySelectorAll('.tab-solo-activo').forEach(t => t.style.display = currentUser.tipo_usuario === 'activo' ? 'flex' : 'none');

  cambiarTab('dashboard');
}

function cambiarTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const tab = document.querySelector(`[data-tab="${tabId}"]`);
  const content = document.getElementById(`tab-${tabId}`);
  if (tab) tab.classList.add('active');
  if (content) content.classList.add('active');

  switch (tabId) {
    case 'dashboard': cargarDashboard(); break;
    case 'inventario': cargarInventario(); break;
    case 'solicitudes-archivo': cargarSolicitudesArchivo(); break;
    case 'nuevos-archivo': cargarNuevosParaArchivar(); break;
    case 'devoluciones': cargarDevoluciones(); break;
    case 'mis-prestamos': cargarMisPrestamos(); break;
    case 'nuevo-expediente': prepararNuevoExpediente(); break;
    case 'remisiones': cargarRemisiones(); break;
    case 'historial': cargarHistorial(); break;
    case 'reportes': setTimeout(iniciarReportes, 50); break;
  }
}

// =============================================
// DASHBOARD
// =============================================

async function cargarDashboard() {
  try {
    const tipos = ['solicitudes_dotacion', 'autorizadas', 'adjudicaciones', 'usufructos'];
    let totalDisp = 0, totalPrest = 0, totalExp = 0, totalRem = 0;

    for (const tipo of tipos) {
      const { data } = await db.from(tipo).select('estado_expediente');
      if (data) {
        totalExp += data.length;
        totalDisp += data.filter(e => e.estado_expediente === 'disponible').length;
        totalPrest += data.filter(e => e.estado_expediente === 'prestado').length;
        totalRem += data.filter(e => e.estado_expediente === 'remitido').length;
      }
    }

    const { count: cSalidas } = await db.from('movimientos')
      .select('*', { count: 'exact', head: true })
      .eq('estado_movimiento', 'pendiente')
      .eq('tipo_movimiento', 'solicitud_salida');
    const { count: cNuevos } = await db.from('movimientos')
      .select('*', { count: 'exact', head: true })
      .eq('estado_movimiento', 'pendiente')
      .eq('tipo_movimiento', 'ingreso_nuevo');
    const { count: cDevol } = await db.from('movimientos')
      .select('*', { count: 'exact', head: true })
      .eq('tipo_movimiento', 'solicitud_devolucion')
      .eq('estado_movimiento', 'en_prestamo');

    const totalPend = (cSalidas || 0) + (cNuevos || 0);

    document.getElementById('stat-total').textContent = totalExp;
    document.getElementById('stat-disponible').textContent = totalDisp;
    document.getElementById('stat-prestado').textContent = totalPrest;
    document.getElementById('stat-pendiente').textContent = totalPend;
    document.getElementById('stat-remitido').textContent = totalRem;

    await cargarActividadReciente();
  } catch (err) {
    console.error('Error dashboard:', err);
    document.getElementById('actividad-reciente').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><h4>Error de conexión</h4><p>Verifique la configuración de Supabase en saaf_app.js</p></div>';
  }
}

async function cargarActividadReciente() {
  const { data } = await db.from('movimientos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(8);

  const el = document.getElementById('actividad-reciente');
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><h4>Sin actividad reciente</h4></div>'; return;
  }

  const iconos = {
    solicitud_salida: '📤', salida: '🔓', solicitud_devolucion: '📥', devolucion: '✅',
    ingreso_nuevo: '📦', ingreso_nuevo_aceptado: '🗄️', remision: '📨'
  };
  const etiquetas = {
    solicitud_salida: 'Solicitud de salida', salida: 'Expediente entregado',
    solicitud_devolucion: 'Sol. devolución', devolucion: 'Expediente devuelto',
    ingreso_nuevo: 'Nuevo exp. enviado a archivo',
    ingreso_nuevo_aceptado: 'Nuevo exp. ingresado a archivo',
    remision: 'Expediente remitido'
  };

  el.innerHTML = data.map(m => `
    <div class="historial-item">
      <div class="historial-header">
        <span class="badge ${getBadgeMovimiento(m.tipo_movimiento)}">${iconos[m.tipo_movimiento] || '📌'} ${etiquetas[m.tipo_movimiento] || m.tipo_movimiento}</span>
        <span class="historial-fecha">${fmtFecha(m.created_at)}</span>
      </div>
      <div class="historial-body">
        <strong>${tipoLabel(m.tipo_expediente)}</strong> — Código: ${m.exp_codigo || m.expediente_id}
        ${m.exp_nombre ? ` — ${m.exp_nombre}` : ''}
        ${m.observaciones_salida ? `<br><span class="text-muted text-xs">${m.observaciones_salida.substring(0, 60)}</span>` : ''}
      </div>
    </div>`).join('');
}

function getBadgeMovimiento(tipo) {
  const map = {
    solicitud_salida: 'badge-pendiente', salida: 'badge-prestado',
    solicitud_devolucion: 'badge-pendiente', devolucion: 'badge-devuelto',
    ingreso_nuevo: 'badge-pendiente_archivo', ingreso_nuevo_aceptado: 'badge-disponible',
    remision: 'badge-remitido'
  };
  return map[tipo] || 'badge-disponible';
}

// =============================================
// INVENTARIO
// =============================================

async function cargarInventario(tipo = 'solicitudes_dotacion') {
  inventarioTipoActual = tipo;
  document.querySelectorAll('#tab-inventario .tipo-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tipo === tipo)
  );
  document.getElementById('inv-search').value = '';

  const tbody = document.getElementById('tabla-inventario-body');
  const headers = document.getElementById('tabla-inventario-headers');
  tbody.innerHTML = `<tr><td colspan="9"><div class="loading"><div class="spinner"></div> Cargando...</div></td></tr>`;

  const { data, error } = await db.from(tipo).select('*').order('id');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-rojo" style="padding:20px;">Error al cargar: ${error.message}</td></tr>`;
    return;
  }
  inventarioData = data || [];
  renderizarInventario(inventarioData, tipo);
}

function renderizarInventario(data, tipo) {
  const tbody = document.getElementById('tabla-inventario-body');
  const headers = document.getElementById('tabla-inventario-headers');

  const hMap = {
    solicitudes_dotacion: ['Código', 'Departamento', 'Municipio', 'Comunidad', 'Cuerpos', 'Fojas', 'Estado', 'Físico', 'Acciones'],
    autorizadas: ['Código', 'Departamento', 'Municipio', 'Comunidad', 'Cuerpos', 'Fojas', 'Estado', 'Físico', 'Acciones'],
    adjudicaciones: ['Código', 'Departamento', 'Municipio', 'Predio', 'Cuerpos', 'Fojas', 'Estado', 'Físico', 'Acciones'],
    usufructos: ['Código', 'Departamento', 'Municipio', 'Entidad', 'Proyecto', 'Cuerpos', 'Fojas', 'Estado', 'Acciones'],
  };
  headers.innerHTML = (hMap[tipo] || hMap['solicitudes_dotacion']).map(h => `<th>${h}</th>`).join('');

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📂</div><h4>Sin expedientes</h4></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(exp => {
    const estadoBadge = `<span class="badge badge-${exp.estado_expediente}">${estadoTexto(exp.estado_expediente)}</span>`;
    const fisicoBadge = exp.estado_fisico ? `<span class="badge badge-${exp.estado_fisico}">${exp.estado_fisico.toUpperCase()}</span>` : '—';

    let celdas = `<td><strong>${exp.codigo}</strong></td><td>${exp.departamento}</td><td>${exp.municipio || '—'}</td>`;
    if (tipo === 'solicitudes_dotacion' || tipo === 'autorizadas') {
      celdas += `<td>${exp.comunidad}</td><td>${exp.cuerpos}</td><td>${exp.numero_fojas}</td>`;
    } else if (tipo === 'adjudicaciones') {
      celdas += `<td>${exp.predio}</td><td>${exp.cuerpos}</td><td>${exp.numero_fojas}</td>`;
    } else if (tipo === 'usufructos') {
      const proj = exp.proyecto && exp.proyecto.length > 28 ? exp.proyecto.substring(0, 28) + '…' : (exp.proyecto || '—');
      celdas += `<td>${exp.entidad}</td><td title="${exp.proyecto}">${proj}</td><td>${exp.cuerpos}</td><td>${exp.numero_fojas}</td>`;
    }
    if (tipo !== 'usufructos') celdas += `<td>${estadoBadge}</td><td>${fisicoBadge}</td>`;
    else celdas += `<td>${estadoBadge}</td>`;

    // Acciones
    let acciones = `<button class="btn btn-sm btn-info" onclick="verDetalleExpediente('${tipo}',${exp.id})">👁️ Ver</button>`;

    if (currentUser.tipo_usuario === 'activo') {
      if (exp.estado_expediente === 'disponible')
        acciones += ` <button class="btn btn-sm btn-warning" onclick="solicitarExpediente('${tipo}',${exp.id})">📤 Solicitar</button>`;
    }

    if (currentUser.tipo_usuario === 'archivo') {
      if (exp.estado_expediente === 'disponible')
        acciones += ` <button class="btn btn-sm btn-remitir" onclick="abrirModalRemitir('${tipo}',${exp.id})">📨 Remitir</button>`;
    }

    return `<tr>${celdas}<td><div class="flex gap-1">${acciones}</div></td></tr>`;
  }).join('');
}

function estadoTexto(estado) {
  const map = {
    disponible: '✅ Disponible',
    prestado: '🔒 En Préstamo',
    reservado: '⏳ Reservado',
    pendiente_archivo: '📦 Pendiente Archivo',
    remitido: '📨 Remitido'
  };
  return map[estado] || estado;
}

function filtrarInventario(q) {
  if (!q) { renderizarInventario(inventarioData, inventarioTipoActual); return; }
  const lower = q.toLowerCase();
  renderizarInventario(
    inventarioData.filter(e => Object.values(e).some(v => String(v).toLowerCase().includes(lower))),
    inventarioTipoActual
  );
}

// =============================================
// DETALLE EXPEDIENTE + HISTORIAL
// =============================================

async function verDetalleExpediente(tipo, id) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', id).single();
  if (!exp) return;
  const { data: historial } = await db.from('movimientos')
    .select('*').eq('tipo_expediente', tipo).eq('expediente_id', id)
    .order('created_at', { ascending: false });
  const { data: rems } = await db.from('remisiones')
    .select('*').eq('tipo_expediente', tipo).eq('expediente_id', id)
    .order('created_at', { ascending: false });

  const nombre = getNombreExpediente(exp, tipo);
  const tLabel = { solicitudes_dotacion: 'Solicitud de Dotación', autorizadas: 'Autorizada', adjudicaciones: 'Adjudicación', usufructos: 'Usufructo' };

  let html = `
    <div class="detalle-grid">
      <div class="detalle-campo"><div class="label">Código</div><div class="valor">${exp.codigo}</div></div>
      <div class="detalle-campo"><div class="label">Tipo</div><div class="valor">${tLabel[tipo]}</div></div>
      <div class="detalle-campo"><div class="label">Departamento</div><div class="valor">${exp.departamento}</div></div>
      <div class="detalle-campo"><div class="label">Municipio</div><div class="valor">${exp.municipio || '—'}</div></div>
      ${tipo === 'solicitudes_dotacion' || tipo === 'autorizadas' ? `
        <div class="detalle-campo full"><div class="label">Comunidad</div><div class="valor">${exp.comunidad}</div></div>` : ''}
      ${tipo === 'adjudicaciones' ? `
        <div class="detalle-campo full"><div class="label">Predio</div><div class="valor">${exp.predio}</div></div>` : ''}
      ${tipo === 'usufructos' ? `
        <div class="detalle-campo"><div class="label">Entidad</div><div class="valor">${exp.entidad}</div></div>
        <div class="detalle-campo"><div class="label">Proyecto</div><div class="valor">${exp.proyecto}</div></div>` : ''}
      <div class="detalle-campo"><div class="label">Cuerpos</div><div class="valor">${exp.cuerpos}</div></div>
      <div class="detalle-campo"><div class="label">N° Fojas</div><div class="valor">${exp.numero_fojas}</div></div>
      <div class="detalle-campo"><div class="label">Estado</div><div class="valor"><span class="badge badge-${exp.estado_expediente}">${estadoTexto(exp.estado_expediente)}</span></div></div>
      <div class="detalle-campo"><div class="label">Estado Físico</div><div class="valor">${exp.estado_fisico ? `<span class="badge badge-${exp.estado_fisico}">${exp.estado_fisico.toUpperCase()}</span>` : '—'}</div></div>
    </div>`;

  // Historial de movimientos
  html += '<hr class="divider"><h4 style="font-family:Rajdhani,sans-serif;color:var(--verde-inra);margin-bottom:11px;">📋 Historial de Movimientos</h4>';

  if (!historial || historial.length === 0) {
    html += '<p class="text-muted text-sm">Sin movimientos registrados.</p>';
  } else {
    const etiqMov = {
      solicitud_salida: 'Solicitud de Salida', salida: 'Salida / Entregado',
      solicitud_devolucion: 'Sol. Devolución', devolucion: 'Devuelto a Archivo',
      ingreso_nuevo: 'Enviado como Nuevo', ingreso_nuevo_aceptado: 'Ingresado a Archivo',
      remision: 'Remisión'
    };
    html += historial.map(m => {
      let fechasHtml = '';
      if (m.fecha_solicitud) fechasHtml += `<div class="fecha-row">📅 <span class="fecha-label">Fecha solicitud/creación:</span> <strong>${fmtFecha(m.fecha_solicitud)}</strong></div>`;
      if (m.fecha_salida) fechasHtml += `<div class="fecha-row">🔓 <span class="fecha-label">Fecha salida/entrega:</span> <strong>${fmtFecha(m.fecha_salida)}</strong></div>`;
      if (m.fecha_devolucion) fechasHtml += `<div class="fecha-row">📥 <span class="fecha-label">Fecha devolución/ingreso:</span> <strong>${fmtFecha(m.fecha_devolucion)}</strong></div>`;

      let updateHtml = '';
      if (m.expediente_actualizado)
        updateHtml = `<div class="alerta-update mt-1"><span class="icon">⚠️</span><div class="texto">Actualización registrada: <strong>${m.cuerpos_anterior}→${m.cuerpos_nuevo} cuerpos</strong>, <strong>${m.fojas_anterior}→${m.fojas_nuevo} fojas</strong></div></div>`;

      return `
        <div class="historial-item">
          <div class="historial-header">
            <span class="badge ${getBadgeMovimiento(m.tipo_movimiento)}">${etiqMov[m.tipo_movimiento] || m.tipo_movimiento}</span>
            <span class="historial-fecha">${fmtFecha(m.created_at)}</span>
          </div>
          <div class="fechas-bloque mb-1">${fechasHtml}</div>
          <div class="historial-body">
            ${m.nombre_solicitante ? `👤 <strong>${m.nombre_solicitante}</strong>` : ''}
            ${m.nombre_personal_archivo ? ` → 🗂️ <strong>${m.nombre_personal_archivo}</strong>` : ''}
            ${m.estado_salida ? `<br>Condición salida: <span class="badge badge-${m.estado_salida}">${m.estado_salida}</span>` : ''}
            ${m.estado_devolucion ? `<br>Condición retorno: <span class="badge badge-${m.estado_devolucion}">${m.estado_devolucion}</span>` : ''}
            ${m.observaciones_salida ? `<br>📝 ${m.observaciones_salida}` : ''}
            ${m.observaciones_devolucion ? `<br>📝 Devolución: ${m.observaciones_devolucion}` : ''}
          </div>
          ${updateHtml}
        </div>`;
    }).join('');
  }

  // Remisiones del expediente
  if (rems && rems.length > 0) {
    html += '<hr class="divider"><h4 style="font-family:Rajdhani,sans-serif;color:var(--teal);margin-bottom:11px;">📨 Remisiones</h4>';
    html += rems.map(r => `
      <div class="historial-item" style="border-left:3px solid var(--teal);">
        <div class="historial-header">
          <span class="badge badge-remitido">📨 Remitido a: ${r.destino}</span>
          <span class="historial-fecha">${fmtFecha(r.fecha_remision)}</span>
        </div>
        <div class="fechas-bloque mb-1">
          ${r.hoja_ruta ? `<div class="fecha-row">📋 <span class="fecha-label">Hoja de Ruta:</span> <strong>${r.hoja_ruta}</strong></div>` : ''}
          ${r.nota_cite ? `<div class="fecha-row">📑 <span class="fecha-label">Nota CITE:</span> <strong>${r.nota_cite}</strong></div>` : ''}
        </div>
        <div class="historial-body">
          ${r.nombre_remitente ? `👤 Remitido por: <strong>${r.nombre_remitente}</strong><br>` : ''}
          ${r.motivo_salida ? `📝 ${r.motivo_salida}` : ''}
        </div>
      </div>`).join('');
  }

  abrirModal('modal-detalle', `📂 ${nombre} (${exp.codigo})`, html);
}

function getNombreExpediente(exp, tipo) {
  if (tipo === 'adjudicaciones') return exp.predio || '';
  if (tipo === 'usufructos') return exp.entidad || '';
  return exp.comunidad || '';
}

// =============================================
// SOLICITAR EXPEDIENTE (ACTIVO)
// =============================================

async function solicitarExpediente(tipo, id) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', id).single();
  if (!exp) return;

  const html = `
    <p class="mb-2">Está solicitando el expediente:</p>
    <div class="detalle-grid mb-2">
      <div class="detalle-campo"><div class="label">Código</div><div class="valor">${exp.codigo}</div></div>
      <div class="detalle-campo"><div class="label">Tipo</div><div class="valor">${tipoLabel(tipo)}</div></div>
      <div class="detalle-campo full"><div class="label">Nombre</div><div class="valor">${getNombreExpediente(exp, tipo)}</div></div>
      <div class="detalle-campo"><div class="label">Departamento</div><div class="valor">${exp.departamento}</div></div>
      <div class="detalle-campo"><div class="label">Municipio</div><div class="valor">${exp.municipio || '—'}</div></div>
      <div class="detalle-campo"><div class="label">Cuerpos</div><div class="valor">${exp.cuerpos}</div></div>
      <div class="detalle-campo"><div class="label">N° Fojas</div><div class="valor">${exp.numero_fojas}</div></div>
    </div>
    <div class="form-group"><label>Observaciones (opcional)</label>
      <textarea id="sol-obs" placeholder="Motivo de la solicitud, referencia, etc..."></textarea>
    </div>`;

  abrirModal('modal-accion', '📤 Solicitar Expediente', html,
    `<button class="btn btn-warning" onclick="confirmarSolicitud('${tipo}',${id})">✅ Confirmar Solicitud</button>`);
}

async function confirmarSolicitud(tipo, id) {
  const obs = document.getElementById('sol-obs').value.trim();
  const now = new Date().toISOString();

  const { error } = await db.from('movimientos').insert({
    tipo_expediente: tipo,
    expediente_id: id,
    exp_codigo: '', // se llenará abajo
    exp_nombre: '',
    tipo_movimiento: 'solicitud_salida',
    fecha_solicitud: now,
    nombre_solicitante: currentUser.nombre_completo,
    usuario_solicitante_id: currentUser.id,
    observaciones_salida: obs || null,
    estado_movimiento: 'pendiente'
  });

  if (error) { mostrarNotif('Error: ' + error.message, 'error'); return; }

  // Actualizar exp_codigo y exp_nombre en el movimiento recién insertado
  const { data: exp } = await db.from(tipo).select('codigo').eq('id', id).single();
  const { data: lastMov } = await db.from('movimientos')
    .select('id').eq('tipo_expediente', tipo).eq('expediente_id', id)
    .eq('tipo_movimiento', 'solicitud_salida').eq('estado_movimiento', 'pendiente')
    .order('created_at', { ascending: false }).limit(1).single();
  if (lastMov && exp) {
    await db.from('movimientos').update({
      exp_codigo: String(exp.codigo),
      exp_nombre: getNombreExpedienteById(tipo, id)
    }).eq('id', lastMov.id);
  }

  await db.from(tipo).update({ estado_expediente: 'reservado' }).eq('id', id);
  cerrarModal('modal-accion');
  mostrarNotif('Solicitud enviada al personal de archivo', 'success');
  cargarInventario(tipo);
  actualizarBadgePendientes();
}

// Helper para obtener nombre por id sin query extra (usamos el data ya cargado)
function getNombreExpedienteById(tipo, id) {
  const exp = inventarioData.find(e => e.id === id);
  return exp ? getNombreExpediente(exp, tipo) : '';
}

// =============================================
// SOLICITUDES DE SALIDA (ARCHIVO)
// =============================================

async function cargarSolicitudesArchivo() {
  const el = document.getElementById('lista-solicitudes-archivo');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  const { data } = await db.from('movimientos')
    .select('*')
    .eq('estado_movimiento', 'pendiente')
    .eq('tipo_movimiento', 'solicitud_salida')
    .order('created_at');

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h4>Sin solicitudes pendientes</h4><p>No hay expedientes esperando autorización de salida.</p></div>';
    return;
  }

  const items = await Promise.all(data.map(async m => {
    const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
    if (!exp) return '';
    return `
      <div class="historial-item">
        <div class="historial-header">
          <div class="flex gap-1 items-center">
            <span class="chip-tipo chip-${chipClass(m.tipo_expediente)}">${tipoLabel(m.tipo_expediente)}</span>
            <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, m.tipo_expediente)}
          </div>
        </div>
        <div class="fechas-bloque mb-1">
          <div class="fecha-row">📅 <span class="fecha-label">Fecha solicitud:</span> <strong>${fmtFecha(m.fecha_solicitud || m.created_at)}</strong></div>
        </div>
        <div class="historial-body mb-2">
          📌 ${exp.departamento}${exp.municipio ? ' · ' + exp.municipio : ''} · ${exp.cuerpos} cuerpos · ${exp.numero_fojas} fojas<br>
          👤 Solicitante: <strong>${m.nombre_solicitante || 'N/A'}</strong>
          ${m.observaciones_salida ? `<br>📝 Obs: ${m.observaciones_salida}` : ''}
        </div>
        <div class="flex gap-1">
          <button class="btn btn-success btn-sm" onclick="aprobarSalida(${m.id},'${m.tipo_expediente}',${m.expediente_id})">✅ Aprobar y Entregar</button>
          <button class="btn btn-danger btn-sm"  onclick="rechazarSolicitud(${m.id},'${m.tipo_expediente}',${m.expediente_id})">❌ Rechazar</button>
        </div>
      </div>`;
  }));
  el.innerHTML = items.join('');
}

async function aprobarSalida(movId, tipo, expId) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', expId).single();
  if (!exp) return;
  abrirModal('modal-accion', '✅ Confirmar Entrega al Solicitante', `
    <p class="mb-2">Entregando: <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, tipo)}</p>
    <div class="form-grid">
      <div class="form-group"><label>Estado físico al salir</label>
        <select id="estado-salida-ap">
          <option value="bueno">Bueno</option>
          <option value="regular">Regular</option>
          <option value="malo">Malo</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Observaciones de entrega (opcional)</label>
      <textarea id="obs-salida-ap" placeholder="Notas de la entrega..."></textarea>
    </div>`,
    `<button class="btn btn-success" onclick="confirmarEntrega(${movId},'${tipo}',${expId})">🔓 Confirmar Entrega</button>`);
}

async function confirmarEntrega(movId, tipo, expId) {
  const estado = document.getElementById('estado-salida-ap').value;
  const obs = document.getElementById('obs-salida-ap').value.trim();

  const { error: e1 } = await db.from('movimientos').update({
    tipo_movimiento: 'salida',
    fecha_salida: new Date().toISOString(),
    estado_salida: estado,
    observaciones_salida: obs || null,
    nombre_personal_archivo: currentUser.nombre_completo,
    estado_movimiento: 'en_prestamo'
  }).eq('id', movId);
  if (e1) { mostrarNotif('Error: ' + e1.message, 'error'); return; }

  const { error: e2 } = await db.from(tipo).update({ estado_expediente: 'prestado', estado_fisico: estado }).eq('id', expId);
  if (e2) { mostrarNotif('Error: ' + e2.message, 'error'); return; }

  cerrarModal('modal-accion');
  mostrarNotif('Expediente entregado correctamente', 'success');
  cargarSolicitudesArchivo();
  actualizarBadgePendientes();
}

async function rechazarSolicitud(movId, tipo, expId) {
  if (!confirm('¿Rechazar esta solicitud de salida?')) return;
  await db.from('movimientos').update({ estado_movimiento: 'cancelado' }).eq('id', movId);
  await db.from(tipo).update({ estado_expediente: 'disponible' }).eq('id', expId);
  mostrarNotif('Solicitud rechazada', 'warning');
  cargarSolicitudesArchivo();
  actualizarBadgePendientes();
}

// =============================================
// NUEVOS EXPEDIENTES → ARCHIVO
// =============================================

async function cargarNuevosParaArchivar() {
  const el = document.getElementById('lista-nuevos-archivo');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  const { data } = await db.from('movimientos')
    .select('*')
    .eq('tipo_movimiento', 'ingreso_nuevo')
    .eq('estado_movimiento', 'pendiente')
    .order('created_at');

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h4>Sin nuevos expedientes pendientes</h4><p>No hay expedientes esperando ingreso oficial al archivo.</p></div>';
    return;
  }

  const items = await Promise.all(data.map(async m => {
    const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
    if (!exp) return '';

    let camposExtra = '';
    if (m.tipo_expediente === 'solicitudes_dotacion' || m.tipo_expediente === 'autorizadas')
      camposExtra = `Comunidad: <strong>${exp.comunidad}</strong>`;
    else if (m.tipo_expediente === 'adjudicaciones')
      camposExtra = `Predio: <strong>${exp.predio}</strong>`;
    else if (m.tipo_expediente === 'usufructos')
      camposExtra = `Entidad: <strong>${exp.entidad}</strong> · Proyecto: <strong>${exp.proyecto}</strong>`;

    return `
      <div class="historial-item" style="border-left:3px solid var(--dorado);">
        <div class="historial-header">
          <div class="flex gap-1 items-center">
            <span class="chip-tipo chip-${chipClass(m.tipo_expediente)}">${tipoLabel(m.tipo_expediente)}</span>
            <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, m.tipo_expediente)}
          </div>
          <span class="badge badge-pendiente_archivo">📦 Nuevo — Pendiente Ingreso</span>
        </div>
        <div class="fechas-bloque mb-1">
          <div class="fecha-row">📅 <span class="fecha-label">Fecha de creación:</span> <strong>${fmtFecha(m.fecha_solicitud || m.created_at)}</strong></div>
        </div>
        <div class="historial-body mb-2">
          📌 ${exp.departamento}${exp.municipio ? ' · ' + exp.municipio : ''} · ${exp.cuerpos} cuerpos · ${exp.numero_fojas} fojas<br>
          ${camposExtra}<br>
          👤 Creado por: <strong>${m.nombre_solicitante || 'N/A'}</strong>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-success btn-sm" onclick="aceptarNuevoExpediente(${m.id},'${m.tipo_expediente}',${m.expediente_id})">🗄️ Verificar e Ingresar a Archivo</button>
          <button class="btn btn-danger btn-sm"  onclick="rechazarNuevoExpediente(${m.id},'${m.tipo_expediente}',${m.expediente_id})">❌ Rechazar</button>
        </div>
      </div>`;
  }));
  el.innerHTML = items.join('');
}

async function aceptarNuevoExpediente(movId, tipo, expId) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', expId).single();
  if (!exp) return;
  abrirModal('modal-accion', '🗄️ Ingresar Nuevo Expediente a Archivo', `
    <p class="mb-2">Verificando e ingresando al inventario oficial:</p>
    <div class="detalle-grid mb-2">
      <div class="detalle-campo"><div class="label">Código</div><div class="valor">${exp.codigo}</div></div>
      <div class="detalle-campo"><div class="label">Tipo</div><div class="valor">${tipoLabel(tipo)}</div></div>
      <div class="detalle-campo"><div class="label">Cuerpos</div><div class="valor">${exp.cuerpos}</div></div>
      <div class="detalle-campo"><div class="label">N° Fojas</div><div class="valor">${exp.numero_fojas}</div></div>
    </div>
    <div class="form-group"><label>Estado físico verificado</label>
      <select id="fisico-nuevo">
        <option value="bueno">Bueno</option>
        <option value="regular">Regular</option>
        <option value="malo">Malo</option>
      </select>
    </div>
    <div class="form-group"><label>Observaciones de ingreso</label>
      <textarea id="obs-ingreso" placeholder="Verificación realizada, notas al ingresar..."></textarea>
    </div>`,
    `<button class="btn btn-success" onclick="confirmarNuevoExpediente(${movId},'${tipo}',${expId})">✅ Confirmar Ingreso a Archivo</button>`);
}

async function confirmarNuevoExpediente(movId, tipo, expId) {
  const fisico = document.getElementById('fisico-nuevo').value;
  const obs = document.getElementById('obs-ingreso').value.trim();
  const now = new Date().toISOString();

  const { error: e1 } = await db.from('movimientos').update({
    tipo_movimiento: 'ingreso_nuevo_aceptado',
    fecha_devolucion: now,
    estado_movimiento: 'devuelto',
    observaciones_devolucion: obs || null,
    estado_salida: fisico,
    nombre_personal_archivo: currentUser.nombre_completo
  }).eq('id', movId);
  if (e1) { mostrarNotif('Error: ' + e1.message, 'error'); return; }

  const { error: e2 } = await db.from(tipo).update({ estado_expediente: 'disponible', estado_fisico: fisico }).eq('id', expId);
  if (e2) { mostrarNotif('Error: ' + e2.message, 'error'); return; }

  cerrarModal('modal-accion');
  mostrarNotif('Expediente ingresado al archivo. Ya disponible en inventario.', 'success');
  cargarNuevosParaArchivar();
  actualizarBadgePendientes();
}

async function rechazarNuevoExpediente(movId, tipo, expId) {
  if (!confirm('¿Rechazar este expediente? Se eliminará del inventario.')) return;
  await db.from('movimientos').update({ estado_movimiento: 'cancelado' }).eq('id', movId);
  await db.from(tipo).delete().eq('id', expId);
  mostrarNotif('Expediente rechazado y eliminado', 'warning');
  cargarNuevosParaArchivar();
  actualizarBadgePendientes();
}

// =============================================
// DEVOLUCIONES (ARCHIVO)
// =============================================

async function cargarDevoluciones() {
  const el = document.getElementById('lista-devoluciones');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  // Solicitudes de devolución recibidas
  const { data: solicDevol } = await db.from('movimientos')
    .select('*')
    .eq('tipo_movimiento', 'solicitud_devolucion')
    .eq('estado_movimiento', 'en_prestamo')
    .order('created_at', { ascending: false });

  // Préstamos activos que aún no solicitaron devolución
  const { data: prestamos } = await db.from('movimientos')
    .select('*')
    .eq('tipo_movimiento', 'salida')
    .eq('estado_movimiento', 'en_prestamo')
    .order('created_at', { ascending: false });

  if (!solicDevol?.length && !prestamos?.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📬</div><h4>Sin devoluciones pendientes</h4><p>No hay expedientes pendientes de devolución.</p></div>';
    return;
  }

  let html = '';
  if (solicDevol?.length) {
    html += '<h4 class="text-verde mb-2" style="font-family:Rajdhani,sans-serif;">📥 Solicitudes de Devolución Recibidas</h4>';
    html += (await Promise.all(solicDevol.map(m => renderItemDevolucion(m, true)))).join('');
  }
  if (prestamos?.length) {
    html += '<hr class="divider"><h4 class="text-verde mb-2" style="font-family:Rajdhani,sans-serif;">🔒 Expedientes en Préstamo Activo</h4>';
    html += (await Promise.all(prestamos.map(m => renderItemDevolucion(m, false)))).join('');
  }
  el.innerHTML = html;
}

async function renderItemDevolucion(m, esSolicitud) {
  const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
  if (!exp) return '';

  let updateAlert = '';
  if (esSolicitud && m.expediente_actualizado) {
    updateAlert = `
      <div class="alerta-update">
        <span class="icon">⚠️</span>
        <div class="texto"><strong>El Funcionario actualizó el expediente antes de devolver:</strong><br>
        Cuerpos: <strong>${m.cuerpos_anterior} → ${m.cuerpos_nuevo}</strong> &nbsp;|&nbsp;
        Fojas: <strong>${m.fojas_anterior} → ${m.fojas_nuevo}</strong><br>
        <small>Verifique físicamente el expediente antes de aceptar.</small></div>
      </div>`;
  }

  let fechasHtml = '';
  if (m.fecha_solicitud) fechasHtml += `<div class="fecha-row">📅 <span class="fecha-label">Fecha solicitud original:</span> <strong>${fmtFecha(m.fecha_solicitud)}</strong></div>`;
  if (m.fecha_salida) fechasHtml += `<div class="fecha-row">🔓 <span class="fecha-label">Fecha de salida:</span> <strong>${fmtFecha(m.fecha_salida)}</strong></div>`;

  const boton = esSolicitud
    ? `<button class="btn btn-success btn-sm" onclick="aceptarDevolucion(${m.id},'${m.tipo_expediente}',${m.expediente_id},${m.expediente_actualizado ? 'true' : 'false'},${m.cuerpos_nuevo || exp.cuerpos},${m.fojas_nuevo || exp.numero_fojas})">✅ Aceptar Devolución</button>
       <button class="btn btn-danger btn-sm" onclick="rechazarDevolucion(${m.id})">❌ Rechazar</button>`
    : `<span class="badge badge-prestado">🔒 Préstamo activo</span>`;

  return `
    <div class="historial-item">
      <div class="historial-header">
        <div class="flex gap-1 items-center">
          <span class="chip-tipo chip-${chipClass(m.tipo_expediente)}">${tipoLabel(m.tipo_expediente)}</span>
          <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, m.tipo_expediente)}
        </div>
        ${esSolicitud ? '<span class="badge badge-pendiente">📥 Devolución solicitada</span>' : ''}
      </div>
      ${updateAlert}
      <div class="fechas-bloque mb-1">${fechasHtml}</div>
      <div class="historial-body mb-2">
        📌 ${exp.departamento} · ${exp.cuerpos} cuerpos · ${exp.numero_fojas} fojas<br>
        👤 En poder de: <strong>${m.nombre_solicitante || 'N/A'}</strong>
        ${m.observaciones_devolucion ? `<br>📝 Obs devolución: ${m.observaciones_devolucion}` : ''}
        ${esSolicitud && m.estado_devolucion ? `<br>Condición al retorno: <span class="badge badge-${m.estado_devolucion}">${m.estado_devolucion}</span>` : ''}
      </div>
      <div class="flex gap-1">${boton}</div>
    </div>`;
}

async function aceptarDevolucion(movId, tipo, expId, actualizado, cuerposNuevo, fojasNuevo) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', expId).single();
  if (!exp) return;
  const alertaUpdate = actualizado
    ? `<div class="alerta-update mb-2"><span class="icon">⚠️</span><div class="texto"><strong>Actualización declarada:</strong><br>Cuerpos: <strong>${exp.cuerpos} → ${cuerposNuevo}</strong> · Fojas: <strong>${exp.numero_fojas} → ${fojasNuevo}</strong></div></div>` : '';

  abrirModal('modal-accion', '📥 Aceptar Devolución', `
    ${alertaUpdate}
    <p class="mb-2">Confirmando recepción de: <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, tipo)}</p>
    <div class="form-grid">
      <div class="form-group"><label>Estado físico al regresar</label>
        <select id="estado-dev">
          <option value="bueno">Bueno</option>
          <option value="regular">Regular</option>
          <option value="malo">Malo</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Observaciones de recepción (opcional)</label>
      <textarea id="obs-dev" placeholder="Notas al recibir el expediente..."></textarea>
    </div>`,
    `<button class="btn btn-success" onclick="confirmarDevolucion(${movId},'${tipo}',${expId},${actualizado},${cuerposNuevo},${fojasNuevo})">✅ Confirmar Recepción</button>`);
}

async function confirmarDevolucion(movId, tipo, expId, actualizado, cuerposNuevo, fojasNuevo) {
  const estado = document.getElementById('estado-dev').value;
  const obs = document.getElementById('obs-dev').value.trim();

  const { error: e1 } = await db.from('movimientos').update({
    tipo_movimiento: 'devolucion',
    fecha_devolucion: new Date().toISOString(),
    estado_devolucion: estado,
    observaciones_devolucion: obs || null,
    nombre_personal_archivo: currentUser.nombre_completo,
    estado_movimiento: 'devuelto'
  }).eq('id', movId);
  if (e1) { mostrarNotif('Error: ' + e1.message, 'error'); return; }

  const upd = { estado_expediente: 'disponible', estado_fisico: estado };
  if (actualizado) { upd.cuerpos = cuerposNuevo; upd.numero_fojas = fojasNuevo; }

  const { error: e2 } = await db.from(tipo).update(upd).eq('id', expId);
  if (e2) { mostrarNotif('Error: ' + e2.message, 'error'); return; }

  cerrarModal('modal-accion');
  mostrarNotif('Devolución registrada correctamente', 'success');
  cargarDevoluciones();
  actualizarBadgePendientes();
}

async function rechazarDevolucion(movId) {
  if (!confirm('¿Rechazar la devolución? El expediente permanecerá en préstamo.')) return;
  await db.from('movimientos').update({ tipo_movimiento: 'salida', estado_movimiento: 'en_prestamo' }).eq('id', movId);
  mostrarNotif('Devolución rechazada', 'warning');
  cargarDevoluciones();
}

// =============================================
// MIS PRÉSTAMOS (ACTIVO)
// =============================================

async function cargarMisPrestamos() {
  const el = document.getElementById('lista-mis-prestamos');
  el.innerHTML = '<div class="loading"><div class="spinner"></div> Cargando...</div>';

  // Filtramos por usuario_solicitante_id o por nombre_solicitante
  const { data } = await db.from('movimientos')
    .select('*')
    .eq('estado_movimiento', 'en_prestamo')
    .or(`usuario_solicitante_id.eq.${currentUser.id},nombre_solicitante.eq.${currentUser.nombre_completo}`)
    .order('created_at', { ascending: false });

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><h4>No tienes expedientes en préstamo</h4><p>Actualmente no tienes expedientes en tu poder.</p></div>';
    return;
  }

  const items = await Promise.all(data.map(async m => {
    const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
    if (!exp) return '';

    let fechasHtml = '';
    if (m.fecha_solicitud) fechasHtml += `<div class="fecha-row">📅 <span class="fecha-label">Solicitado:</span> <strong>${fmtFecha(m.fecha_solicitud)}</strong></div>`;
    if (m.fecha_salida) fechasHtml += `<div class="fecha-row">🔓 <span class="fecha-label">Entregado:</span> <strong>${fmtFecha(m.fecha_salida)}</strong></div>`;

    return `
      <div class="historial-item">
        <div class="historial-header">
          <div class="flex gap-1 items-center">
            <span class="chip-tipo chip-${chipClass(m.tipo_expediente)}">${tipoLabel(m.tipo_expediente)}</span>
            <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, m.tipo_expediente)}
          </div>
          <span class="badge badge-prestado">🔒 En mi poder</span>
        </div>
        <div class="fechas-bloque mb-1">${fechasHtml}</div>
        <div class="historial-body mb-2">
          📌 ${exp.departamento}${exp.municipio ? ' · ' + exp.municipio : ''} · ${exp.cuerpos} cuerpos · ${exp.numero_fojas} fojas
        </div>
        <div class="flex gap-1">
          <button class="btn btn-warning btn-sm" onclick="solicitarDevolucion(${m.id},'${m.tipo_expediente}',${m.expediente_id})">📥 Devolver</button>
          <button class="btn btn-secondary btn-sm" onclick="abrirActualizacion(${m.id},'${m.tipo_expediente}',${m.expediente_id},${exp.cuerpos},${exp.numero_fojas})">✏️ Actualizar Exp.</button>
          <button class="btn btn-remitir btn-sm" onclick="abrirModalRemitir('${m.tipo_expediente}',${m.expediente_id})">📨 Remitir</button>
        </div>
      </div>`;
  }));
  el.innerHTML = items.join('');
}

async function solicitarDevolucion(movId, tipo, expId) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', expId).single();
  if (!exp) return;
  abrirModal('modal-accion', '📥 Devolver Expediente', `
    <p class="mb-2">Devolviendo: <strong>Cód: ${exp.codigo}</strong> — ${getNombreExpediente(exp, tipo)}</p>
    <div class="form-grid">
      <div class="form-group"><label>Estado físico al devolver</label>
        <select id="estado-devol">
          <option value="bueno">Bueno</option>
          <option value="regular">Regular</option>
          <option value="malo">Malo</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Observaciones (opcional)</label>
      <textarea id="obs-devol" placeholder="Notas sobre la devolución..."></textarea>
    </div>`,
    `<button class="btn btn-warning" onclick="confirmarSolicitudDevolucion(${movId},'${tipo}',${expId})">📤 Enviar Devolución a Archivo</button>`);
}

async function confirmarSolicitudDevolucion(movId, tipo, expId) {
  const estado = document.getElementById('estado-devol').value;
  const obs = document.getElementById('obs-devol').value.trim();

  await db.from('movimientos').update({
    tipo_movimiento: 'solicitud_devolucion',
    estado_devolucion: estado,
    observaciones_devolucion: obs || null
  }).eq('id', movId);

  await db.from(tipo).update({ estado_expediente: 'reservado' }).eq('id', expId);
  cerrarModal('modal-accion');
  mostrarNotif('Devolución enviada a archivo para verificación', 'success');
  cargarMisPrestamos();
  actualizarBadgePendientes();
}

function abrirActualizacion(movId, tipo, expId, cuerposAct, fojasAct) {
  abrirModal('modal-accion', '✏️ Actualizar Datos del Expediente', `
    <p class="mb-2">Registre los cambios antes de devolver el expediente:</p>
    <div class="alerta-update mb-2">
      <span class="icon">📊</span>
      <div class="texto">Datos actuales: <strong>${cuerposAct} cuerpos</strong> y <strong>${fojasAct} fojas</strong></div>
    </div>
    <div class="form-grid">
      <div class="form-group"><label>Nuevos Cuerpos</label>
        <input type="number" id="cuerpos-new" value="${cuerposAct}" min="1">
      </div>
      <div class="form-group"><label>Nuevas Fojas</label>
        <input type="number" id="fojas-new" value="${fojasAct}" min="0">
      </div>
    </div>
    <div class="form-group"><label>Motivo de la actualización</label>
      <textarea id="obs-update" placeholder="Ej: Se arrimaron antecedentes adicionales al expediente..."></textarea>
    </div>`,
    `<button class="btn btn-warning" onclick="confirmarActualizacion(${movId},'${tipo}',${expId},${cuerposAct},${fojasAct})">💾 Guardar Actualización</button>`);
}

async function confirmarActualizacion(movId, tipo, expId, cuerposAnt, fojasAnt) {
  const cuerposNew = parseInt(document.getElementById('cuerpos-new').value);
  const fojasNew = parseInt(document.getElementById('fojas-new').value);
  const obs = document.getElementById('obs-update').value.trim();

  if (cuerposNew === cuerposAnt && fojasNew === fojasAnt) {
    mostrarNotif('No hay cambios en cuerpos ni fojas', 'warning'); return;
  }

  await db.from('movimientos').update({
    expediente_actualizado: true,
    cuerpos_anterior: cuerposAnt,
    cuerpos_nuevo: cuerposNew,
    fojas_anterior: fojasAnt,
    fojas_nuevo: fojasNew,
    observaciones_devolucion: obs || null
  }).eq('id', movId);

  cerrarModal('modal-accion');
  mostrarNotif(`Actualización registrada: ${cuerposAnt}→${cuerposNew} cuerpos, ${fojasAnt}→${fojasNew} fojas`, 'success');
  cargarMisPrestamos();
}

// =============================================
// NUEVO EXPEDIENTE (ACTIVO)
// =============================================

function prepararNuevoExpediente() {
  cambiarTipoNuevo('solicitudes_dotacion');
}

function cambiarTipoNuevo(tipo) {
  document.querySelectorAll('#tipo-tabs-nuevo .tipo-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tipo === tipo)
  );
  document.getElementById('campos-nuevo-exp').dataset.tipo = tipo;
  document.getElementById('campos-nuevo-exp').innerHTML = getCamposNuevo(tipo);
}

function getCamposNuevo(tipo) {
  const deptoOpts = ['Beni', 'Chuquisaca', 'Cochabamba', 'La Paz', 'Oruro', 'Pando', 'Potosí', 'Santa Cruz', 'Tarija']
    .map(d => `<option value="${d}">${d}</option>`).join('');

  const baseCampos = `
    <div class="form-grid">
      <div class="form-group">
        <label>Código ${tipo === 'autorizadas' ? '(Alfanumérico, ej: AUT-011/2024)' : '(Numérico)'}</label>
        <input type="${tipo === 'autorizadas' ? 'text' : 'number'}" id="nexp-codigo" placeholder="${tipo === 'autorizadas' ? 'Ej: AUT-011/2024' : 'Ej: 1011'}">
      </div>
      <div class="form-group"><label>Departamento</label>
        <select id="nexp-dep">${deptoOpts}</select>
      </div>
      <div class="form-group"><label>Municipio</label>
        <input type="text" id="nexp-municipio" placeholder="Ej: San Ignacio de Velasco" maxlength="500">
      </div>`;

  if (tipo === 'solicitudes_dotacion' || tipo === 'autorizadas') {
    return baseCampos + `
      <div class="form-group full"><label>Comunidad</label>
        <input type="text" id="nexp-comunidad" placeholder="Nombre de la comunidad" maxlength="500">
      </div>
      <div class="form-group"><label>Cuerpos</label>
        <input type="number" id="nexp-cuerpos" value="1" min="1">
      </div>
      <div class="form-group"><label>N° Fojas</label>
        <input type="number" id="nexp-fojas" value="0" min="0">
      </div>
      <div class="form-group"><label>Estado Físico</label>
        <select id="nexp-fisico"><option value="bueno">Bueno</option><option value="regular">Regular</option><option value="malo">Malo</option></select>
      </div>
    </div>`;
  } else if (tipo === 'adjudicaciones') {
    return baseCampos + `
      <div class="form-group full"><label>Predio</label>
        <input type="text" id="nexp-predio" placeholder="Nombre del predio" maxlength="500">
      </div>
      <div class="form-group"><label>Cuerpos</label>
        <input type="number" id="nexp-cuerpos" value="1" min="1">
      </div>
      <div class="form-group"><label>N° Fojas</label>
        <input type="number" id="nexp-fojas" value="0" min="0">
      </div>
      <div class="form-group"><label>Estado Físico</label>
        <select id="nexp-fisico"><option value="bueno">Bueno</option><option value="regular">Regular</option><option value="malo">Malo</option></select>
      </div>
    </div>`;
  } else { // usufructos
    return baseCampos + `
      <div class="form-group"><label>Entidad</label>
        <input type="text" id="nexp-entidad" placeholder="Nombre de la entidad" maxlength="500">
      </div>
      <div class="form-group full"><label>Proyecto</label>
        <input type="text" id="nexp-proyecto" placeholder="Nombre del proyecto" maxlength="500">
      </div>
      <div class="form-group"><label>Cuerpos</label>
        <input type="number" id="nexp-cuerpos" value="1" min="1">
      </div>
      <div class="form-group"><label>N° Fojas</label>
        <input type="number" id="nexp-fojas" value="0" min="0">
      </div>
      <div class="form-group"><label>Estado Físico</label>
        <select id="nexp-fisico"><option value="bueno">Bueno</option><option value="regular">Regular</option><option value="malo">Malo</option></select>
      </div>
    </div>`;
  }
}

async function guardarNuevoExpediente() {
  const tipoEl = document.getElementById('campos-nuevo-exp');
  const tipo = tipoEl.dataset.tipo;
  const codigo = document.getElementById('nexp-codigo')?.value.trim();
  const dep = document.getElementById('nexp-dep')?.value;
  const mun = document.getElementById('nexp-municipio')?.value.trim();
  const cuerpos = parseInt(document.getElementById('nexp-cuerpos')?.value) || 1;
  const fojas = parseInt(document.getElementById('nexp-fojas')?.value) || 0;
  const fisico = document.getElementById('nexp-fisico')?.value;

  if (!codigo) { mostrarNotif('El código es requerido', 'error'); return; }

  let row = {
    codigo: tipo === 'autorizadas' ? codigo : parseInt(codigo),
    departamento: dep,
    municipio: mun || null,
    cuerpos,
    numero_fojas: fojas,
    estado_fisico: fisico,
    estado_expediente: 'pendiente_archivo'
  };

  if (tipo === 'solicitudes_dotacion' || tipo === 'autorizadas') {
    row.comunidad = document.getElementById('nexp-comunidad')?.value.trim();
    if (!row.comunidad) { mostrarNotif('La comunidad es requerida', 'error'); return; }
  } else if (tipo === 'adjudicaciones') {
    row.predio = document.getElementById('nexp-predio')?.value.trim();
    if (!row.predio) { mostrarNotif('El predio es requerido', 'error'); return; }
  } else if (tipo === 'usufructos') {
    row.entidad = document.getElementById('nexp-entidad')?.value.trim();
    row.proyecto = document.getElementById('nexp-proyecto')?.value.trim();
    if (!row.entidad || !row.proyecto) { mostrarNotif('Entidad y Proyecto son requeridos', 'error'); return; }
  }

  const { data: expNuevo, error } = await db.from(tipo).insert(row).select().single();
  if (error) {
    if (error.code === '23505') mostrarNotif('El código ya existe en el sistema', 'error');
    else mostrarNotif('Error al guardar: ' + error.message, 'error');
    return;
  }

  const nombreExp = getNombreExpediente(expNuevo, tipo);
  await db.from('movimientos').insert({
    tipo_expediente: tipo,
    expediente_id: expNuevo.id,
    exp_codigo: String(expNuevo.codigo),
    exp_nombre: nombreExp,
    tipo_movimiento: 'ingreso_nuevo',
    fecha_solicitud: new Date().toISOString(),
    nombre_solicitante: currentUser.nombre_completo,
    usuario_solicitante_id: currentUser.id,
    estado_movimiento: 'pendiente',
    observaciones_salida: `Nuevo expediente registrado por ${currentUser.nombre_completo} — ${currentUser.cargo || ''}`
  });

  mostrarNotif('✅ Expediente creado y enviado a Archivo para su ingreso oficial.', 'success');
  actualizarBadgePendientes();

  // Limpiar formulario
  cambiarTipoNuevo(tipo);
}

// =============================================
// REMISIONES
// =============================================

const DESTINOS_REMISION = [
  'Dirección de Asuntos Jurídicos',
  'Dirección de Saneamiento',
  'Dirección de Catastro',
  'Unidad de Titulación',
  'Unidad de Auditoría',
  'Otro'
];

async function cargarRemisiones() {
  const tbody = document.getElementById('tabla-remisiones-body');
  tbody.innerHTML = `<tr><td colspan="9"><div class="loading"><div class="spinner"></div> Cargando...</div></td></tr>`;

  const { data, error } = await db.from('remisiones')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-rojo">Error: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">📭</div><h4>Sin remisiones registradas</h4></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td class="text-xs">${fmtFecha(r.fecha_remision || r.created_at)}</td>
      <td><span class="chip-tipo chip-${chipClass(r.tipo_expediente)}">${tipoLabel(r.tipo_expediente)}</span></td>
      <td><strong>${r.exp_codigo}</strong></td>
      <td>${r.exp_nombre || '—'}</td>
      <td><span class="badge badge-remitido">${r.destino}</span></td>
      <td class="text-xs">${r.hoja_ruta || '—'}</td>
      <td class="text-xs">${r.nota_cite || '—'}</td>
      <td class="text-xs">${r.nombre_remitente || '—'}</td>
      <td>
        <button class="btn btn-sm btn-info" onclick="verDetalleRemision(${r.id})">👁️ Ver</button>
      </td>
    </tr>`).join('');
}

async function verDetalleRemision(id) {
  const { data: r } = await db.from('remisiones').select('*').eq('id', id).single();
  if (!r) return;
  const html = `
    <div class="detalle-grid">
      <div class="detalle-campo"><div class="label">Tipo Expediente</div><div class="valor">${tipoLabel(r.tipo_expediente)}</div></div>
      <div class="detalle-campo"><div class="label">Código</div><div class="valor">${r.exp_codigo}</div></div>
      <div class="detalle-campo full"><div class="label">Nombre / Comunidad</div><div class="valor">${r.exp_nombre || '—'}</div></div>
      <div class="detalle-campo"><div class="label">Destino</div><div class="valor"><span class="badge badge-remitido">${r.destino}</span></div></div>
      <div class="detalle-campo"><div class="label">Fecha Remisión</div><div class="valor">${fmtFecha(r.fecha_remision)}</div></div>
      <div class="detalle-campo"><div class="label">Hoja de Ruta</div><div class="valor">${r.hoja_ruta || '—'}</div></div>
      <div class="detalle-campo"><div class="label">Nota CITE</div><div class="valor">${r.nota_cite || '—'}</div></div>
      <div class="detalle-campo"><div class="label">Remitido por</div><div class="valor">${r.nombre_remitente || '—'}</div></div>
    </div>
    ${r.motivo_salida ? `
    <hr class="divider">
    <div class="form-group" style="margin:0">
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--gris-texto);font-weight:600;margin-bottom:6px;">Motivo de Salida</label>
      <div style="background:var(--gris-claro);border-radius:var(--radio);padding:14px;font-size:14px;line-height:1.6;">${r.motivo_salida}</div>
    </div>` : ''}`;
  abrirModal('modal-detalle', `📨 Detalle Remisión: ${r.exp_codigo}`, html);
}

async function abrirModalRemitir(tipo, expId) {
  const { data: exp } = await db.from(tipo).select('*').eq('id', expId).single();
  if (!exp) return;

  // Validar si el usuario puede remitir este expediente
  const esArchivo = currentUser.tipo_usuario === 'archivo';
  const esActivo = currentUser.tipo_usuario === 'activo';

  if (esActivo && exp.estado_expediente !== 'prestado') {
    mostrarNotif('Solo puede remitir un expediente que esté en su poder (en préstamo).', 'warning');
    return;
  }
  if (esArchivo && exp.estado_expediente !== 'disponible' && exp.estado_expediente !== 'prestado') {
    mostrarNotif('El expediente no está disponible para remisión.', 'warning');
    return;
  }

  const destinosOpts = DESTINOS_REMISION.map(d => `<option value="${d}">${d}</option>`).join('');

  const html = `
    <div class="detalle-grid mb-2">
      <div class="detalle-campo"><div class="label">Código</div><div class="valor">${exp.codigo}</div></div>
      <div class="detalle-campo"><div class="label">Tipo</div><div class="valor">${tipoLabel(tipo)}</div></div>
      <div class="detalle-campo full"><div class="label">Nombre</div><div class="valor">${getNombreExpediente(exp, tipo)}</div></div>
      <div class="detalle-campo"><div class="label">Dpto.</div><div class="valor">${exp.departamento}</div></div>
      <div class="detalle-campo"><div class="label">Cuerpos / Fojas</div><div class="valor">${exp.cuerpos} / ${exp.numero_fojas}</div></div>
    </div>
    <div class="form-group">
      <label>Destino *</label>
      <select id="rem-destino" onchange="toggleOtroDestino(this)">
        <option value="">— Seleccione —</option>
        ${destinosOpts}
      </select>
    </div>
    <div class="form-group" id="rem-otro-wrap" style="display:none;">
      <label>Especifique el destino *</label>
      <input type="text" id="rem-otro" placeholder="Nombre de la dirección o unidad" maxlength="300">
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>Hoja de Ruta (opcional)</label>
        <input type="text" id="rem-hoja" placeholder="Ej: HR-2025-0150" maxlength="100">
      </div>
      <div class="form-group">
        <label>Nota CITE (opcional)</label>
        <input type="text" id="rem-cite" placeholder="Ej: DGAT-N°45/2025" maxlength="100">
      </div>
    </div>
    <div class="form-group">
      <label>Motivo de Salida *</label>
      <textarea id="rem-motivo" placeholder="Describa el motivo de la remisión del expediente..." style="min-height:100px;" maxlength="2000"></textarea>
    </div>`;

  abrirModal('modal-accion', '📨 Remitir Expediente', html,
    `<button class="btn btn-remitir" onclick="confirmarRemitir('${tipo}',${expId})">📨 Registrar Remisión</button>`);
}

function toggleOtroDestino(sel) {
  const wrap = document.getElementById('rem-otro-wrap');
  if (wrap) wrap.style.display = sel.value === 'Otro' ? 'block' : 'none';
}

async function confirmarRemitir(tipo, expId) {
  let destino = document.getElementById('rem-destino').value;
  if (!destino) { mostrarNotif('Seleccione el destino', 'error'); return; }
  if (destino === 'Otro') {
    destino = document.getElementById('rem-otro')?.value.trim();
    if (!destino) { mostrarNotif('Especifique el destino', 'error'); return; }
  }

  const hojaRuta = document.getElementById('rem-hoja').value.trim();
  const cite = document.getElementById('rem-cite').value.trim();
  const motivo = document.getElementById('rem-motivo').value.trim();
  if (!motivo) { mostrarNotif('El motivo de salida es requerido', 'error'); return; }

  const { data: exp } = await db.from(tipo).select('codigo').eq('id', expId).single();
  const nombreExp = inventarioData.find(e => e.id === expId) ? getNombreExpediente(inventarioData.find(e => e.id === expId), tipo) : '';

  const now = new Date().toISOString();

  // Insertar remisión
  const { error: e1 } = await db.from('remisiones').insert({
    tipo_expediente: tipo,
    expediente_id: expId,
    exp_codigo: exp ? String(exp.codigo) : String(expId),
    exp_nombre: nombreExp,
    destino,
    hoja_ruta: hojaRuta || null,
    nota_cite: cite || null,
    motivo_salida: motivo,
    nombre_remitente: currentUser.nombre_completo,
    usuario_id: currentUser.id,
    fecha_remision: now
  });
  if (e1) { mostrarNotif('Error al registrar remisión: ' + e1.message, 'error'); return; }

  // Registrar movimiento
  await db.from('movimientos').insert({
    tipo_expediente: tipo,
    expediente_id: expId,
    exp_codigo: exp ? String(exp.codigo) : String(expId),
    exp_nombre: nombreExp,
    tipo_movimiento: 'remision',
    fecha_solicitud: now,
    fecha_salida: now,
    nombre_solicitante: currentUser.nombre_completo,
    usuario_solicitante_id: currentUser.id,
    observaciones_salida: `Remitido a: ${destino}. ${motivo.substring(0, 100)}`,
    estado_movimiento: 'devuelto',
    estado_salida: 'bueno'
  });

  // Actualizar estado del expediente
  await db.from(tipo).update({ estado_expediente: 'remitido' }).eq('id', expId);

  cerrarModal('modal-accion');
  mostrarNotif(`Expediente remitido a ${destino}`, 'success');
  cargarInventario(tipo);
  actualizarBadgePendientes();
}

// =============================================
// HISTORIAL GENERAL
// =============================================

async function cargarHistorial(filtros = {}) {
  const el = document.getElementById('tabla-historial-body');
  el.innerHTML = `<tr><td colspan="13"><div class="loading"><div class="spinner"></div> Cargando...</div></td></tr>`;

  let query = db.from('movimientos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (filtros.desde) query = query.gte('created_at', filtros.desde);
  if (filtros.hasta) query = query.lte('created_at', filtros.hasta + 'T23:59:59');
  if (filtros.tipo) query = query.eq('tipo_movimiento', filtros.tipo);

  const { data } = await query;
  if (!data || data.length === 0) {
    el.innerHTML = `<tr><td colspan="13"><div class="empty-state"><div class="icon">🔍</div><h4>Sin resultados</h4></div></td></tr>`;
    return;
  }

  const etiq = {
    solicitud_salida: 'Solicitud Salida', salida: 'Entregado',
    solicitud_devolucion: 'Sol. Devolución', devolucion: 'Devuelto',
    ingreso_nuevo: 'Nuevo (Pendiente)', ingreso_nuevo_aceptado: 'Ingresado Archivo',
    remision: 'Remitido'
  };

  el.innerHTML = (await Promise.all(data.map(async m => {
    const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
    const nombre = exp ? getNombreExpediente(exp, m.tipo_expediente) : 'N/A';
    const codigo = exp ? exp.codigo : (m.exp_codigo || m.expediente_id);

    let updateCell = '—';
    if (m.expediente_actualizado)
      updateCell = `<span class="badge badge-reservado">⚠️ ${m.cuerpos_anterior}→${m.cuerpos_nuevo} C / ${m.fojas_anterior}→${m.fojas_nuevo} F</span>`;

    return `<tr>
      <td class="text-xs">${fmtFecha(m.created_at)}</td>
      <td><span class="chip-tipo chip-${chipClass(m.tipo_expediente)}">${tipoLabel(m.tipo_expediente)}</span></td>
      <td><strong>${codigo}</strong></td>
      <td>${nombre}</td>
      <td class="text-xs">${m.nombre_solicitante || '—'}</td>
      <td class="text-xs">${m.nombre_personal_archivo || '—'}</td>
      <td><span class="badge ${getBadgeMovimiento(m.tipo_movimiento)}">${etiq[m.tipo_movimiento] || m.tipo_movimiento}</span></td>
      <td class="text-xs">${m.fecha_solicitud ? fmtFecha(m.fecha_solicitud) : '—'}</td>
      <td class="text-xs">${m.fecha_salida ? fmtFecha(m.fecha_salida) : '—'}</td>
      <td class="text-xs">${m.fecha_devolucion ? fmtFecha(m.fecha_devolucion) : '—'}</td>
      <td>${m.estado_salida ? `<span class="badge badge-${m.estado_salida}">${m.estado_salida}</span>` : '—'}</td>
      <td>${m.estado_devolucion ? `<span class="badge badge-${m.estado_devolucion}">${m.estado_devolucion}</span>` : '—'}</td>
      <td>${updateCell}</td>
    </tr>`;
  }))).join('');
}

function filtrarHistorial() {
  cargarHistorial({
    desde: document.getElementById('hist-desde').value,
    hasta: document.getElementById('hist-hasta').value,
    tipo: document.getElementById('hist-tipo').value,
  });
}

// =============================================
// REPORTES
// =============================================

function iniciarReportes() {
  const esArchivo = currentUser?.tipo_usuario === 'archivo';
  const cardArch = document.getElementById('reporte-archivo-card');
  const cardAct = document.getElementById('reporte-activo-card');
  if (cardArch) cardArch.style.display = esArchivo ? 'block' : 'none';
  if (cardAct) cardAct.style.display = !esArchivo ? 'block' : 'none';
  cargarResumenReporte();
}

async function cargarResumenReporte() {
  const el = document.getElementById('resumen-inventario-rep');
  const tipos = ['solicitudes_dotacion', 'autorizadas', 'adjudicaciones', 'usufructos'];
  let stats = { total: 0, disponible: 0, prestado: 0, pendiente: 0, remitido: 0 };

  for (const t of tipos) {
    const { data } = await db.from(t).select('estado_expediente');
    if (data) {
      stats.total += data.length;
      stats.disponible += data.filter(e => e.estado_expediente === 'disponible').length;
      stats.prestado += data.filter(e => e.estado_expediente === 'prestado').length;
      stats.pendiente += data.filter(e => e.estado_expediente === 'pendiente_archivo').length;
      stats.remitido += data.filter(e => e.estado_expediente === 'remitido').length;
    }
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
      <div style="background:var(--verde-suave);border-radius:6px;padding:10px;">
        <div style="font-weight:700;font-size:22px;color:var(--verde-inra);">${stats.total}</div>
        <div class="text-muted">Total expedientes</div>
      </div>
      <div style="background:#E8F8E8;border-radius:6px;padding:10px;">
        <div style="font-weight:700;font-size:22px;color:#16a34a;">${stats.disponible}</div>
        <div class="text-muted">Disponibles</div>
      </div>
      <div style="background:#FEF9E7;border-radius:6px;padding:10px;">
        <div style="font-weight:700;font-size:22px;color:#876A18;">${stats.prestado}</div>
        <div class="text-muted">En préstamo</div>
      </div>
      <div style="background:#E0F7FA;border-radius:6px;padding:10px;">
        <div style="font-weight:700;font-size:22px;color:var(--teal);">${stats.remitido}</div>
        <div class="text-muted">Remitidos</div>
      </div>
    </div>`;
}

async function generarReporte(tipo) {
  const desde = document.getElementById('rep-desde-arch')?.value || document.getElementById('rep-desde-act')?.value || '';
  const hasta = document.getElementById('rep-hasta-arch')?.value || document.getElementById('rep-hasta-act')?.value || '';

  if (tipo === 'inventario-completo') {
    await generarReporteInventarioCompleto();
    return;
  }

  if (tipo === 'remisiones-rep') {
    await generarReporteRemisiones(desde, hasta);
    return;
  }

  let query = db.from('movimientos').select('*').order('created_at', { ascending: true });
  if (tipo === 'salidas')
    query = query.in('tipo_movimiento', ['solicitud_salida', 'salida']);
  else if (tipo === 'ingresos')
    query = query.in('tipo_movimiento', ['solicitud_devolucion', 'devolucion', 'ingreso_nuevo', 'ingreso_nuevo_aceptado']);
  else if (tipo === 'mis-movimientos')
    query = query.or(`usuario_solicitante_id.eq.${currentUser.id},nombre_solicitante.eq.${currentUser.nombre_completo}`);

  if (desde) query = query.gte('created_at', desde);
  if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

  const { data } = await query;
  if (!data || data.length === 0) { mostrarNotif('No hay datos para el período seleccionado', 'warning'); return; }

  const titulos = { salidas: 'Reporte de Salidas', ingresos: 'Reporte de Ingresos', 'mis-movimientos': `Mis Movimientos — ${currentUser.nombre_completo}` };
  const etiqMov = {
    solicitud_salida: 'Solicitud Salida', salida: 'Entregado',
    solicitud_devolucion: 'Sol. Devolución', devolucion: 'Devuelto',
    ingreso_nuevo: 'Nuevo Pendiente', ingreso_nuevo_aceptado: 'Ingresado Archivo',
    remision: 'Remisión'
  };

  const filas = await Promise.all(data.map(async m => {
    const { data: exp } = await db.from(m.tipo_expediente).select('*').eq('id', m.expediente_id).single();
    const nombre = exp ? getNombreExpediente(exp, m.tipo_expediente) : 'N/A';
    return `<tr>
      <td>${tipoLabel(m.tipo_expediente)}</td>
      <td><strong>${exp?.codigo || m.exp_codigo || m.expediente_id}</strong></td>
      <td>${nombre}</td>
      <td>${exp?.departamento || '—'}</td>
      <td>${m.nombre_solicitante || '—'}</td>
      <td>${m.nombre_personal_archivo || '—'}</td>
      <td>${etiqMov[m.tipo_movimiento] || m.tipo_movimiento}</td>
      <td>${m.fecha_solicitud ? fmtFecha(m.fecha_solicitud) : '—'}</td>
      <td>${m.fecha_salida ? fmtFecha(m.fecha_salida) : '—'}</td>
      <td>${m.fecha_devolucion ? fmtFecha(m.fecha_devolucion) : '—'}</td>
      <td>${m.estado_salida || '—'}</td>
      <td>${m.estado_devolucion || '—'}</td>
      <td>${m.expediente_actualizado ? `${m.cuerpos_anterior}→${m.cuerpos_nuevo} C` : '—'}</td>
    </tr>`;
  }));

  abrirVentanaImpresion(titulos[tipo] || tipo, desde, hasta, filas.join(''), `
    <thead><tr>
      <th>Tipo Exp.</th><th>Código</th><th>Nombre</th><th>Dpto.</th>
      <th>Solicitante</th><th>Personal Archivo</th><th>Movimiento</th>
      <th>F. Solicitud</th><th>F. Salida/Entrega</th><th>F. Devolución/Ingreso</th>
      <th>Cond. Salida</th><th>Cond. Retorno</th><th>Actualización</th>
    </tr></thead>`);
}

async function generarReporteRemisiones(desde, hasta) {
  let query = db.from('remisiones').select('*').order('created_at', { ascending: true });
  if (desde) query = query.gte('created_at', desde);
  if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');
  const { data } = await query;
  if (!data || data.length === 0) { mostrarNotif('No hay remisiones para el período', 'warning'); return; }

  const filas = data.map(r => `<tr>
    <td>${fmtFecha(r.fecha_remision)}</td>
    <td>${tipoLabel(r.tipo_expediente)}</td>
    <td><strong>${r.exp_codigo}</strong></td>
    <td>${r.exp_nombre || '—'}</td>
    <td>${r.destino}</td>
    <td>${r.hoja_ruta || '—'}</td>
    <td>${r.nota_cite || '—'}</td>
    <td>${r.nombre_remitente || '—'}</td>
    <td>${r.motivo_salida ? r.motivo_salida.substring(0, 80) + (r.motivo_salida.length > 80 ? '…' : '') : '—'}</td>
  </tr>`).join('');

  abrirVentanaImpresion('Registro de Remisiones', desde, hasta, filas, `
    <thead><tr>
      <th>Fecha</th><th>Tipo</th><th>Código</th><th>Nombre</th>
      <th>Destino</th><th>Hoja de Ruta</th><th>CITE</th><th>Remitido por</th><th>Motivo</th>
    </tr></thead>`);
}

async function generarReporteInventarioCompleto() {
  const tipos = [
    { tabla: 'solicitudes_dotacion', label: 'Solicitudes de Dotación' },
    { tabla: 'autorizadas', label: 'Autorizadas' },
    { tabla: 'adjudicaciones', label: 'Adjudicaciones' },
    { tabla: 'usufructos', label: 'Usufructos' },
  ];

  let todasFilas = '';
  for (const { tabla, label } of tipos) {
    const { data } = await db.from(tabla).select('*').order('id');
    if (!data || data.length === 0) continue;

    data.forEach((exp, idx) => {
      let nombre = getNombreExpediente(exp, tabla);
      todasFilas += `<tr>
        <td>${label}</td>
        <td><strong>${exp.codigo}</strong></td>
        <td>${exp.departamento}</td>
        <td>${exp.municipio || '—'}</td>
        <td>${nombre}</td>
        <td>${exp.cuerpos}</td>
        <td>${exp.numero_fojas}</td>
        <td>${estadoTexto(exp.estado_expediente)}</td>
        <td>${exp.estado_fisico || '—'}</td>
      </tr>`;
    });
  }

  abrirVentanaImpresion('Inventario Completo de Expedientes', '', '', todasFilas, `
    <thead><tr>
      <th>Tipo</th><th>Código</th><th>Departamento</th><th>Municipio</th><th>Nombre / Comunidad</th>
      <th>Cuerpos</th><th>N° Fojas</th><th>Estado</th><th>Estado Físico</th>
    </tr></thead>`);
}

function abrirVentanaImpresion(titulo, desde, hasta, filas, thead) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><title>${titulo} — INRA SAAF</title>
    <style>
      @page { size: A4 landscape; margin: 10mm 12mm; }
      body { font-family: Arial, sans-serif; font-size: 9.5px; color: #1A2A1A; margin: 0; }
      .rep-header { display:flex; align-items:center; gap:16px; border-bottom:3px solid #095609; padding-bottom:10px; margin-bottom:12px; }
      .rep-logo { width:52px;height:52px;background:linear-gradient(135deg,#095609,#2D6A2D);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0; }
      .rep-info h1 { font-size:14px;color:#095609;margin:0 0 2px; }
      .rep-info p  { font-size:9px;color:#666;margin:0; }
      .rep-meta { display:flex;gap:14px;margin-bottom:10px;font-size:9px;color:#555;background:#f4f8f4;padding:7px 10px;border-radius:5px;flex-wrap:wrap; }
      table { width:100%;border-collapse:collapse; }
      th { background:#095609;color:white;padding:6px 5px;text-align:left;font-size:8.5px;text-transform:uppercase;letter-spacing:.3px; }
      td { padding:4px 5px;border-bottom:1px solid #d4e8d4;font-size:9px; }
      tr:nth-child(even){ background:#f4f8f4; }
      .footer { margin-top:14px;text-align:center;font-size:8px;color:#999;border-top:1px solid #ccc;padding-top:7px; }
      .btn-print { margin-top:10px;padding:7px 18px;background:#095609;color:white;border:none;border-radius:5px;font-size:12px;cursor:pointer; }
      @media print { .btn-print { display:none; } }
    </style></head><body>
    <div class="rep-header">
      <div class="rep-logo">🌿</div>
      <div class="rep-info">
        <h1>INRA — ${titulo}</h1>
        <p>Dirección General de Administración de Tierras Fiscales</p>
        <p>Sistema de Administración de Archivos (SAAF)</p>
      </div>
    </div>
    <div class="rep-meta">
      <span>📅 Generado: <strong>${fmtFecha(new Date().toISOString())}</strong></span>
      ${desde ? `<span>📆 Desde: <strong>${desde}</strong></span>` : ''}
      ${hasta ? `<span>📆 Hasta: <strong>${hasta}</strong></span>` : ''}
      <span>👤 Por: <strong>${currentUser.nombre_completo}</strong></span>
    </div>
    <table>${thead}<tbody>${filas}</tbody></table>
    <div class="footer">INRA Bolivia · Sistema de Administración de Archivos (SAAF) · Documento generado automáticamente</div>
    <br><button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
    </body></html>`);
  win.document.close();
}

// =============================================
// BADGES PENDIENTES EN NAV
// =============================================

async function actualizarBadgePendientes() {
  if (currentUser?.tipo_usuario !== 'archivo') return;

  const { count: cSal } = await db.from('movimientos')
    .select('*', { count: 'exact', head: true })
    .eq('estado_movimiento', 'pendiente')
    .eq('tipo_movimiento', 'solicitud_salida');

  const { count: cNuev } = await db.from('movimientos')
    .select('*', { count: 'exact', head: true })
    .eq('estado_movimiento', 'pendiente')
    .eq('tipo_movimiento', 'ingreso_nuevo');

  const { count: cDevol } = await db.from('movimientos')
    .select('*', { count: 'exact', head: true })
    .eq('tipo_movimiento', 'solicitud_devolucion')
    .eq('estado_movimiento', 'en_prestamo');

  const totalPend = (cSal || 0) + (cNuev || 0);

  const badge = document.getElementById('badge-pendientes');
  const badge2 = document.getElementById('badge-nuevos');
  const badge3 = document.getElementById('badge-devoluciones');

  if (badge) { badge.textContent = totalPend; badge.style.display = totalPend > 0 ? 'inline' : 'none'; }
  if (badge2) { badge2.textContent = cNuev || 0; badge2.style.display = (cNuev || 0) > 0 ? 'inline' : 'none'; }
  if (badge3) { badge3.textContent = cDevol || 0; badge3.style.display = (cDevol || 0) > 0 ? 'inline' : 'none'; }
}

// =============================================
// UTILIDADES
// =============================================

function tipoLabel(tipo) {
  const map = { solicitudes_dotacion: 'Sol. Dotación', autorizadas: 'Autorizada', adjudicaciones: 'Adjudicación', usufructos: 'Usufructo' };
  return map[tipo] || tipo;
}

function chipClass(tipo) {
  const map = { solicitudes_dotacion: 'solicitud', autorizadas: 'autorizada', adjudicaciones: 'adjudicacion', usufructos: 'usufructo' };
  return map[tipo] || 'solicitud';
}

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function abrirModal(modalId, titulo, contenido, footerExtra = '') {
  document.getElementById(modalId + '-titulo').textContent = titulo;
  document.getElementById(modalId + '-body').innerHTML = contenido;
  const footer = document.getElementById(modalId + '-footer');
  if (footer) footer.innerHTML = `${footerExtra}<button class="btn btn-secondary" onclick="cerrarModal('${modalId}')">Cancelar</button>`;
  document.getElementById(modalId).classList.add('open');
}

function cerrarModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
}

function mostrarNotif(msg, tipo = 'success') {
  const container = document.getElementById('notif-container');
  const iconos = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `notif-item ${tipo !== 'success' ? tipo : ''}`;
  el.innerHTML = `<span>${iconos[tipo]}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 4500);
}

// =============================================
// INICIALIZACIÓN
// =============================================

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', login);
});
