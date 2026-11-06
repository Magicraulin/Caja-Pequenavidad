(() => {
  'use strict';
  const API = (window.CAJA_CONFIG && window.CAJA_CONFIG.API_URL || '').trim();

  const fmt = n => (Math.round((n || 0) * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayLabel = k => dateOf(k).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const shiftDay = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const hasStock = p => !(p.stock === '' || p.stock == null);
  const num = x => { const n = parseFloat(String(x).replace(',', '.')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const PALETTE = ['#f5c451', '#6cc4ff', '#5ad8a6', '#c58bff', '#ff8a5c', '#ff6b9a'];

  // ---- state ----
  let pin = '', role = null, today = '';
  let products = [], rows = [];          // rows: one per product per day, as in the Google sheet
  let view = 'inicio', selDay = '', draft = {}, draftDay = null;
  const isAdmin = () => role === 'admin';

  const LSK = 'caja-pqv-pin';
  const lsGet = () => { try { return localStorage.getItem(LSK) || ''; } catch (e) { return ''; } };
  const lsSet = v => { try { v ? localStorage.setItem(LSK, v) : localStorage.removeItem(LSK); } catch (e) {} };

  // ---- server ----
  async function call(action, extra) {
    const res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ pin, action }, extra || {})) });
    if (!res.ok) throw { error: 'network' };
    const j = await res.json();
    if (!j.ok) throw j;
    return j;
  }
  function apply(j) {
    role = j.role; today = j.today;
    products = j.products || [];
    rows = j.sales || [];
    if (!selDay || (!isAdmin() && selDay !== today)) selDay = today;
  }
  const ERR = {
    bad_pin: 'PIN incorrecto.',
    locked: 'Demasiados intentos. Espera 10 minutos.',
    only_today: 'Con este PIN solo se pueden apuntar las ventas de hoy.',
    future_day: 'No se pueden apuntar días que aún no han llegado.',
    forbidden: 'Con este PIN no puedes hacer eso.',
    busy: 'Otra persona está guardando. Prueba en unos segundos.',
    network: 'Sin conexión. Revisa internet y vuelve a intentarlo.',
  };
  const errText = e => e && e.error === 'no_stock' ? `No hay tantas ${e.product}: como mucho ${e.available}.` : (e && ERR[e.error]) || (e && e.message) || 'Algo ha fallado. Vuelve a intentarlo.';

  function busy(on, t) { $('#busy').hidden = !on; if (t) $('#busyTxt').textContent = t; }
  function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2600); }
  function banner(t) { const b = $('#banner'); b.hidden = !t; b.textContent = t || ''; }

  // ---- derived ----
  const colorOf = pid => { const ids = products.map(p => p.id).sort(); const i = ids.indexOf(pid); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; };
  const sortedProducts = () => [...products].sort((a, b) => a.name.localeCompare(b.name));
  function savedQty(d) { const q = {}; rows.filter(r => r.day === d).forEach(r => { q[r.pid] = (q[r.pid] || 0) + r.qty; }); return q; }
  function statsFor(list) { let total = 0, cost = 0, units = 0;
    list.forEach(r => { total += r.price * r.qty; cost += (Number(r.cost) || 0) * r.qty; units += r.qty; });
    return { total, cost, profit: total - cost, units }; }
  function loadDraft(force) { if (force || draftDay !== selDay) { draft = savedQty(selDay); draftDay = selDay; } }
  const isDirty = () => { const s = savedQty(selDay); const ids = new Set([...Object.keys(s), ...Object.keys(draft)]); return [...ids].some(id => (s[id] || 0) !== (draft[id] || 0)); };
  const soldOf = pid => rows.filter(r => r.pid === pid).reduce((a, r) => a + r.qty, 0);

  // ---- layout per role ----
  const TAB_ICONS = {
    inicio: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    apuntar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    beneficios: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    productos: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
  };
  function tabsFor() { return isAdmin()
    ? [['inicio', 'Inicio'], ['apuntar', 'Apuntar'], ['beneficios', 'Beneficios'], ['productos', 'Stock']]
    : [['apuntar', 'Ventas de hoy'], ['productos', 'Stock']]; }
  function buildChrome() {
    const t = tabsFor();
    $('#tabs').classList.toggle('two', t.length === 2);
    $('#tabsIn').innerHTML = t.map(([v, l]) => `<button data-v="${v}"><svg viewBox="0 0 24 24">${TAB_ICONS[v]}</svg>${l}</button>`).join('');
    $('#roleTag').textContent = isAdmin() ? 'Admin' : 'Tienda';
    $('#addProd').hidden = !isAdmin();
    if (!t.some(([v]) => v === view)) view = t[0][0];
  }

  // ---- render ----
  function render() {
    document.querySelectorAll('#tabsIn button').forEach(b => b.setAttribute('aria-current', b.dataset.v === view ? 'page' : 'false'));
    ['inicio', 'apuntar', 'beneficios', 'productos'].forEach(v => $('#v-' + v).hidden = v !== view);
    ({ inicio: renderHome, apuntar: renderApuntar, beneficios: renderProfit, productos: renderProducts })[view]();
    $('#savebar').hidden = view !== 'apuntar' || !products.length;
  }

  function renderHome() {
    const st = statsFor(rows);
    $('#tdTotal').textContent = fmt(st.total);
    $('#tdProfit').textContent = fmt(st.profit);
    $('#tdUnits').textContent = st.units;
    const days = [...new Set(rows.map(r => r.day))].sort().reverse();
    if (!days.length) { $('#days').innerHTML = `<div class="empty"><b>Aún no hay ningún día apuntado</b>Pulsa el botón dorado cuando te pasen las ventas del primer día.</div>`; return; }
    $('#days').innerHTML = days.map(d => {
      const list = rows.filter(r => r.day === d), s = statsFor(list), dt = dateOf(d);
      const parts = list.map(r => r.qty + ' ' + r.name);
      const by = [...new Set(list.map(r => r.by).filter(Boolean))];
      const byTxt = by.length ? by.map(b => b === 'Raúl' ? 'ti' : 'la tienda').join(' y ') : '';
      return `<button class="day ${d === today ? 'is-today' : ''}" data-day="${d}">
        <span class="cal"><i>${dt.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</i><b>${dt.getDate()}</b></span>
        <span class="d">${d === today ? 'Hoy' : d === shiftDay(today, -1) ? 'Ayer' : dt.toLocaleDateString('es-ES', { weekday: 'long' })}<small>${esc(parts.join(' · '))}</small>${byTxt ? `<small class="by">Apuntado por ${byTxt}</small>` : ''}</span>
        <span class="amt">${fmt(s.total)}<small>+${fmt(s.profit)}</small></span></button>`;
    }).join('');
  }

  function renderApuntar() {
    loadDraft(false);
    const admin = isAdmin();
    $('#apTitle').textContent = admin ? 'Apuntar ventas' : 'Ventas de hoy';
    $('#apHint').innerHTML = admin
      ? 'Elige el día y pon cuántas unidades se vendieron de cada artículo. Luego pulsa <b>Guardar</b>.'
      : 'Pon cuántas unidades se han vendido hoy de cada artículo y pulsa <b>Guardar</b>. Puedes corregirlo durante todo el día.';
    $('#dq').hidden = !admin; $('#dateIn').hidden = !admin; $('#dateLbl').hidden = !admin;
    if (admin) {
      $('#dq').innerHTML = [[today, 'Hoy'], [shiftDay(today, -1), 'Ayer']].map(([k, l]) => `<button data-pick="${k}" aria-pressed="${k === selDay}">${l}</button>`).join('');
      const di = $('#dateIn'); di.value = selDay; di.max = today;
    }
    $('#which').textContent = dayLabel(selDay);
    const already = rows.some(r => r.day === selDay);
    $('#dayNote').hidden = !already;
    $('#dayNote').textContent = already ? 'Este día ya está apuntado. Si cambias algo y guardas, se corrige y el stock se ajusta solo.' : '';
    $('#clearDay').hidden = !already || !admin;
    const list = sortedProducts();
    if (!list.length) { $('#counters').innerHTML = `<div class="empty"><b>No hay productos</b>${admin ? 'Añádelos en la pestaña Stock.' : 'Pide a Raúl que los añada.'}</div>`; return; }
    const saved = savedQty(selDay);
    $('#counters').innerHTML = list.map(p => {
      const n = draft[p.id] || 0;
      const avail = hasStock(p) ? Number(p.stock) + (saved[p.id] || 0) - n : null;
      const gain = admin && p.cost != null ? ` · ganas <b>${fmt(n * (p.price - (Number(p.cost) || 0)))}</b>` : '';
      return `<div class="counter ${n ? 'has' : ''}" style="--c:${colorOf(p.id)}">
        <div class="n">${esc(p.name)}<small>${fmt(p.price)} cada uno</small></div>
        <div class="step3">
          <button data-dq="${p.id}" data-d="-1" aria-label="Quitar una ${esc(p.name)}">−</button>
          <input data-qin="${p.id}" inputmode="numeric" value="${n}" aria-label="Unidades de ${esc(p.name)}">
          <button class="plus" data-dq="${p.id}" data-d="1" aria-label="Añadir una ${esc(p.name)}">+</button>
        </div>
        <div class="sub">${n ? `${fmt(n * p.price)} vendido${gain}` : 'Ninguna vendida'}${avail != null ? ` · quedarán ${Math.max(0, avail)}` : ''}</div>
      </div>`;
    }).join('');
    updateSaveBar();
  }

  function updateSaveBar() {
    let total = 0, profit = 0, units = 0;
    Object.entries(draft).forEach(([pid, n]) => { const p = products.find(x => x.id === pid); if (!p || !n) return; total += p.price * n; profit += (p.price - (Number(p.cost) || 0)) * n; units += n; });
    $('#sbTotal').textContent = fmt(total);
    $('#sbSub').textContent = units ? (isAdmin() ? `${units} artículos · beneficio ${fmt(profit)}` : `${units} artículos`) : 'Pon las unidades vendidas';
    const btn = $('#saveDay'); btn.disabled = !isDirty(); btn.textContent = rows.some(r => r.day === selDay) ? 'Guardar cambios' : 'Guardar';
  }

  function setQty(pid, n) {
    const p = products.find(x => x.id === pid); if (!p) return;
    n = Math.max(0, Math.floor(n) || 0);
    if (hasStock(p)) { const max = Number(p.stock) + (savedQty(selDay)[pid] || 0); if (n > max) { n = max; toast('Solo hay ' + max + ' de ' + p.name); } }
    draft[pid] = n;
  }

  async function saveDay(clear) {
    const items = clear ? [] : Object.entries(draft).filter(([, n]) => n > 0).map(([pid, qty]) => ({ pid, qty }));
    busy(true, 'Guardando…');
    try {
      const j = await call('saveDay', { day: selDay, items });
      apply(j); draftDay = null;
      toast(items.length ? '¡Guardado! ' + dayLabel(selDay) : 'Día borrado');
      if (isAdmin()) { view = 'inicio'; window.scrollTo(0, 0); }
      render();
    } catch (e) { handleErr(e); }
    finally { busy(false); }
  }

  function renderProfit() {
    const st = statsFor(rows);
    $('#phVal').textContent = fmt(st.profit);
    $('#phSub').textContent = st.total ? `Has vendido ${fmt(st.total)} y esos artículos te costaron ${fmt(st.cost)}.` : 'Cuando apuntes ventas verás aquí lo que estás ganando.';
    const agg = {};
    rows.forEach(r => { const a = agg[r.pid] = agg[r.pid] || { name: r.name, q: 0, rev: 0, cost: 0 }; a.q += r.qty; a.rev += r.price * r.qty; a.cost += (Number(r.cost) || 0) * r.qty; });
    products.forEach(p => { if (!agg[p.id]) agg[p.id] = { name: p.name, q: 0, rev: 0, cost: 0 }; else agg[p.id].name = p.name; });
    let pending = 0, invested = 0;
    products.forEach(p => { if (hasStock(p)) { pending += (p.price - (Number(p.cost) || 0)) * Number(p.stock); invested += (Number(p.cost) || 0) * (Number(p.stock) + (agg[p.id] ? agg[p.id].q : 0)); } });
    $('#pk').innerHTML = `
      <div class="kpi"><span>Vendido</span><b>${fmt(st.total)}</b></div>
      <div class="kpi"><span>Invertido</span><b>${fmt(invested)}</b></div>
      <div class="kpi"><span>Por ganar</span><b style="color:var(--ok)">+${fmt(pending)}</b></div>`;
    const list = Object.entries(agg).map(([pid, a]) => ({ pid, ...a, profit: a.rev - a.cost, p: products.find(x => x.id === pid) })).filter(r => r.p || r.q);
    list.sort((x, y) => y.profit - x.profit || x.name.localeCompare(y.name));
    const maxP = Math.max(1, ...list.map(r => r.profit));
    $('#arts').innerHTML = list.length ? list.map(r => {
      const unit = r.p ? r.p.price - (Number(r.p.cost) || 0) : (r.q ? r.profit / r.q : 0);
      const left = r.p && hasStock(r.p) ? Number(r.p.stock) : null;
      return `<div class="art" style="--c:${colorOf(r.pid)}">
        <div class="top"><span class="n">${esc(r.name)}</span><span class="p ${r.profit > 0 ? '' : 'zero'}">${r.profit > 0 ? '+' : ''}${fmt(r.profit)}</span></div>
        <div class="meter"><i style="width:${Math.max(0, r.profit) / maxP * 100}%"></i></div>
        <div class="facts"><span>Vendidos<b>${r.q}</b></span><span>Ingresos<b>${fmt(r.rev)}</b></span><span>Por unidad<b>${fmt(unit)}</b></span></div>
        ${left != null ? `<div class="foot">Quedan ${left} · si los vendes, ganas <b>${fmt(unit * left)}</b> más</div>` : ''}
      </div>`;
    }).join('') : `<div class="empty"><b>Sin artículos</b>Añade productos para ver su beneficio.</div>`;
  }

  function renderProducts() {
    const list = sortedProducts(), admin = isAdmin();
    $('#prodList').innerHTML = list.length ? list.map(p => {
      const tag = admin ? 'button' : 'div';
      const attrs = admin ? `data-edit="${p.id}"` : '';
      if (!hasStock(p)) return `<${tag} class="stock ${admin ? '' : 'ro'}" ${attrs} style="--c:${colorOf(p.id)}">${admin ? '<span class="edit">Editar</span>' : ''}<span class="nm">${esc(p.name)}</span><div class="qty"><span>Sin contar stock</span></div></${tag}>`;
      const left = Number(p.stock), start = admin ? left + soldOf(p.id) : 0, pct = start ? left / start * 100 : (left > 0 ? 100 : 0);
      const cls = left <= 0 ? 'out' : (left <= 5 || (admin && pct <= 15)) ? 'low' : '';
      const st = left <= 0 ? 'Agotado' : cls === 'low' ? 'Quedan pocas' : admin ? `Has vendido ${start - left} de ${start}` : 'En stock';
      return `<${tag} class="stock ${cls} ${admin ? '' : 'ro'}" ${attrs} style="--c:${colorOf(p.id)}">
        ${admin ? '<span class="edit">Editar</span>' : ''}
        <span class="nm">${esc(p.name)}</span>
        <div class="qty"><b>${left}</b><span>${left === 1 ? 'queda' : 'quedan'}</span></div>
        ${admin ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
        <span class="st">${st}</span></${tag}>`;
    }).join('') : `<div class="empty"><b>Sin productos</b>${admin ? 'Añade tu primer producto con el botón dorado.' : ''}</div>`;
  }

  // ---- product sheet (admin) ----
  function sheet(html) { $('#sheetHost').innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    $('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') close(); }); }
  function close() { $('#sheetHost').innerHTML = ''; }
  function openProduct(p) {
    const isNew = !p; p = p || { id: '', name: '', price: '', cost: '', stock: '' };
    const v = x => (x === '' || x == null) ? '' : String(x).replace('.', ',');
    sheet(`<h2>${isNew ? 'Nuevo producto' : esc(p.name)}</h2>
      <form id="pf">
      <div class="field"><label for="pName">Nombre</label><input id="pName" required value="${esc(p.name)}"></div>
      <div class="three">
        <div class="field"><label for="pStock">Me quedan</label><input id="pStock" inputmode="numeric" placeholder="uds" value="${p.stock ?? ''}"></div>
        <div class="field"><label for="pPrice">Lo vendo a</label><input id="pPrice" inputmode="decimal" required placeholder="€" value="${v(p.price)}"></div>
        <div class="field"><label for="pCost">Me cuesta</label><input id="pCost" inputmode="decimal" placeholder="€" value="${v(p.cost)}"></div>
      </div>
      <div class="calc" id="pCalc"></div>
      <div class="actions"><button type="button" class="btn line" id="pCancel">Cancelar</button><button class="btn gold" type="submit">Guardar</button></div>
      ${isNew ? '' : '<button type="button" class="btn danger" id="pDel" style="width:100%;margin-top:10px">Eliminar producto</button>'}
      </form>`);
    const calc = () => { const pr = num($('#pPrice').value), co = num($('#pCost').value);
      $('#pCalc').innerHTML = pr ? `Ganas <b class="num">${fmt(pr - co)}</b> por cada uno.` : 'Escribe el precio para ver lo que ganas.'; };
    ['#pPrice', '#pCost'].forEach(s => $(s).addEventListener('input', calc)); calc();
    $('#pCancel').onclick = close;
    $('#pf').onsubmit = async e => { e.preventDefault();
      const stockRaw = $('#pStock').value.trim();
      const np = { id: p.id, name: $('#pName').value.trim(), price: num($('#pPrice').value), cost: num($('#pCost').value), stock: stockRaw === '' ? '' : Math.max(0, parseInt(stockRaw, 10) || 0) };
      if (!np.name) return;
      busy(true, 'Guardando…');
      try { apply(await call('saveProduct', { product: np })); close(); draftDay = null; render(); toast('Producto guardado'); }
      catch (err) { handleErr(err); } finally { busy(false); } };
    const del = $('#pDel');
    if (del) del.onclick = async () => {
      if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Pulsa otra vez para eliminar'; return; }
      busy(true, 'Eliminando…');
      try { apply(await call('deleteProduct', { id: p.id })); delete draft[p.id]; close(); render(); toast('Producto eliminado'); }
      catch (err) { handleErr(err); } finally { busy(false); }
    };
  }

  function handleErr(e) {
    if (e && (e.error === 'bad_pin' || e.error === 'locked')) { logout(errText(e)); return; }
    toast(errText(e));
  }

  // ---- data refresh ----
  let loading = false;
  async function refresh(quiet) {
    if (loading || !pin) return;
    if (view === 'apuntar' && isDirty()) return; // no pisar lo que se está escribiendo
    loading = true; $('#refresh').classList.add('spin');
    try { apply(await call('load')); draftDay = null; buildChrome(); render(); banner(''); }
    catch (e) { if (e && (e.error === 'bad_pin' || e.error === 'locked')) handleErr(e); else if (!quiet) toast(errText(e)); else banner('Sin conexión. Mostrando los últimos datos.'); }
    finally { loading = false; $('#refresh').classList.remove('spin'); }
  }

  // ---- login ----
  let entry = '';
  function drawDots() { $('#dots').innerHTML = Array.from({ length: Math.max(4, entry.length) }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join(''); }
  function showLogin(msg) { $('#app').hidden = true; $('#login').hidden = false; entry = ''; drawDots(); $('#loginErr').textContent = msg || ''; }
  async function tryLogin(p) {
    pin = p; $('#loginErr').textContent = '';
    busy(true, 'Entrando…');
    try {
      const j = await call('login'); apply(j); lsSet(pin);
      view = isAdmin() ? 'inicio' : 'apuntar'; draftDay = null;
      $('#login').hidden = true; $('#app').hidden = false; buildChrome(); render();
    } catch (e) {
      pin = ''; lsSet('');
      showLogin(errText(e)); const d = $('#dots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    } finally { busy(false); }
  }
  function logout(msg) { pin = ''; role = null; lsSet(''); products = []; rows = []; close(); showLogin(msg); }

  $('#pad').addEventListener('click', e => {
    const k = e.target.closest('button'); if (!k) return;
    const key = k.dataset.k;
    if (key === 'del') entry = entry.slice(0, -1);
    else if (key === 'ok') { if (entry.length >= 4) tryLogin(entry); else $('#loginErr').textContent = 'El PIN tiene al menos 4 números.'; return; }
    else if (entry.length < 8) entry += key;
    $('#loginErr').textContent = ''; drawDots();
  });
  document.addEventListener('keydown', e => {
    if ($('#login').hidden) return;
    if (/^\d$/.test(e.key) && entry.length < 8) { entry += e.key; drawDots(); }
    else if (e.key === 'Backspace') { entry = entry.slice(0, -1); drawDots(); }
    else if (e.key === 'Enter' && entry.length >= 4) tryLogin(entry);
  });

  // ---- events ----
  function goDay(d) { if (!isAdmin()) d = today; selDay = d; loadDraft(true); view = 'apuntar'; render(); window.scrollTo(0, 0); }
  document.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t || t.closest('.sheet') || t.closest('#pad')) return;
    if (t.dataset.v) { view = t.dataset.v; if (view === 'apuntar' && !isAdmin()) selDay = today; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.go) { goDay(today); return; }
    if (t.dataset.day) { goDay(t.dataset.day); return; }
    if (t.dataset.pick) { selDay = t.dataset.pick; loadDraft(true); render(); return; }
    if (t.dataset.dq) { setQty(t.dataset.dq, (draft[t.dataset.dq] || 0) + Number(t.dataset.d)); renderApuntar(); return; }
    if (t.dataset.edit && isAdmin()) { openProduct(products.find(p => p.id === t.dataset.edit)); return; }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'dateIn' && e.target.value && isAdmin()) { selDay = e.target.value > today ? today : e.target.value; loadDraft(true); render(); }
    if (e.target.dataset && e.target.dataset.qin) { setQty(e.target.dataset.qin, parseInt(e.target.value, 10)); renderApuntar(); }
  });
  document.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.qin) e.target.select(); });
  $('#saveDay').onclick = () => saveDay(false);
  $('#addProd').onclick = () => openProduct(null);
  $('#refresh').onclick = () => refresh(false);
  $('#logout').onclick = () => logout('');
  $('#clearDay').onclick = () => { const b = $('#clearDay');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Pulsa otra vez para borrar este día'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Borrar las ventas de este día'; }, 4000); return; }
    delete b.dataset.armed; b.textContent = 'Borrar las ventas de este día'; saveDay(true); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });

  // ---- snow ----
  (() => {
    const cv = $('#snow'), ctx = cv.getContext('2d');
    if (!ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let W = 0, H = 0, flakes = [];
    const size = () => { const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0);
      flakes = Array.from({ length: Math.round(Math.min(70, W / 10)) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2 + 0.6, s: Math.random() * 0.5 + 0.25, w: Math.random() * Math.PI * 2 })); };
    size(); addEventListener('resize', size);
    const tick = () => { ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const f of flakes) { f.y += f.s; f.w += 0.01; f.x += Math.sin(f.w) * 0.3; if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; } ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill(); }
      requestAnimationFrame(tick); };
    tick();
  })();

  // ---- start ----
  if (!API || API.indexOf('script.google.com') < 0) { $('#setup').hidden = false; return; }
  const saved = lsGet();
  if (saved) tryLogin(saved); else showLogin('');
})();
