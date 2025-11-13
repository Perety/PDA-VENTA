// static/main.js
const CARDS = [
  {id:'pda', title:'PDA / Fichas', desc:'Buscar y crear fichas PDA', icon:'🚓'},
  {id:'calls', title:'Dispatch / Llamadas', desc:'Crear/Asignar llamadas', icon:'📞'},
  {id:'reports', title:'Informes', desc:'Crear / Editar informes', icon:'📑'},
  {id:'wanted', title:'BOLO / Wanted', desc:'Fichas buscados', icon:'🚨'},
  {id:'fines', title:'Multas', desc:'Generar sanciones', icon:'💸'},
  {id:'service', title:'Servicio', desc:'Entrar / Salir de servicio', icon:'🟢'},
  {id:'admin', title:'Administración', desc:'Roles y usuarios (avanzado)', icon:'⚙️'},
  {id:'alerts', title:'Alertas', desc:'Crear / Borrar alertas', icon:'⚠️'},
  {id:'logs', title:'Auditoría', desc:'Historial', icon:'📜'}
];

const cardsRoot = document.getElementById('cardsRoot');
const expandedRoot = document.getElementById('expandedRoot');
const userDisplay = document.getElementById('userDisplay');
const dutyStatus = document.getElementById('dutyStatus');
const btnLogin = document.getElementById('btnLogin');
const btnExport = document.getElementById('btnExport');

function renderCards(){
  cardsRoot.innerHTML = '';
  CARDS.forEach(c=>{
    const el = document.createElement('div'); el.className='card';
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="title">${c.title}</div><div class="desc">${c.desc}</div></div>
      <div class="icon">${c.icon}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center"><div class="muted tiny">Acción rápida</div><div><button class="btn-ghost" data-open="${c.id}">Abrir</button></div></div>`;
    el.onclick = ()=> openCard(c.id);
    el.querySelector('button[data-open]').onclick = (e)=>{ e.stopPropagation(); openCard(c.id) };
    cardsRoot.appendChild(el);
  });
}

function openCard(id){
  expandedRoot.innerHTML = '';
  if(id==='calls') renderCalls();
  else if(id==='reports') renderReports();
  else if(id==='pda') renderPDA();
  else if(id==='wanted') renderWanted();
  else if(id==='fines') renderFines();
  else if(id==='service') renderService();
  else if(id==='admin') renderAdmin();
  else if(id==='alerts') renderAlerts();
  else if(id==='logs') renderLogs();
  window.scrollTo({ top: 0, behavior:'smooth' });
}

/* ---------- Utils ---------- */
async function api(path, opts){
  opts = opts || {};
  opts.headers = opts.headers || {'Content-Type':'application/json'};
  if(opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const res = await fetch('/api' + path, opts);
  const json = await res.json().catch(()=>({ok:false}));
  if(!res.ok) throw json;
  return json;
}

function setUserDisplay(user){
  if(user){
    userDisplay.textContent = `${user.display} (${user.role||''})`;
  } else {
    userDisplay.textContent = 'No conectado';
  }
}

/* ---------- Login modal flow ---------- */
const loginModal = document.getElementById('loginModal');
document.getElementById('loginBtn').onclick = async ()=>{
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  try{
    const r = await api('/login',{method:'POST', body:{username:u,password:p}});
    if(r.ok){
      loginModal.style.display='none';
      loadHeader();
      alert('Sesión iniciada: ' + r.user.display);
    }
  }catch(err){
    document.getElementById('loginError').style.display='block';
    document.getElementById('loginError').textContent = err.error || 'Error';
  }
};
document.getElementById('loginCancel').onclick = ()=> loginModal.style.display='none';
btnLogin.onclick = async ()=>{
  // check current
  const txt = userDisplay.textContent;
  if(txt !== 'No conectado'){
    if(confirm('Cerrar sesión?')){
      await fetch('/api/logout',{method:'POST'});
      setUserDisplay(null);
      alert('Sesión cerrada');
    }
    return;
  }
  loginModal.style.display='flex';
  document.getElementById('loginUser').focus();
};

/* ---------- Header load ---------- */
async function loadHeader(){
  try{
    const data = await api('/users'); // to trigger session info we will call users list then get current by separate route design
  }catch(e){}
  // get current by letting server set cookie. We'll use /api/onDutyList to get counts
  try{
    const on = await api('/onDutyList');
    dutyStatus.textContent = `En servicio: ${on.onDuty.length}`;
  }catch(e){}
  // try to get current user (simple attempt to let backend return user info on /users? Not implemented)
  // We'll just show server-side state by calling /users and finding if a session cookie exists via calling /api/users then finding who matches session? Simpler: rely on the login calls to set UI.
  // For now, try a lightweight endpoint by requesting /api/users and show nothing if not logged.
  try{
    const res = await fetch('/api/users'); // if session cookie present, server doesn't return current user, so keep previous display or leave as is.
    // no-op
  }catch(e){}
}

/* ---------- Calls ---------- */
async function renderCalls(){
  const container = document.createElement('div'); container.className='expanded';
  container.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Dispatch / Llamadas</strong><div class="muted small">Crear llamadas y asignar unidades</div></div><div><button class="btn btn-small" id="closeC">Cerrar</button></div></div>
  <div style="margin-top:12px;display:flex;gap:8px"><input id="callFrom" placeholder="Remitente (opcional)"/><input id="callMsg" placeholder="Mensaje"/><button id="callCreate" class="btn">Crear llamada</button></div>
  <div style="margin-top:12px"><strong>Llamadas</strong><div id="callsList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(container);
  container.querySelector('#closeC').onclick = ()=> expandedRoot.innerHTML='';
  container.querySelector('#callCreate').onclick = async ()=>{
    const caller = document.getElementById('callFrom').value;
    const message = document.getElementById('callMsg').value;
    if(!message) return alert('Introduce mensaje');
    await api('/calls/create',{method:'POST', body:{caller,message}});
    document.getElementById('callMsg').value=''; document.getElementById('callFrom').value='';
    loadCallsList();
  };
  loadCallsList();
}
async function loadCallsList(){
  const res = await api('/calls');
  const list = document.getElementById('callsList');
  list.innerHTML = '';
  if(!res.calls.length){ list.innerHTML = '<div class="muted small">No hay llamadas</div>'; return; }
  res.calls.forEach(c=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div style="flex:1"><b>${c.caller}</b><div class="muted small">${c.message}</div></div>
      <div style="text-align:right"><div class="muted tiny">${c.created_at || ''}</div><div style="margin-top:8px" class="muted tiny">Asig: ${c.assigned_to||'—'}</div></div>`;
    const btns = document.createElement('div'); btns.style.marginLeft='10px';
    const assign = document.createElement('button'); assign.className='btn-ghost'; assign.textContent='Asignar a mí';
    assign.onclick = async ()=>{ try{ await api(`/calls/${c.id}/assign`,{method:'POST'}); alert('Asignada'); loadCallsList(); }catch(e){ alert('Error: ' + (e.error||JSON.stringify(e))); } };
    btns.appendChild(assign);
    const del = document.createElement('button'); del.className='btn'; del.textContent='Borrar'; del.style.marginLeft='6px';
    del.onclick = async ()=>{ if(!confirm('Borrar llamada?')) return; try{ await api(`/calls/${c.id}/delete`,{method:'POST'}); loadCallsList(); }catch(e){ alert('Error: ' + (e.error||JSON.stringify(e))); } };
    btns.appendChild(del);
    it.appendChild(btns);
    list.appendChild(it);
  });
}

/* ---------- Reports ---------- */
async function renderReports(){
  const c = document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Informes</strong><div class="muted small">Crear y consultar informes</div></div><div><button class="btn btn-small" id="closeR">Cerrar</button></div></div>
  <div style="margin-top:12px"><div class="muted small">Plantilla (editable)</div><textarea id="tplReport" style="min-height:80px"></textarea></div>
  <div style="margin-top:8px" class="form-row"><input id="repTitle" placeholder="Título"/><input id="repAuthor" placeholder="Autor (auto)"/></div>
  <div style="margin-top:8px"><textarea id="repDesc" placeholder="Descripción..."></textarea></div>
  <div style="margin-top:8px;display:flex;gap:8px"><button id="saveRep" class="btn">Guardar informe</button><button id="clearRep" class="btn-ghost">Limpiar</button></div>
  <div style="margin-top:12px"><strong>Últimos informes</strong><div id="reportsList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeR').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#saveRep').onclick = async ()=>{
    const title = document.getElementById('repTitle').value;
    const desc = document.getElementById('repDesc').value;
    if(!title||!desc) return alert('Título y descripción obligatorios');
    try{ await api('/reports/create',{method:'POST', body:{title,description:desc}}); alert('Informe guardado'); loadReportsList(); }catch(e){ alert('Error: ' + (e.error||JSON.stringify(e))); }
  };
  loadReportsList();
}
async function loadReportsList(){
  const res = await api('/reports');
  const list = document.getElementById('reportsList');
  list.innerHTML = '';
  if(!res.reports.length) { list.innerHTML = '<div class="muted small">No hay informes</div>'; return; }
  res.reports.forEach(r=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div style="flex:1"><div style="font-weight:700">${r.title}</div><div class="muted small">${(r.description||'').slice(0,160)}</div></div>
    <div style="text-align:right"><div class="muted tiny">${r.created_at||''}</div><div style="margin-top:6px" class="muted tiny">${r.author||''}</div></div>`;
    const view = document.createElement('button'); view.className='btn-ghost'; view.textContent='Ver';
    view.onclick = ()=> alert(`${r.title}\n\n${r.description}\n\nAutor: ${r.author}`);
    it.appendChild(view);
    list.appendChild(it);
  });
}

/* ---------- PDA (fichas) ---------- */
async function renderPDA(){
  const c = document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>PDA / Fichas</strong><div class="muted small">Buscar y crear fichas</div></div><div><button class="btn btn-small" id="closeP">Cerrar</button></div></div>
  <div style="margin-top:12px;display:flex;gap:12px">
    <div style="flex:1"><input id="pdaQ" placeholder="Buscar..."/><div id="pdaResults" style="margin-top:12px"></div></div>
    <div style="width:320px"><textarea id="pdaTpl" placeholder="Plantilla..."></textarea><div style="display:flex;gap:8px;margin-top:8px"><button id="createPDA" class="btn">Crear ficha</button></div></div>
  </div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeP').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#pdaQ').oninput = ()=> searchPDA(c.querySelector('#pdaQ').value);
  c.querySelector('#createPDA').onclick = async ()=>{
    const t = document.getElementById('pdaTpl').value;
    if(!t) return alert('Rellena plantilla');
    try{ await api('/pda/create',{method:'POST', body:{text:t}}); alert('Ficha creada'); loadPDA(); }catch(e){ alert('Error'); }
  };
  loadPDA();
}
async function loadPDA(){
  // server currently doesn't expose pda endpoint in this template. We'll reuse reports as example,
  // but ideally backend would expose pda endpoints like /pda - skip for now or add if backend extended.
  const res = { items: [] };
  const results = document.getElementById('pdaResults'); results.innerHTML = '<div class="muted small">Funcionalidad PDA lista en backend.</div>';
}
function searchPDA(q){ /* placeholder */ }

/* ---------- Wanted ---------- */
async function renderWanted(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>BOLO / Wanted</strong><div class="muted small">Crear fichas buscadas</div></div><div><button class="btn btn-small" id="closeW">Cerrar</button></div></div>
  <div style="margin-top:12px" class="form-row"><input id="wName" placeholder="Nombre / Alias"/><input id="wBounty" placeholder="Recompensa"/></div>
  <div style="margin-top:8px"><textarea id="wDesc" placeholder="Descripción"></textarea></div>
  <div style="margin-top:8px;display:flex;gap:8px"><button id="saveW" class="btn">Crear ficha</button></div>
  <div style="margin-top:12px"><strong>Fichas</strong><div id="wantedList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeW').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#saveW').onclick = async ()=>{
    const name=document.getElementById('wName').value;
    const bounty=document.getElementById('wBounty').value;
    const desc=document.getElementById('wDesc').value;
    if(!name) return alert('Nombre requerido');
    try{ await api('/wanted/create',{method:'POST', body:{name,description:desc,bounty}}); alert('Wanted creado'); loadWantedList(); }catch(e){ alert('Error'); }
  };
  loadWantedList();
}
async function loadWantedList(){
  const res = await api('/wanted');
  const list = document.getElementById('wantedList'); list.innerHTML = '';
  if(!res.wanted.length) { list.innerHTML = '<div class="muted small">Sin fichas</div>'; return;}
  res.wanted.forEach(w=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div style="flex:1"><b>${w.name}</b><div class="muted small">${w.description}</div></div><div class="pill">${w.bounty||0}€</div>`;
    list.appendChild(it);
  });
}

/* ---------- Fines ---------- */
async function renderFines(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Multas</strong><div class="muted small">Generar sanciones</div></div><div><button class="btn btn-small" id="closeF">Cerrar</button></div></div>
  <div style="margin-top:12px" class="form-row"><input id="fineOff" placeholder="Infractor"/><input id="fineAmt" placeholder="Importe"/></div>
  <div style="margin-top:8px"><textarea id="fineReason" placeholder="Motivo..."></textarea></div>
  <div style="margin-top:8px;display:flex;gap:8px"><button id="saveFine" class="btn">Emitir multa</button></div>
  <div style="margin-top:12px"><strong>Multas</strong><div id="finesList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeF').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#saveFine').onclick = async ()=>{
    const off=document.getElementById('fineOff').value;
    const amt=document.getElementById('fineAmt').value;
    const reason=document.getElementById('fineReason').value;
    if(!off || !amt) return alert('Infractor e importe requeridos');
    try{ await api('/fines/create',{method:'POST', body:{offender:off,amount:amt,reason}}); alert('Multa creada'); loadFinesList(); }catch(e){ alert('Error'); }
  };
  loadFinesList();
}
async function loadFinesList(){
  const res = await api('/fines');
  const list = document.getElementById('finesList'); list.innerHTML = '';
  if(!res.fines.length){ list.innerHTML = '<div class="muted small">No hay multas</div>'; return; }
  res.fines.forEach(f=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div style="flex:1"><b>${f.offender} • ${f.amount}€</b><div class="muted small">${f.reason}</div></div><div class="muted tiny">${f.created_at||''}</div>`;
    list.appendChild(it);
  });
}

/* ---------- Service ---------- */
async function renderService(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Servicio</strong><div class="muted small">Ponte en servicio o sal</div></div><div><button class="btn btn-small" id="closeS">Cerrar</button></div></div>
  <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><div class="muted small">Tu estado:</div><div id="serviceBox" class="pill">Desconocido</div><div style="margin-left:auto"><button id="toggleDuty" class="btn">Cambiar estado</button></div></div>
  <div style="margin-top:12px"><strong>Policías en servicio</strong><div id="dutyList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeS').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#toggleDuty').onclick = async ()=>{
    try{ const r = await api('/toggle_duty',{method:'POST'}); alert('Estado: '+ r.status); loadDutyList(); }catch(e){ alert('Error'); }
  };
  loadDutyList();
}
async function loadDutyList(){
  const res = await api('/onDutyList');
  const list = document.getElementById('dutyList'); list.innerHTML = '';
  if(!res.onDuty.length){ list.innerHTML = '<div class="muted small">Nadie en servicio</div>'; dutyStatus.textContent = 'En servicio: 0'; return; }
  res.onDuty.forEach(a=>{
    const it = document.createElement('div'); it.className='item'; it.textContent = a.display || a.id; list.appendChild(it);
  });
  dutyStatus.textContent = `En servicio: ${res.onDuty.length}`;
}

/* ---------- Alerts ---------- */
async function renderAlerts(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Alertas</strong><div class="muted small">Crear o borrar alertas</div></div><div><button class="btn btn-small" id="closeA">Cerrar</button></div></div>
  <div style="margin-top:12px;display:flex;gap:8px"><select id="alertLevel"><option value="green">Verde</option><option value="yellow">Amarilla</option><option value="red">Roja</option></select><input id="alertText" placeholder="Texto alerta"/><button id="createAlert" class="btn">Crear</button></div>
  <div style="margin-top:12px"><strong>Alertas activas</strong><div id="alertsList" class="list" style="margin-top:8px"></div></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeA').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#createAlert').onclick = async ()=>{
    const lvl = document.getElementById('alertLevel').value;
    const txt = document.getElementById('alertText').value;
    if(!txt) return alert('Texto requerido');
    try{ await api('/alerts/create',{method:'POST', body:{level:lvl,text:txt}}); alert('Alerta creada'); loadAlertsList(); }catch(e){ alert('Error'); }
  };
  loadAlertsList();
}
async function loadAlertsList(){
  const res = await api('/alerts');
  const list = document.getElementById('alertsList'); list.innerHTML = '';
  if(!res.alerts.length){ list.innerHTML = '<div class="muted small">No hay alertas</div>'; return; }
  res.alerts.forEach(a=>{
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `<div style="flex:1"><b>[${a.level}]</b> <div class="muted small">${a.text}</div></div>`;
    const del = document.createElement('button'); del.className='btn'; del.textContent='Borrar';
    del.onclick = async ()=>{ if(!confirm('Borrar alerta?')) return; try{ await api(`/alerts/${a.id}/delete`,{method:'POST'}); loadAlertsList(); }catch(e){ alert('No autorizado'); } };
    it.appendChild(del);
    list.appendChild(it);
  });
}

/* ---------- Admin & Logs ---------- */
async function renderAdmin(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Administración</strong><div class="muted small">Roles y usuarios (solo admins)</div></div><div><button class="btn btn-small" id="closeAd">Cerrar</button></div></div>
  <div style="margin-top:12px;display:flex;gap:12px">
    <div style="flex:1"><h4>Usuarios</h4><div id="usersAdminList" class="list"></div></div>
    <div style="width:360px"><h4>Crear usuario</h4><input id="adm_newUser" placeholder="username"><input id="adm_newDisplay" placeholder="display"><input id="adm_newPass" placeholder="password"><select id="adm_newRole"></select><div style="display:flex;gap:8px;margin-top:8px"><button id="adm_createUser" class="btn">Crear</button><button id="adm_refresh" class="btn-ghost">Refrescar</button></div><hr style="margin:12px 0;border:none;border-top:1px solid rgba(255,255,255,0.03)"><h4>Roles</h4><div id="rolesAdminList"></div></div>
  </div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeAd').onclick = ()=> expandedRoot.innerHTML='';
  c.querySelector('#adm_refresh').onclick = loadAdmin;
  c.querySelector('#adm_createUser').onclick = async ()=>{
    const username=document.getElementById('adm_newUser').value;
    const display=document.getElementById('adm_newDisplay').value;
    const pass=document.getElementById('adm_newPass').value;
    const role=document.getElementById('adm_newRole').value;
    if(!username) return alert('username requerido');
    try{ await api('/users/create',{method:'POST', body:{username,display,password:pass,role}}); alert('Usuario creado'); loadAdmin(); }catch(e){ alert('Error: ' + (e.error||JSON.stringify(e))); }
  };
  loadAdmin();
}
async function loadAdmin(){
  try{
    const usersRes = await api('/users');
    const rolesRes = await api('/roles'); // Note: backend doesn't expose /roles in current app.py. If missing, we'll load via users roles found.
  }catch(e){}
  // load users
  try{
    const res = await api('/users');
    const list = document.getElementById('usersAdminList'); list.innerHTML = '';
    res.users.forEach(u=>{
      const it = document.createElement('div'); it.className='item';
      it.innerHTML = `<div><b>${u.display} (${u.username})</b><div class="muted small">Rol: ${u.role||'—'} • Badge: ${u.badge||'—'}</div></div>
      <div style="text-align:right"><select data-uid="${u.id}" class="adm_role_sel"></select><div style="margin-top:6px"><button class="btn-ghost btn-small" data-uid="${u.id}" data-act="del">Borrar</button></div></div>`;
      list.appendChild(it);
    });
    // fill role selects by fetching roles endpoint (we don't have it, so construct options statically or call /roles if implemented)
    const roleOps = ['officer','sergeant','dispatcher','admin',''];
    list.querySelectorAll('.adm_role_sel').forEach(sel=>{
      roleOps.forEach(r=>{ const o = document.createElement('option'); o.value=r; o.textContent=r||'—'; sel.appendChild(o); });
      sel.onchange = async (e)=>{ const uid = e.target.dataset.uid; const val = e.target.value; try{ await api(`/users/${uid}/role`,{method:'POST', body:{role:val}}); alert('Rol cambiado'); loadAdmin(); }catch(err){ alert('Error'); } };
    });
    list.querySelectorAll('button[data-act="del"]').forEach(b=>{
      b.onclick = async ()=>{ const uid = b.dataset.uid; if(!confirm('Borrar usuario?')) return; try{ await api(`/users/${uid}/delete`,{method:'POST'}); alert('Usuario borrado'); loadAdmin(); }catch(e){ alert('Error: '+(e.error||JSON.stringify(e))); } };
    });
    // roles list
    const rolesDiv = document.getElementById('rolesAdminList'); rolesDiv.innerHTML = '<div class="muted small">Edición de roles desde servidor</div>';
    // fill adm_newRole select (same options)
    const selNew = document.getElementById('adm_newRole'); selNew.innerHTML = ''; ['officer','sergeant','dispatcher','admin',''].forEach(r=>{ const o=document.createElement('option'); o.value=r; o.textContent=r||'—'; selNew.appendChild(o); });
  }catch(e){ console.error(e); alert('No autorizado o error al cargar admin'); }
}

/* ---------- Logs ---------- */
async function renderLogs(){
  const c=document.createElement('div'); c.className='expanded';
  c.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>Auditoría</strong><div class="muted small">Últimas acciones</div></div><div><button class="btn btn-small" id="closeL">Cerrar</button></div></div>
  <div style="margin-top:12px" id="logsList" class="list"></div>`;
  expandedRoot.appendChild(c);
  c.querySelector('#closeL').onclick = ()=> expandedRoot.innerHTML='';
  // load via export or logs endpoint (not provided), so we rely on server logs being visible through export
  try{
    const res = await api('/export'); // requires admin
    const logs = res.data.logs || [];
    const list = document.getElementById('logsList');
    list.innerHTML = '';
    logs.slice(0,200).forEach(l=>{
      const it=document.createElement('div'); it.className='item'; it.innerHTML = `<div><div style="font-weight:700">${l.msg}</div><div class="muted small">${l.t}</div></div>`; list.appendChild(it);
    });
  }catch(e){ document.getElementById('logsList').innerHTML = '<div class="muted small">Necesitas permisos o no hay logs</div>'; }
}

/* ---------- Init ---------- */
renderCards();
loadHeader();
