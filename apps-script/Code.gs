/**
 * Caja Pequenavidad — servidor en Google Apps Script.
 * Guarda los datos en la hoja de Google a la que está vinculado este script.
 *
 * Dos PIN:
 *   - PIN de administrador: puede ver y cambiar todo (cualquier día, productos, stock, beneficios).
 *   - PIN de tienda: solo puede apuntar o corregir las ventas del DÍA DE HOY y ver el stock.
 *
 * Los PIN NO van en este código: se guardan en las propiedades del script.
 * Para ponerlos, escribe tus PIN en configurarPins(), ejecútala una vez y
 * después borra los números de esta función (ya quedan guardados).
 */

const TZ = 'Europe/Madrid';
const SHEET_PRODUCTS = 'Productos';
const SHEET_SALES = 'Ventas';
const SALES_COLS = 10; // Fecha | ID producto | Producto | Unidades | Precio | Coste | Importe | Beneficio | Apuntado por | Actualizado
const MAX_FAILS = 8;          // intentos de PIN fallidos permitidos...
const LOCK_SECONDS = 600;     // ...antes de bloquear 10 minutos

function configurarPins() {
  const ADMIN_PIN = '';   // ← tu PIN (el que lo puede todo)
  const STAFF_PIN = '';   // ← el PIN de la persona de la tienda
  if (!/^\d{4,8}$/.test(ADMIN_PIN) || !/^\d{4,8}$/.test(STAFF_PIN)) throw new Error('Cada PIN debe tener entre 4 y 8 números.');
  if (ADMIN_PIN === STAFF_PIN) throw new Error('Los dos PIN tienen que ser distintos.');
  PropertiesService.getScriptProperties().setProperties({ ADMIN_PIN: ADMIN_PIN, STAFF_PIN: STAFF_PIN });
  Logger.log('PIN guardados. Ahora borra los números de esta función y guarda.');
}

// ---------- entrada ----------
function doGet() {
  return json({ ok: true, app: 'Caja Pequenavidad' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad_request' }); }

  if (isLocked()) return json({ ok: false, error: 'locked' });
  const role = checkPin(String(req.pin || ''));
  if (!role) { registerFail(); return json({ ok: false, error: isLocked() ? 'locked' : 'bad_pin' }); }

  try {
    switch (req.action) {
      case 'login':
      case 'load':
        return json(Object.assign({ ok: true, role: role, today: todayKey() }, loadData(role)));
      case 'saveDay':
        return json(withLock(() => saveDay(role, req.day, req.items)));
      case 'saveProduct':
        if (role !== 'admin') return json({ ok: false, error: 'forbidden' });
        return json(withLock(() => saveProduct(req.product)));
      case 'deleteProduct':
        if (role !== 'admin') return json({ ok: false, error: 'forbidden' });
        return json(withLock(() => deleteProduct(req.id)));
      default:
        return json({ ok: false, error: 'bad_action' });
    }
  } catch (err) {
    return json({ ok: false, error: 'server', message: String(err && err.message || err) });
  }
}

// ---------- PIN ----------
function checkPin(pin) {
  const p = PropertiesService.getScriptProperties();
  const admin = p.getProperty('ADMIN_PIN'), staff = p.getProperty('STAFF_PIN');
  if (!admin || !staff) throw new Error('Faltan los PIN: ejecuta configurarPins() en Apps Script.');
  if (pin && pin === admin) return 'admin';
  if (pin && pin === staff) return 'staff';
  return null;
}
function isLocked() { return CacheService.getScriptCache().get('locked') === '1'; }
function registerFail() {
  const c = CacheService.getScriptCache();
  const n = Number(c.get('fails') || 0) + 1;
  c.put('fails', String(n), LOCK_SECONDS);
  if (n >= MAX_FAILS) { c.put('locked', '1', LOCK_SECONDS); c.remove('fails'); }
}

// ---------- helpers ----------
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function todayKey() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function asDay(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').trim();
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round2(n) { return Math.round(n * 100) / 100; }
function sheet(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('No encuentro la pestaña "' + name + '" en la hoja.');
  return sh;
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { return fn(); } finally { lock.releaseLock(); }
}

function readProducts() {
  const sh = sheet(SHEET_PRODUCTS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getValues()
    .map((r, i) => ({ row: i + 2, id: String(r[0]).trim(), name: String(r[1]).trim(), price: num(r[2]), cost: num(r[3]), stock: r[4] === '' ? '' : num(r[4]) }))
    .filter(p => p.id);
}

function readSales() {
  const sh = sheet(SHEET_SALES);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SALES_COLS).getValues()
    .map(r => ({ day: asDay(r[0]), pid: String(r[1]).trim(), name: String(r[2]), qty: num(r[3]), price: num(r[4]), cost: num(r[5]), by: String(r[8] || ''), updated: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || '') }))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.day) && s.pid && s.qty > 0);
}

function writeSales(rows) {
  const sh = sheet(SHEET_SALES);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, SALES_COLS).clearContent();
  if (!rows.length) return;
  rows.sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : a.name.localeCompare(b.name));
  sh.getRange(2, 1, rows.length, 2).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, SALES_COLS).setValues(rows.map(s => [
    s.day, s.pid, s.name, s.qty, s.price, s.cost, round2(s.price * s.qty), round2((s.price - s.cost) * s.qty), s.by, s.updated
  ]));
}

function loadData(role) {
  const products = readProducts().map(p => {
    const o = { id: p.id, name: p.name, price: p.price, stock: p.stock };
    if (role === 'admin') o.cost = p.cost;
    return o;
  });
  let sales = readSales();
  if (role !== 'admin') {
    const t = todayKey();
    sales = sales.filter(s => s.day === t).map(s => ({ day: s.day, pid: s.pid, name: s.name, qty: s.qty, price: s.price, by: s.by }));
  }
  return { products: products, sales: sales };
}

// ---------- acciones ----------
function saveDay(role, day, items) {
  day = String(day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'bad_day' };
  const today = todayKey();
  if (day > today) return { ok: false, error: 'future_day' };
  if (role !== 'admin' && day !== today) return { ok: false, error: 'only_today' };

  const want = {};
  (Array.isArray(items) ? items : []).forEach(it => {
    const q = Math.floor(num(it && it.qty));
    if (it && it.pid && q > 0) want[String(it.pid)] = (want[String(it.pid)] || 0) + q;
  });

  const products = readProducts();
  const byId = {}; products.forEach(p => byId[p.id] = p);
  const all = readSales();
  const before = {};
  all.filter(s => s.day === day).forEach(s => before[s.pid] = (before[s.pid] || 0) + s.qty);

  // comprobar productos y stock
  for (const pid in want) {
    const p = byId[pid];
    if (!p) return { ok: false, error: 'unknown_product' };
    if (p.stock !== '') {
      const available = p.stock + (before[pid] || 0);
      if (want[pid] > available) return { ok: false, error: 'no_stock', product: p.name, available: available };
    }
  }

  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const by = role === 'admin' ? 'Raúl' : 'Tienda';
  const keep = all.filter(s => s.day !== day);
  const oldRows = all.filter(s => s.day === day);
  const fresh = Object.keys(want).map(pid => {
    const p = byId[pid];
    const old = oldRows.find(s => s.pid === pid);
    // si la cantidad no cambia, se conserva el precio con el que se apuntó
    if (old && before[pid] === want[pid]) return old;
    return { day: day, pid: pid, name: p.name, qty: want[pid], price: p.price, cost: p.cost, by: by, updated: stamp };
  });
  writeSales(keep.concat(fresh));

  // ajustar stock por la diferencia
  const sh = sheet(SHEET_PRODUCTS);
  const ids = {}; Object.keys(before).concat(Object.keys(want)).forEach(k => ids[k] = 1);
  Object.keys(ids).forEach(pid => {
    const p = byId[pid];
    if (!p || p.stock === '') return;
    const diff = (want[pid] || 0) - (before[pid] || 0);
    if (diff) sh.getRange(p.row, 5).setValue(Math.max(0, p.stock - diff));
  });

  return Object.assign({ ok: true, role: role, today: today }, loadData(role));
}

function saveProduct(prod) {
  if (!prod || !String(prod.name || '').trim()) return { ok: false, error: 'bad_product' };
  const sh = sheet(SHEET_PRODUCTS);
  const products = readProducts();
  const id = String(prod.id || '').trim() || ('p' + Date.now().toString(36));
  const row = [id, String(prod.name).trim(), round2(num(prod.price)), round2(num(prod.cost)), prod.stock === '' || prod.stock == null ? '' : Math.max(0, Math.floor(num(prod.stock)))];
  const existing = products.find(p => p.id === id);
  if (existing) sh.getRange(existing.row, 1, 1, 5).setValues([row]);
  else { const r = Math.max(sh.getLastRow(), 1) + 1; sh.getRange(r, 1).setNumberFormat('@'); sh.getRange(r, 1, 1, 5).setValues([row]); }
  return Object.assign({ ok: true, role: 'admin', today: todayKey() }, loadData('admin'));
}

function deleteProduct(id) {
  const p = readProducts().find(x => x.id === String(id));
  if (!p) return { ok: false, error: 'unknown_product' };
  sheet(SHEET_PRODUCTS).deleteRow(p.row);
  return Object.assign({ ok: true, role: 'admin', today: todayKey() }, loadData('admin'));
}
