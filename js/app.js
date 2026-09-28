import * as db from './db.js';
import { t, setLang, getLang } from './i18n.js';
import { TEMPLATES, BRANCHES, CASH_IN, CASH_OUT, MONTHS_DE, BOOK, normKey, suggest, similarity } from './templates.js';
import {
  parseAmount, fmtMoney, fmtAmountInput, fmtDate, fmtDay, fmtMonth, shiftMonth,
  withBalances, currentBalance, todayISO, uid,
} from './ledger.js';
import { prepareImage, decodeForCrop, cropToBlob } from './image.js';
import * as ocr from './ocr.js';
import { exportYear, readBackup, yearsOf, yearInfo, XLSX_MIME } from './excel.js';

const APP_VERSION = '1.0.0';
const app = document.getElementById('app');

const S = {
  settings: { key: 'settings', lang: 'de', apiKey: '', model: ocr.DEFAULT_MODEL, activeBiz: null, lastExport: {}, lastChange: {} },
  businesses: [],
  biz: null,
  entries: [],
  view: 'home',
  month: todayISO().slice(0, 7),
  exportYear: null,
  modal: null,
  queue: [],
  queueTotal: 0,
  queueDone: 0,
  busy: false,
};

// ---------- Hilfsfunktionen ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  in: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  out: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
  pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function showToast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const saveSettings = () => db.put('meta', S.settings);

async function saveBiz() {
  await db.put('businesses', S.biz);
  S.businesses = S.businesses.map((b) => (b.id === S.biz.id ? S.biz : b));
}

function markChanged() {
  S.settings.lastChange = { ...(S.settings.lastChange || {}), [S.biz.id]: Date.now() };
  saveSettings();
}

async function selectBiz(id) {
  S.biz = S.businesses.find((b) => b.id === id) || null;
  S.entries = S.biz ? await db.entriesOf(S.biz.id) : [];
  S.settings.activeBiz = S.biz ? S.biz.id : null;
  S.exportYear = null;
  await saveSettings();
}

function createBusiness({ name, template, startBalance, startDate }) {
  const tpl = TEMPLATES[template] || TEMPLATES.empty;
  return {
    id: uid(), name, template, categories: [...tpl.categories],
    employees: [], suppliers: {}, startBalance, startDate, created: Date.now(),
  };
}

// Bekannte Lieferanten, die am häufigsten verwendeten zuerst.
function suppliersList() {
  const count = new Map();
  Object.values(S.biz.suppliers || {}).forEach((s) => { if (s.name) count.set(s.name, count.get(s.name) || 0); });
  S.entries.filter((e) => e.kind === 'receipt' && e.party).forEach((e) => count.set(e.party, (count.get(e.party) || 0) + 1));
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
}

// Antippbare Lieferanten unter dem Eingabefeld, gefiltert nach dem bisher Getippten.
function supplierChips(current) {
  const q = normKey(current);
  let names = suppliersList();
  if (q) names = names.filter((n) => normKey(n).includes(q) || similarity(n, current) >= 0.6);
  names = names.slice(0, 8);
  return names.map((n) => `<button type="button" class="chip-btn ${n === current ? 'on' : ''}" data-act="pick-sup:${esc(n)}">${esc(n)}</button>`).join('');
}

// Gespeicherte Lieferanten für die Einstellungen, je Name einmal, alphabetisch.
function learnedSuppliers() {
  const byName = new Map();
  Object.values(S.biz.suppliers || {}).forEach((s) => { if (s.name && !byName.has(s.name)) byName.set(s.name, s); });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function partiesOf(kind, sub) {
  return [...new Set(S.entries.filter((e) => e.kind === kind && (!sub || e.sub === sub)).map((e) => e.party).filter(Boolean))];
}

// Gesellschafter aus der Liste in den Einstellungen plus alle, die schon einmal eingelegt oder ausbezahlt bekommen haben.
function partnerNames() {
  const names = new Set(S.biz.partners || []);
  S.entries.filter((e) => (e.kind === 'cashIn' || e.kind === 'cashOut') && cashType(e.kind, e.sub)?.who === 'partner')
    .forEach((e) => names.add(e.party));
  return [...names].filter(Boolean);
}

const cashType = (kind, sub) => (kind === 'cashIn' ? CASH_IN : CASH_OUT).find((x) => x.id === sub);

// Gehaltsmonate zur Auswahl: ein Jahr zurück bis drei Monate voraus, als "JJJJ-MM".
function salaryMonthLabel(ym) {
  const [y, mo] = ym.split('-').map(Number);
  const name = getLang() === 'de' ? MONTHS_DE[mo - 1] : new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(y, mo - 1, 1));
  return `${name} ${y}`;
}

const monthDiff = (a, b) => {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

// ---------- Rendering ----------

function render() {
  if (!S.businesses.length) {
    app.innerHTML = viewOnboarding() + hiddenInputs();
    return;
  }
  const main = S.view === 'export' ? viewExport() : S.view === 'settings' ? viewSettings() : viewHome();
  app.innerHTML = `${viewHeader()}<main class="main">${main}</main>${viewTabbar()}${hiddenInputs()}<div id="modal-root">${S.modal ? viewModal() : ''}</div>`;
  document.body.classList.toggle('modal-open', !!S.modal);
}

function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return render();
  root.innerHTML = S.modal ? viewModal() : '';
  document.body.classList.toggle('modal-open', !!S.modal);
}

function hiddenInputs() {
  return `<input type="file" id="in-camera" accept="image/*" capture="environment" hidden>
<input type="file" id="in-gallery" accept="image/*" multiple hidden>
<input type="file" id="in-backup" accept=".xlsx,${XLSX_MIME}" hidden>`;
}

function viewHeader() {
  return `<header class="top">
  <button class="biz-btn" data-act="biz-pick" aria-label="${esc(t('biz.switch'))}">
    <span class="biz-name">${esc(S.biz.name)}</span>${icon('down')}
  </button>
</header>`;
}

function viewTabbar() {
  const tab = (id, ic, label) => `<button class="tab ${S.view === id ? 'on' : ''}" data-act="nav:${id}" ${S.view === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></button>`;
  return `<nav class="tabbar">${tab('home', 'book', t('tab.book'))}${tab('export', 'download', t('tab.export'))}${tab('settings', 'sliders', t('tab.settings'))}</nav>`;
}

function banner(kind, html, action = '') {
  return `<div class="banner ${kind}">${icon(kind === 'err' ? 'alert' : kind === 'warn' ? 'alert' : 'check')}<div class="banner-text">${html}</div>${action}</div>`;
}

function viewHome() {
  const all = withBalances(S.biz, S.entries);
  const balance = currentBalance(S.biz, S.entries);
  const monthList = all.filter((e) => e.date.startsWith(S.month));
  const inSum = monthList.filter((e) => e.dir === 'in').reduce((s, e) => s + e.amount, 0);
  const outSum = monthList.filter((e) => e.dir === 'out').reduce((s, e) => s + e.amount, 0);
  const tipsSum = monthList.filter((e) => e.kind === 'tips').reduce((s, e) => s + e.amount, 0);
  const firstNeg = all.find((e) => e.balance < 0);

  let banners = '';
  if (firstNeg) {
    banners += banner('err', t('home.negative', { date: fmtDate(firstNeg.date), amount: fmtMoney(firstNeg.balance) }));
  }
  if (!S.entries.length && !S.biz.startBalance) {
    banners += banner('ok', t('home.startHint'), `<button class="btn small" data-act="nav:settings">${t('home.startHintBtn')}</button>`);
  }
  const lastExport = S.settings.lastExport?.[S.biz.id];
  const lastChange = S.settings.lastChange?.[S.biz.id];
  if (S.entries.length && (!lastExport || (lastChange > lastExport && Date.now() - lastExport > 7 * 86400000))) {
    banners += banner('warn', lastExport ? t('home.backupOld') : t('home.backupNone'),
      `<button class="btn small" data-act="nav:export">${t('home.backupNow')}</button>`);
  }

  const act = (a, ic, label, cls = '') => `<button class="act ${cls}" data-act="${a}">${icon(ic)}<span>${label}</span></button>`;
  const actions = [
    act('receipt-camera', 'camera', t('act.camera'), 'primary wide'),
    act('receipt-gallery', 'image', t('act.gallery')),
    act('new:takings', 'cash', t('act.takings')),
    act('new:tips', 'coins', t('act.tips')),
    act('salary', 'users', t('act.salary')),
    act('new:cashIn', 'in', t('act.cashIn')),
    act('new:cashOut', 'out', t('act.cashOut')),
    act('new:manual', 'pencil', t('act.manual')),
  ].join('');

  // Liste: neueste Tage oben, innerhalb des Tages in Buchungsreihenfolge.
  const days = [];
  for (const e of monthList) {
    let d = days.find((x) => x.date === e.date);
    if (!d) { d = { date: e.date, items: [] }; days.push(d); }
    d.items.push(e);
  }
  days.reverse();
  const list = days.length ? days.map((d) => `
  <section class="day">
    <div class="day-head"><span>${esc(fmtDay(d.date))}</span><span class="muted">${t('home.dayBalance')} ${fmtMoney(d.items[d.items.length - 1].balance)}</span></div>
    <div class="card list">${d.items.map(rowView).join('')}</div>
  </section>`).join('') : `<p class="empty">${t('home.emptyMonth')}</p>`;

  return `
<section class="balance card ${balance < 0 ? 'neg' : ''}">
  <span class="label">${t('home.balance')}</span>
  <span class="amount">${fmtMoney(balance)}</span>
</section>
${banners}
<section class="actions">${actions}</section>
<section class="month">
  <div class="month-nav">
    <button class="icon-btn" data-act="month:-1" aria-label="${esc(t('home.prevMonth'))}">${icon('left')}</button>
    <h2>${esc(fmtMonth(S.month))}</h2>
    <button class="icon-btn" data-act="month:1" aria-label="${esc(t('home.nextMonth'))}">${icon('right')}</button>
  </div>
  <div class="stats">
    <div><span class="muted">${t('home.in')}</span><b class="in">${fmtMoney(inSum)}</b></div>
    <div><span class="muted">${t('home.out')}</span><b class="out">${fmtMoney(outSum)}</b></div>
    ${tipsSum ? `<div><span class="muted">${t('home.tips')}</span><b>${fmtMoney(tipsSum)}</b></div>` : ''}
  </div>
</section>
${list}`;
}

function rowView(e) {
  const sub = [e.desc, e.ref ? `${t('home.refShort')} ${e.ref}` : ''].filter(Boolean).join(' · ');
  return `<button class="row" data-act="edit:${esc(e.id)}">
  <span class="row-main"><span class="row-title">${esc(e.party || t('kind.' + e.kind))}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
  <span class="row-amt ${e.dir}">${e.dir === 'out' ? '−' : '+'}${fmtMoney(e.amount)}${e.balance < 0 ? `<span class="row-neg">${fmtMoney(e.balance)}</span>` : ''}</span>
</button>`;
}

function viewExport() {
  const years = yearsOf(S.biz, S.entries);
  if (!years.length) years.push(new Date().getFullYear());
  if (!S.exportYear || !years.includes(S.exportYear)) S.exportYear = years[0];
  const info = yearInfo(S.biz, S.entries, S.exportYear);
  const lastExport = S.settings.lastExport?.[S.biz.id];
  const monthsText = info.first ? `${MONTHS_DE[info.first - 1]} ${t('export.to')} ${MONTHS_DE[info.last - 1]}` : t('export.noMonths');
  return `
<h1 class="page-title">${t('export.title')}</h1>
<section class="card pad">
  <label class="field"><span class="lbl">${t('export.year')}</span>
    <select data-set-ui="exportYear">${years.map((y) => `<option value="${y}" ${y === S.exportYear ? 'selected' : ''}>${y}</option>`).join('')}</select>
  </label>
  <dl class="facts">
    <div><dt>${t('export.months')}</dt><dd>${esc(monthsText)}</dd></div>
    <div><dt>${t('export.count')}</dt><dd>${info.count}</dd></div>
    <div><dt>${t('export.carry')}</dt><dd>${fmtMoney(info.carry)}</dd></div>
    <div><dt>${t('export.end')}</dt><dd>${fmtMoney(info.end)}</dd></div>
  </dl>
  <button class="btn primary block" data-act="export-run" ${S.busy ? 'disabled' : ''}>${icon('download')}<span>${S.busy ? t('export.busy') : t('export.run')}</span></button>
  <p class="hint">${t('export.hint')}</p>
  ${lastExport ? `<p class="hint">${t('export.last', { date: new Date(lastExport).toLocaleString(getLang() === 'de' ? 'de-AT' : 'en-GB') })}</p>` : ''}
</section>
<section class="card pad">
  <h2 class="sec-title">${t('backup.title')}</h2>
  <p class="hint">${t('backup.text')}</p>
  <button class="btn block" data-act="backup-import">${icon('upload')}<span>${t('backup.import')}</span></button>
</section>`;
}

function viewSettings() {
  const b = S.biz;
  const hasKey = !!S.settings.apiKey;
  return `
<h1 class="page-title">${t('set.title')}</h1>

<section class="card pad">
  <h2 class="sec-title">${t('set.business')}</h2>
  <label class="field"><span class="lbl">${t('f.bizName')}</span><input type="text" data-set="name" value="${esc(b.name)}"></label>
  <p class="hint">${t('set.branchInfo', { branch: t('tpl.' + b.template) })}</p>
  <div class="grid2">
    <label class="field"><span class="lbl">${t('f.startBalance')}</span><div class="money"><input type="text" inputmode="decimal" data-set="startBalance" value="${esc(fmtAmountInput(b.startBalance))}"><span>€</span></div></label>
    <label class="field"><span class="lbl">${t('f.startDate')}</span><input type="date" data-set="startDate" value="${esc(b.startDate || '')}"></label>
  </div>
  <p class="hint">${t('set.startHint')}</p>
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.categories')}</h2>
  <div class="chips">${b.categories.map((c, i) => `<span class="chip">${esc(c)}<button data-act="cat-del:${i}" aria-label="${esc(t('delete'))} ${esc(c)}">${icon('x')}</button></span>`).join('')}</div>
  <div class="inline-add"><input type="text" id="cat-new" placeholder="${esc(t('set.catNew'))}"><button class="btn" data-act="cat-add">${icon('plus')}<span>${t('add')}</span></button></div>
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.suppliers')}</h2>
  ${learnedSuppliers().length ? `<div class="card list inner">${learnedSuppliers().map((s) => `
    <div class="row static"><span class="row-main"><span class="row-title">${esc(s.name)}</span>${s.cat ? `<span class="row-sub">${esc(s.cat)}</span>` : ''}</span>
    <button class="icon-btn" data-act="sup-del:${esc(s.name)}" aria-label="${esc(t('delete'))} ${esc(s.name)}">${icon('trash')}</button></div>`).join('')}</div>
  <p class="hint">${t('set.suppliersHint')}</p>` : `<p class="hint">${t('set.noSuppliers')}</p>`}
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.partners')}</h2>
  ${(b.partners || []).length ? `<div class="chips">${b.partners.map((p, i) => `<span class="chip">${esc(p)}<button data-act="partner-del:${i}" aria-label="${esc(t('delete'))} ${esc(p)}">${icon('x')}</button></span>`).join('')}</div>` : `<p class="hint">${t('set.noPartners')}</p>`}
  <div class="inline-add"><input type="text" id="partner-new" placeholder="${esc(t('f.partnerPh'))}" autocomplete="off"><button class="btn" data-act="partner-add">${icon('plus')}<span>${t('add')}</span></button></div>
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.employees')}</h2>
  ${b.employees.length ? `<div class="card list inner">${b.employees.map((e) => `
    <div class="row static"><span class="row-main"><span class="row-title">${esc(e.name)}</span>${e.last ? `<span class="row-sub">${t('set.lastSalary')} ${fmtMoney(e.last)}</span>` : ''}</span>
    <button class="icon-btn" data-act="emp-del:${esc(e.id)}" aria-label="${esc(t('delete'))} ${esc(e.name)}">${icon('trash')}</button></div>`).join('')}</div>` : `<p class="hint">${t('set.noEmployees')}</p>`}
  ${employeeInputs('emp', 'emp-add')}
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.ocr')}</h2>
  ${hasKey ? banner('ok', t('set.ocrClaude')) : banner('warn', t('set.ocrOffline'))}
  <label class="field"><span class="lbl">${t('set.apiKey')}</span><input type="password" id="api-key" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." value="${esc(S.settings.apiKey)}"></label>
  <div class="btn-row">
    <button class="btn primary" data-act="key-save">${t('set.keySave')}</button>
    ${hasKey ? `<button class="btn" data-act="key-clear">${t('set.keyClear')}</button>` : ''}
  </div>
  <label class="field"><span class="lbl">${t('set.model')}</span>
    <select data-set-global="model">${ocr.MODELS.map((m) => `<option value="${m.id}" ${m.id === S.settings.model ? 'selected' : ''}>${m.label} · ${esc(t(m.noteKey))}</option>`).join('')}</select>
  </label>
  <p class="hint">${t('set.keyHint')}</p>
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.language')}</h2>
  <div class="seg">
    <button class="${getLang() === 'de' ? 'on' : ''}" data-act="lang:de">Deutsch</button>
    <button class="${getLang() === 'en' ? 'on' : ''}" data-act="lang:en">English</button>
  </div>
</section>

<section class="card pad">
  <h2 class="sec-title">${t('set.businesses')}</h2>
  <div class="btn-row">
    <button class="btn" data-act="biz-pick">${t('set.bizSwitch')}</button>
    <button class="btn danger" data-act="biz-delete">${icon('trash')}<span>${t('set.bizDelete')}</span></button>
  </div>
</section>

<p class="about">${t('set.about', { v: APP_VERSION })}</p>`;
}

function bizFormFields(prefix) {
  const opts = BRANCHES.map((id) => `<option value="${id}">${esc(t('tpl.' + id))}</option>`).join('');
  return `
  <label class="field"><span class="lbl">${t('f.bizName')}</span><input type="text" id="${prefix}-name" autocomplete="organization"></label>
  <label class="field"><span class="lbl">${t('f.template')}</span><select id="${prefix}-tpl"><option value="" selected disabled>${esc(t('f.templatePick'))}</option>${opts}</select></label>
  <p class="hint">${t('hint.branch')}</p>`;
}

function readBizForm(prefix) {
  const name = document.getElementById(`${prefix}-name`).value.trim();
  const template = document.getElementById(`${prefix}-tpl`).value;
  if (!name) { showToast(t('err.bizName'), 'err'); return null; }
  if (!template) { showToast(t('err.branch'), 'err'); return null; }
  // Anfangsbestand und Beginn lassen sich danach in den Einstellungen setzen.
  return { name, template, startBalance: 0, startDate: `${todayISO().slice(0, 8)}01` };
}

function viewOnboarding() {
  return `<main class="main onboarding">
  <div class="brand">${icon('book')}<h1>${t('app.name')}</h1><p>${t('onb.tagline')}</p></div>
  <div class="seg center">
    <button class="${getLang() === 'de' ? 'on' : ''}" data-act="lang:de">Deutsch</button>
    <button class="${getLang() === 'en' ? 'on' : ''}" data-act="lang:en">English</button>
  </div>
  <section class="card pad">
    <h2 class="sec-title">${t('onb.first')}</h2>
    ${bizFormFields('onb')}
    <button class="btn primary block" data-act="onb-create">${t('onb.create')}</button>
  </section>
  <button class="btn ghost block" data-act="backup-import">${icon('upload')}<span>${t('onb.restore')}</span></button>
</main>`;
}

// ---------- Modals ----------

function viewModal() {
  const m = S.modal;
  let title = '';
  let body = '';
  let foot = '';
  if (m.type === 'entry') {
    title = t(m.editId ? 'modal.edit' : 'modal.new.' + m.kind) + (m.queuePos ? ` (${m.queuePos})` : '');
    body = entryBody(m);
    foot = `${m.editId ? `<button class="btn danger" data-act="entry-del">${icon('trash')}<span>${t('delete')}</span></button>` : ''}
      <button class="btn primary grow" data-act="entry-save">${t('save')}</button>`;
  } else if (m.type === 'salary') {
    title = t('salary.title');
    body = salaryBody(m);
    const n = m.rows.filter((r) => r.on && parseAmount(r.amount) > 0).length;
    foot = `<button class="btn primary grow" data-act="salary-save" ${n ? '' : 'disabled'}>${t('salary.book', { n })}</button>`;
  } else if (m.type === 'crop') {
    title = t('crop.title') + (m.queuePos ? ` (${m.queuePos})` : '');
    body = m.preview
      ? `<p class="hint">${t('crop.hint')}</p>
<div class="crop-wrap" id="crop-wrap"><img src="${m.preview}" id="crop-img" alt="${esc(t('ocr.photo'))}" draggable="false">
<div class="crop-box" id="crop-box" style="${cropStyle(m.rect)}"><span class="crop-h" data-h="tl"></span><span class="crop-h" data-h="tr"></span><span class="crop-h" data-h="bl"></span><span class="crop-h" data-h="br"></span></div></div>
<label class="switch"><input type="checkbox" id="crop-again"><span>${t('crop.again')}</span></label>`
      : `<div class="ocr run"><span class="spinner"></span><span>${t('crop.loading')}</span></div>`;
    foot = `<button class="btn" data-act="crop-whole" ${m.preview ? '' : 'disabled'}>${t('crop.whole')}</button>
      <button class="btn primary grow" data-act="crop-use" ${m.preview ? '' : 'disabled'}>${icon('check')}<span>${t('crop.use')}</span></button>`;
  } else if (m.type === 'bizPick') {
    title = t('biz.title');
    body = `<div class="card list">${S.businesses.map((b) => `<button class="row" data-act="biz-select:${esc(b.id)}"><span class="row-main"><span class="row-title">${esc(b.name)}</span><span class="row-sub">${t('tpl.' + b.template)}</span></span>${b.id === S.biz?.id ? icon('check', 'ok') : ''}</button>`).join('')}</div>`;
    foot = `<button class="btn primary grow" data-act="biz-new">${icon('plus')}<span>${t('biz.new')}</span></button>`;
  } else if (m.type === 'bizNew') {
    title = t('biz.new');
    body = bizFormFields('nb');
    foot = `<button class="btn primary grow" data-act="biz-create">${t('onb.create')}</button>`;
  }
  return `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
  <div class="sheet-head"><button class="icon-btn" data-act="modal-close" aria-label="${esc(t('close'))}">${icon('x')}</button><h2>${esc(title)}</h2><span class="spacer"></span></div>
  <div class="sheet-body">${body}</div>
  <div class="sheet-foot">${foot}</div>
</div></div>`;
}

const field = (label, inner, hint = '') => `<label class="field"><span class="lbl">${label}</span>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
const inDate = (d) => field(t('f.date'), `<input type="date" data-f="date" value="${esc(d.date)}" required>`);
const inMoney = (d, label = t('f.amount'), key = 'amount') => field(label, `<div class="money"><input type="text" inputmode="decimal" data-f="${key}" value="${esc(d[key])}" placeholder="0,00" autocomplete="off"><span>€</span></div>`);
const inText = (d, key, label, attrs = '') => field(label, `<input type="text" data-f="${key}" value="${esc(d[key])}" autocomplete="off" ${attrs}>`);

function catSelect(value) {
  const cats = [...S.biz.categories];
  if (value && !cats.includes(value)) cats.push(value);
  return `<select data-f="desc">${cats.map((c) => `<option ${c === value ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">${esc(t('cat.new'))}</option></select>`;
}

function ocrBox(o) {
  if (!o) return '';
  const parts = [];
  if (o.status === 'running') {
    parts.push(`<div class="ocr run"><span class="spinner"></span><span>${t(o.offline ? 'ocr.runningOffline' : 'ocr.running')} <span id="ocr-progress"></span></span></div>`);
  } else if (o.status === 'claude' || o.status === 'offline') {
    // Immer sichtbar, sobald Daten aus dem Foto vorliegen.
    parts.push(`<div class="ocr warn">${icon('alert')}<span>${t(o.status === 'claude' ? 'ocr.doneClaude' : 'ocr.doneOffline')} ${t('ocr.check')}</span></div>`);
    if (o.known) parts.push(`<div class="ocr info">${icon('check')}<span>${esc(t('ocr.known', { name: o.known }))}</span></div>`);
  } else if (o.status === 'error') {
    parts.push(`<div class="ocr err">${icon('alert')}<span>${esc(o.msg || t('ocr.failed'))}</span></div>`);
  }
  if (o.multi) parts.push(`<div class="ocr info">${icon('image')}<span>${esc(o.multi)}</span></div>`);
  if (o.note) parts.push(`<div class="ocr warn">${icon('alert')}<span>${esc(o.note)}</span></div>`);
  if (o.notReceipt) parts.push(`<div class="ocr warn">${icon('alert')}<span>${t('ocr.notReceipt')}</span></div>`);
  if (o.payment === 'karte') parts.push(`<div class="ocr info">${icon('cash')}<span>${t('ocr.card')}</span></div>`);
  if (o.tip) parts.push(`<div class="ocr info">${icon('camera')}<span>${t('ocr.photoTip')}</span></div>`);
  return parts.join('');
}

function entryBody(m) {
  const d = m.data;
  const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
  switch (m.kind) {
    case 'receipt':
      return `${m.preview ? `<div class="rc-preview"><img src="${m.preview}" alt="${esc(t('ocr.photo'))}"></div>` : ''}
${ocrBox(m.ocr)}
${inDate(d)}
${inText(d, 'party', t('f.supplier'), 'list="dl-sup"')}${datalist('dl-sup', suppliersList())}
<div class="chips pick" id="sup-chips">${supplierChips(d.party)}</div>
${field(t('f.category'), catSelect(d.desc))}
${inText(d, 'ref', t('f.ref'))}
${inMoney(d, t('f.amountGross'))}`;
    case 'takings':
      return `${inDate(d)}${inMoney(d, t('f.takings'))}<p class="hint">${t('hint.takings')}</p>`;
    case 'tips': {
      const total = d.parts.reduce((s, p) => s + (parseAmount(p) || 0), 0);
      return `${inDate(d)}
<fieldset class="field"><legend class="lbl">${t('f.tipsParts')}</legend>
${d.parts.map((p, i) => `<div class="part"><div class="money"><input type="text" inputmode="decimal" data-part="${i}" value="${esc(p)}" placeholder="0,00" autocomplete="off"><span>€</span></div>${d.parts.length > 1 ? `<button class="icon-btn" data-act="tips-rm:${i}" aria-label="${esc(t('delete'))}">${icon('x')}</button>` : ''}</div>`).join('')}
<button class="btn ghost small" data-act="tips-add">${icon('plus')}<span>${t('tips.addPart')}</span></button>
</fieldset>
<div class="total"><span>${t('tips.total')}</span><b id="tips-total">${fmtMoney(total)}</b></div>
<p class="hint">${t('hint.tips')}</p>`;
    }
    case 'cashIn':
    case 'cashOut': {
      const types = m.kind === 'cashIn' ? CASH_IN : CASH_OUT;
      const who = (cashType(m.kind, d.sub) || {}).who;
      let partyField;
      if (who === 'partner') {
        const names = partnerNames();
        const chips = names.length ? `<div class="chips pick">${names.map((n) => `<button type="button" class="chip-btn ${n === d.party ? 'on' : ''}" data-act="pick-party:${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
        partyField = `${inText(d, 'party', t('f.partner'), 'list="dl-party"')}${datalist('dl-party', names)}${chips}`;
      } else {
        const label = who === 'bank' ? t('f.bank') : (m.kind === 'cashIn' ? t('f.from') : t('f.to'));
        partyField = `${inText(d, 'party', label, 'list="dl-party"')}${datalist('dl-party', partiesOf(m.kind, d.sub))}`;
      }
      return `${field(t('f.type'), `<select data-f="sub">${types.map((x) => `<option value="${x.id}" ${x.id === d.sub ? 'selected' : ''}>${esc(x[getLang()] || x.de)}</option>`).join('')}</select>`)}
${partyField}
${inDate(d)}
${inText(d, 'desc', t('f.desc'))}
${inMoney(d)}`;
    }
    case 'manual':
      return `<div class="seg" role="radiogroup">
  <button class="${d.dir === 'out' ? 'on' : ''}" data-act="dir:out">${t('dir.out')}</button>
  <button class="${d.dir === 'in' ? 'on' : ''}" data-act="dir:in">${t('dir.in')}</button>
</div>
${inDate(d)}
${inText(d, 'party', t('f.party'), 'list="dl-sup"')}${datalist('dl-sup', suppliersList())}
<div class="chips pick" id="sup-chips">${supplierChips(d.party)}</div>
${inText(d, 'desc', t('f.desc'), 'list="dl-cat"')}${datalist('dl-cat', S.biz.categories)}
${inText(d, 'ref', t('f.ref'))}
${inMoney(d)}`;
    default: // salary und andere beim Bearbeiten
      return `${inDate(d)}${inText(d, 'party', t('f.party'))}${inText(d, 'desc', t('f.desc'))}${inMoney(d)}`;
  }
}

function salaryBody(m) {
  const now = todayISO().slice(0, 7);
  const months = [];
  for (let i = -12; i <= 3; i++) months.push(shiftMonth(now, i));
  if (!months.includes(m.month)) months.unshift(m.month);
  const opts = months.reverse().map((ym) => `<option value="${ym}" ${ym === m.month ? 'selected' : ''}>${esc(salaryMonthLabel(ym))}</option>`).join('');
  const total = m.rows.filter((r) => r.on).reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
  return `<div class="grid2">
  ${field(t('f.bookingDate'), `<input type="date" data-sal="date" value="${esc(m.date)}">`)}
  ${field(t('f.salaryMonth'), `<select data-sal="month">${opts}</select>`)}
</div>
${m.rows.length ? `<div class="card list inner">${m.rows.map((r, i) => `
  <div class="row static sal">
    <label class="sal-name"><input type="checkbox" data-salrow="${i}" data-k="on" ${r.on ? 'checked' : ''}><span>${esc(r.name)}</span></label>
    <div class="money"><input type="text" inputmode="decimal" data-salrow="${i}" data-k="amount" value="${esc(r.amount)}" placeholder="0,00" autocomplete="off"><span>€</span></div>
  </div>`).join('')}</div>
<div class="total"><span>${t('salary.total')}</span><b id="sal-total">${fmtMoney(total)}</b></div>` : `<p class="hint">${t('salary.none')}</p>`}
${employeeInputs('sal', 'salary-addemp')}`;
}

// Neuer Mitarbeiter: Nachname (wird automatisch groß geschrieben) und Vorname, gespeichert wie im Kassabuch als "NACHNAME, Vorname".
function employeeInputs(prefix, act) {
  return `<fieldset class="field emp-add"><legend class="lbl">${t('emp.new')}</legend>
  <div class="grid2">
    <input type="text" id="${prefix}-last" data-upper autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="${esc(t('f.lastName'))}" aria-label="${esc(t('f.lastName'))}">
    <input type="text" id="${prefix}-first" autocapitalize="words" autocomplete="off" spellcheck="false" placeholder="${esc(t('f.firstName'))}" aria-label="${esc(t('f.firstName'))}">
  </div>
  <button class="btn block" data-act="${act}">${icon('plus')}<span>${t('emp.add')}</span></button>
</fieldset>`;
}

function readEmployee(prefix) {
  const last = document.getElementById(`${prefix}-last`).value.trim().toLocaleUpperCase('de-AT');
  const first = document.getElementById(`${prefix}-first`).value.trim();
  if (!last) { showToast(t('err.lastName'), 'err'); return null; }
  const name = first ? `${last}, ${first}` : last;
  if (S.biz.employees.some((e) => e.name === name)) { showToast(t('err.empExists'), 'err'); return null; }
  return name;
}

// Übernimmt die aktuellen Eingaben aus dem Formular in S.modal.data.
function syncModal() {
  const m = S.modal;
  const root = document.getElementById('modal-root');
  if (!m || !root) return;
  if (m.type === 'entry') {
    root.querySelectorAll('[data-f]').forEach((el) => { m.data[el.dataset.f] = el.value; });
    root.querySelectorAll('[data-part]').forEach((el) => { m.data.parts[Number(el.dataset.part)] = el.value; });
  } else if (m.type === 'salary') {
    root.querySelectorAll('[data-sal]').forEach((el) => {
      m[el.dataset.sal] = el.value;
    });
    root.querySelectorAll('[data-salrow]').forEach((el) => {
      const r = m.rows[Number(el.dataset.salrow)];
      if (el.dataset.k === 'on') r.on = el.checked; else r.amount = el.value;
    });
  }
}

function openEntry(kind, preset = {}) {
  const base = { date: todayISO(), party: '', desc: '', ref: '', amount: '', dir: 'out', sub: '', parts: [''] };
  if (kind === 'receipt') base.desc = S.biz.categories[0] || '';
  if (kind === 'cashIn') { base.sub = CASH_IN[0].id; base.desc = CASH_IN[0].desc; }
  if (kind === 'cashOut') { base.sub = CASH_OUT[0].id; base.desc = CASH_OUT[0].desc; }
  S.modal = { type: 'entry', kind, data: { ...base, ...preset }, touched: new Set(), token: uid() };
  render();
  focusFirst();
}

function focusFirst() {
  // Auf dem Handy nicht automatisch die Tastatur öffnen.
  if (window.matchMedia('(pointer: fine)').matches) {
    const el = document.querySelector('#modal-root [data-f="amount"], #modal-root [data-part="0"]');
    if (el) el.focus();
  }
}

function openEdit(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  const data = {
    date: e.date, party: e.party || '', desc: e.desc || '', ref: e.ref || '',
    amount: fmtAmountInput(e.amount), dir: e.dir, sub: e.sub || '',
    parts: e.parts && e.parts.length > 1 ? e.parts.map(fmtAmountInput) : [fmtAmountInput(e.amount)],
  };
  S.modal = { type: 'entry', kind: e.kind, data, touched: new Set(['date', 'party', 'desc', 'ref', 'amount']), editId: e.id, created: e.created, token: uid() };
  render();
}

function closeModal() {
  S.modal = null;
  renderModal();
}

// ---------- Belege ----------

function addFiles(fileList) {
  const files = [...fileList].filter((f) => (f.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!files.length) return;
  if (!S.queue.length && !(S.modal && S.modal.kind === 'receipt')) { S.queueTotal = 0; S.queueDone = 0; }
  S.queue.push(...files);
  S.queueTotal += files.length;
  if (!S.modal) processNext();
}

// Warteschlange: Fotos (File) oder bereits erkannte weitere Belege desselben Fotos.
async function processNext() {
  const file = S.queue.shift();
  if (!file) return;
  S.queueDone++;
  if (!file.recognized) {
    openCrop(file);
    return;
  }
  // Weiterer von Claude erkannter Beleg desselben Fotos: direkt ins Formular.
  openEntry('receipt');
  const m = S.modal;
  m.queuePos = S.queueTotal > 1 ? `${S.queueDone}/${S.queueTotal}` : '';
  m.preview = file.preview;
  applyRecognition(m, file.recognized);
  m.ocr = { status: 'claude', payment: file.recognized.payment, multi: file.multi };
  renderModal();
}

// ---------- Zuschneiden ----------

const cropStyle = (r) => `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;

async function openCrop(file) {
  const token = uid();
  S.modal = {
    type: 'crop', token, file, rect: { x: 0.04, y: 0.03, w: 0.92, h: 0.94 }, preview: null,
    queuePos: S.queueTotal > 1 ? `${S.queueDone}/${S.queueTotal}` : '',
  };
  render();
  try {
    const d = await decodeForCrop(file);
    if (!S.modal || S.modal.token !== token) return;
    S.modal.src = d.src;
    S.modal.preview = d.preview;
    renderModal();
  } catch {
    showToast(t('ocr.err.image'), 'err');
    S.modal = null;
    render();
    processNext();
  }
}

async function useCrop(whole) {
  const m = S.modal;
  if (!m || m.type !== 'crop' || !m.src) return;
  const again = document.getElementById('crop-again')?.checked;
  const blob = whole ? m.file : await cropToBlob(m.src, m.rect);
  if (again) {
    // Dasselbe Foto danach noch einmal zum Zuschneiden des nächsten Belegs.
    S.queue.unshift(m.file);
    S.queueTotal++;
  }
  recognizePhoto(blob, m.queuePos);
}

let cropDrag = null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

document.addEventListener('pointerdown', (ev) => {
  const box = ev.target.closest && ev.target.closest('#crop-box');
  if (!box || !S.modal || S.modal.type !== 'crop') return;
  ev.preventDefault();
  cropDrag = {
    handle: ev.target.dataset.h || 'move', x0: ev.clientX, y0: ev.clientY,
    start: { ...S.modal.rect }, img: document.getElementById('crop-img').getBoundingClientRect(),
  };
  if (box.setPointerCapture) box.setPointerCapture(ev.pointerId);
});

document.addEventListener('pointermove', (ev) => {
  if (!cropDrag || !S.modal || S.modal.type !== 'crop') return;
  ev.preventDefault();
  const { img, start, handle } = cropDrag;
  const dx = (ev.clientX - cropDrag.x0) / img.width;
  const dy = (ev.clientY - cropDrag.y0) / img.height;
  const MIN = 0.08;
  let { x, y, w, h } = start;
  if (handle === 'move') {
    x = clamp(x + dx, 0, 1 - w);
    y = clamp(y + dy, 0, 1 - h);
  } else {
    if (handle.includes('l')) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx; }
    if (handle.includes('r')) w = clamp(w + dx, MIN, 1 - x);
    if (handle.includes('t')) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny; }
    if (handle.includes('b')) h = clamp(h + dy, MIN, 1 - y);
  }
  S.modal.rect = { x, y, w, h };
  const box = document.getElementById('crop-box');
  if (box) box.setAttribute('style', cropStyle(S.modal.rect));
}, { passive: false });

const endDrag = () => { cropDrag = null; };
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// ---------- Erkennung eines (zugeschnittenen) Fotos ----------

async function recognizePhoto(file, queuePos = '') {
  openEntry('receipt');
  const m = S.modal;
  m.ocr = { status: 'running', offline: !S.settings.apiKey };
  m.queuePos = queuePos;
  renderModal();
  const token = m.token;
  const alive = () => S.modal && S.modal.token === token;

  let img;
  try {
    img = await prepareImage(file);
  } catch {
    if (alive()) { m.ocr = { status: 'error', msg: t('ocr.err.image') }; syncModal(); renderModal(); }
    return;
  }
  if (!alive()) return;
  syncModal();
  m.preview = img.thumb;
  renderModal();

  let res = null;
  let note = '';
  let multi = '';
  if (S.settings.apiKey) {
    try {
      const list = await ocr.recognizeWithClaude({ apiKey: S.settings.apiKey, model: S.settings.model, base64: img.base64, biz: S.biz });
      if (!list.length) {
        res = { source: 'claude', isReceipt: false, supplier: '', date: null, ref: '', amount: null, category: null, payment: 'unbekannt' };
      } else {
        res = list[0];
        if (list.length > 1) {
          // Weitere Belege auf demselben Foto: direkt danach je ein eigenes Formular, ohne neue Erkennung.
          multi = t('ocr.multi', { n: list.length });
          S.queue.unshift(...list.slice(1).map((r, i) => ({ recognized: r, preview: img.thumb, multi: t('ocr.multiPos', { i: i + 2, n: list.length }) })));
          S.queueTotal += list.length - 1;
        }
      }
    } catch (err) {
      console.warn('Claude-Erkennung fehlgeschlagen', err);
      note = t('ocr.fellBack', { reason: await ocr.explainError(err) });
      if (alive()) { syncModal(); m.ocr = { status: 'running', offline: true, note }; renderModal(); }
    }
  }
  if (!res) {
    try {
      res = await ocr.recognizeOffline(img.ocrCanvas, S.biz, (p) => {
        const el = alive() && document.getElementById('ocr-progress');
        if (el) el.textContent = `${Math.round(p * 100)} %`;
      }, img.ocrCanvasAlt);
    } catch (err) {
      console.warn('Offline-Erkennung fehlgeschlagen', err);
      if (alive()) { syncModal(); m.ocr = { status: 'error', msg: err.message || t('ocr.failed'), note }; renderModal(); }
      return;
    }
  }
  if (!alive()) return;
  syncModal();
  applyRecognition(m, res);
  m.queuePos = S.queueTotal > 1 ? `${S.queueDone}/${S.queueTotal}` : '';
  m.ocr = { status: res.source, note, payment: res.payment, notReceipt: !res.isReceipt, multi, tip: res.source === 'offline', known: res.known };
  renderModal();
}

function applyRecognition(m, res) {
  const d = m.data;
  const free = (k) => !m.touched.has(k);
  m.ocrSupplier = res.supplier || '';
  m.ocrText = res.text || '';
  const sug = res.supplier ? suggest(S.biz, res.supplier) : null;
  if (free('party') && res.supplier) d.party = (sug && sug.name) || res.supplier;
  if (free('date') && res.date) d.date = res.date;
  if (free('ref') && res.ref) d.ref = res.ref;
  if (free('amount') && res.amount) d.amount = fmtAmountInput(res.amount);
  if (free('desc')) {
    const cat = (sug && sug.learned && sug.cat) || res.category || (sug && sug.cat);
    if (cat) d.desc = cat;
  }
}

// ---------- Speichern ----------

function checkWarnings(newEntries, replacedIds = []) {
  const warns = [];
  const others = S.entries.filter((x) => !replacedIds.includes(x.id));
  const list = withBalances(S.biz, [...others, ...newEntries]);
  if (newEntries.some((e) => e.dir === 'out')) {
    const ids = new Set(newEntries.map((e) => e.id));
    const start = list.findIndex((x) => ids.has(x.id));
    const neg = list.slice(start).find((x) => x.balance < 0);
    if (neg) warns.push(t('warn.negative', { date: fmtDate(neg.date), amount: fmtMoney(neg.balance) }));
  }
  return warns;
}

async function saveEntry() {
  syncModal();
  const m = S.modal;
  const d = m.data;
  const kind = m.kind;
  const amount = kind === 'tips' ? d.parts.reduce((s, p) => s + (parseAmount(p) || 0), 0) : parseAmount(d.amount);
  if (!d.date) return showToast(t('err.date'), 'err');
  if (kind === 'tips' && d.parts.some((p) => p.trim() && parseAmount(p) === null)) return showToast(t('err.amountFormat'), 'err');
  if (amount === null && String(d.amount || '').trim()) return showToast(t('err.amountFormat'), 'err');
  if (!amount || amount <= 0) return showToast(t('err.amount'), 'err');

  const e = { id: m.editId || uid(), bizId: S.biz.id, kind, date: d.date, amount, created: m.created || Date.now() };
  switch (kind) {
    case 'receipt':
      if (!d.party.trim()) return showToast(t('err.supplier'), 'err');
      Object.assign(e, { party: d.party.trim(), desc: d.desc, ref: d.ref.trim(), dir: 'out' });
      break;
    case 'takings':
      Object.assign(e, { party: BOOK.takings, desc: BOOK.takingsDesc, dir: 'in' });
      break;
    case 'tips': {
      const parts = d.parts.map(parseAmount).filter((x) => x > 0);
      Object.assign(e, { party: BOOK.tips, desc: '', dir: 'out' });
      if (parts.length > 1) e.parts = parts;
      break;
    }
    case 'cashIn':
    case 'cashOut':
      if (!d.party.trim()) return showToast(t('err.party'), 'err');
      Object.assign(e, { sub: d.sub, party: d.party.trim(), desc: d.desc.trim(), dir: kind === 'cashIn' ? 'in' : 'out' });
      break;
    default:
      if (!d.party.trim()) return showToast(t('err.party'), 'err');
      Object.assign(e, { party: d.party.trim(), desc: (d.desc || '').trim(), ref: (d.ref || '').trim(), dir: d.dir === 'in' ? 'in' : 'out' });
  }

  const warns = [];
  const others = S.entries.filter((x) => x.id !== e.id);
  if (kind === 'takings' && others.some((x) => x.kind === 'takings' && x.date === e.date)) {
    warns.push(t('warn.takingsDup', { date: fmtDate(e.date) }));
  } else if (others.some((x) => x.kind === kind && x.date === e.date && x.amount === e.amount && x.dir === e.dir
    && (kind !== 'receipt' || normKey(x.party) === normKey(e.party) || (e.ref && x.ref === e.ref)))) {
    warns.push(t('warn.duplicate'));
  }
  warns.push(...checkWarnings([e], [e.id]));
  if (warns.length && !window.confirm(`${warns.join('\n\n')}\n\n${t('warn.saveAnyway')}`)) return;

  await db.put('entries', e);
  S.entries = [...others, e];
  if ((kind === 'cashIn' || kind === 'cashOut') && (cashType(kind, e.sub) || {}).who === 'partner'
    && !(S.biz.partners || []).includes(e.party)) {
    S.biz.partners = [...(S.biz.partners || []), e.party];
    await saveBiz();
  }
  if (kind === 'receipt' || (kind === 'manual' && e.dir === 'out' && S.biz.categories.includes(e.desc))) {
    // Lieferantenprofil: Name, Kategorie, Häufigkeit und was sich aus dem Foto über den Aufbau des Belegs lernen lässt.
    const sup = { ...(S.biz.suppliers || {}) };
    const old = Object.values(sup).find((s) => s.name === e.party) || {};
    const learned = { ...old, name: e.party, cat: e.desc, count: (old.count || 0) + 1 };
    if (kind === 'receipt' && m.ocrText) {
      const l = ocr.learnFromReceipt(m.ocrText, { ref: e.ref, amount: e.amount });
      if (l.refLabel) learned.refLabel = l.refLabel;
      if (l.totalLabel) learned.totalLabel = l.totalLabel;
      if (l.refTail) learned.refTail = l.refTail;
      learned.ids = [...new Set([...(old.ids || []), ...l.ids])].slice(0, 6);
    }
    Object.keys(sup).forEach((k) => { if (sup[k].name === e.party) sup[k] = learned; });
    sup[normKey(e.party)] = learned;
    if (m.ocrSupplier && normKey(m.ocrSupplier) !== normKey(e.party)) sup[normKey(m.ocrSupplier)] = learned;
    S.biz.suppliers = sup;
    await saveBiz();
  }
  db.requestPersistence();
  markChanged();
  S.month = e.date.slice(0, 7);
  S.modal = null;
  render();
  showToast(t(m.editId ? 'toast.updated' : 'toast.saved'), 'ok');
  if (S.queue.length) processNext();
}

async function deleteEntry() {
  const m = S.modal;
  if (!window.confirm(t('confirm.delete'))) return;
  await db.del('entries', m.editId);
  S.entries = S.entries.filter((x) => x.id !== m.editId);
  markChanged();
  S.modal = null;
  render();
  showToast(t('toast.deleted'));
}

function openSalary() {
  S.modal = {
    type: 'salary', date: todayISO(), month: shiftMonth(todayISO().slice(0, 7), -1),
    rows: S.biz.employees.map((e) => ({ id: e.id, name: e.name, amount: e.last ? fmtAmountInput(e.last) : '', on: true })),
  };
  render();
}

async function saveSalary() {
  syncModal();
  const m = S.modal;
  if (!m.date) return showToast(t('err.date'), 'err');
  const bad = m.rows.find((r) => r.on && r.amount.trim() && parseAmount(r.amount) === null);
  if (bad) return showToast(`${t('err.amountFormat')} (${bad.name})`, 'err');
  const rows = m.rows.filter((r) => r.on && parseAmount(r.amount) > 0);
  if (!rows.length) return showToast(t('err.amount'), 'err');
  // Normalfall: Gehalt für den Vormonat. Voraus oder länger zurück nur nach Rückfrage.
  const diff = monthDiff(m.date.slice(0, 7), m.month);
  if (diff >= 0 && !window.confirm(t('salary.future'))) return;
  if (diff < -1 && !window.confirm(t('salary.old', { month: fmtMonth(m.date.slice(0, 7)) }))) return;
  const desc = `${BOOK.salary} ${MONTHS_DE[Number(m.month.slice(5, 7)) - 1]}`;
  const base = Date.now();
  const entries = rows.map((r, i) => ({
    id: uid(), bizId: S.biz.id, kind: 'salary', date: m.date, party: r.name, desc,
    amount: parseAmount(r.amount), dir: 'out', created: base + i,
  }));
  const warns = checkWarnings(entries);
  if (warns.length && !window.confirm(`${warns.join('\n\n')}\n\n${t('warn.saveAnyway')}`)) return;
  await db.putMany('entries', entries);
  S.entries = [...S.entries, ...entries];
  S.biz.employees = S.biz.employees.map((emp) => {
    const r = rows.find((x) => x.id === emp.id);
    return r ? { ...emp, last: parseAmount(r.amount) } : emp;
  });
  await saveBiz();
  db.requestPersistence();
  markChanged();
  S.month = m.date.slice(0, 7);
  S.modal = null;
  render();
  showToast(t('salary.done', { n: entries.length }), 'ok');
}

// ---------- Export und Sicherung ----------

async function runExport() {
  if (S.busy) return;
  S.busy = true;
  render();
  try {
    const { blob, filename } = await exportYear(S.biz, S.entries, S.exportYear);
    const file = new File([blob], filename, { type: XLSX_MIME });
    let shared = false;
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        shared = true;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    S.settings.lastExport = { ...(S.settings.lastExport || {}), [S.biz.id]: Date.now() };
    await saveSettings();
    showToast(t('export.done'), 'ok');
  } catch (err) {
    console.error(err);
    showToast(t('export.failed'), 'err');
  } finally {
    S.busy = false;
    render();
  }
}

async function importBackup(file) {
  let data;
  try {
    data = await readBackup(file);
  } catch (err) {
    console.warn(err);
    showToast(t('backup.none'), 'err');
    return;
  }
  const exists = S.businesses.find((b) => b.id === data.business.id);
  const msg = t(exists ? 'backup.confirmReplace' : 'backup.confirmNew', { name: data.business.name, n: data.entries.length });
  if (!window.confirm(msg)) return;
  const entries = data.entries.map((e) => ({ ...e, bizId: data.business.id }));
  await db.replaceBusiness(data.business, entries);
  S.businesses = exists ? S.businesses.map((b) => (b.id === data.business.id ? data.business : b)) : [...S.businesses, data.business];
  await selectBiz(data.business.id);
  S.settings.lastExport = { ...(S.settings.lastExport || {}), [data.business.id]: Date.now() };
  await saveSettings();
  db.requestPersistence();
  S.view = 'home';
  S.modal = null;
  render();
  showToast(t('backup.done', { n: entries.length }), 'ok');
}

// ---------- Ereignisse ----------

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const [act, arg] = el.dataset.act.split(/:(.*)/s);
  switch (act) {
    case 'nav': S.view = arg; S.modal = null; render(); window.scrollTo(0, 0); break;
    case 'month': S.month = shiftMonth(S.month, Number(arg)); render(); break;
    case 'receipt-camera': document.getElementById('in-camera').click(); break;
    case 'receipt-gallery': document.getElementById('in-gallery').click(); break;
    case 'backup-import': document.getElementById('in-backup').click(); break;
    case 'new': openEntry(arg); break;
    case 'edit': openEdit(arg); break;
    case 'salary': openSalary(); break;
    case 'modal-close':
      if (S.modal && (S.modal.kind === 'receipt' || S.modal.type === 'crop') && S.queue.length) {
        S.modal = null; render(); processNext();
      } else closeModal();
      break;
    case 'entry-save': saveEntry(); break;
    case 'crop-use': useCrop(false); break;
    case 'crop-whole': useCrop(true); break;
    case 'entry-del': deleteEntry(); break;
    case 'dir': syncModal(); S.modal.data.dir = arg; renderModal(); break;
    case 'tips-add': syncModal(); S.modal.data.parts.push(''); renderModal(); document.querySelector(`[data-part="${S.modal.data.parts.length - 1}"]`)?.focus(); break;
    case 'tips-rm': syncModal(); S.modal.data.parts.splice(Number(arg), 1); renderModal(); break;
    case 'salary-save': saveSalary(); break;
    case 'salary-addemp': {
      syncModal();
      const name = readEmployee('sal');
      if (!name) return;
      const emp = { id: uid(), name, last: 0 };
      S.biz.employees = [...S.biz.employees, emp];
      await saveBiz();
      S.modal.rows.push({ id: emp.id, name, amount: '', on: true });
      renderModal();
      break;
    }
    case 'biz-pick': S.modal = { type: 'bizPick' }; render(); break;
    case 'biz-select': await selectBiz(arg); S.modal = null; S.view = 'home'; render(); break;
    case 'biz-new': S.modal = { type: 'bizNew' }; renderModal(); break;
    case 'biz-create':
    case 'onb-create': {
      const f = readBizForm(act === 'onb-create' ? 'onb' : 'nb');
      if (!f) return;
      const biz = createBusiness(f);
      await db.put('businesses', biz);
      S.businesses = [...S.businesses, biz];
      await selectBiz(biz.id);
      db.requestPersistence();
      S.modal = null;
      S.view = 'home';
      S.month = todayISO().slice(0, 7);
      render();
      showToast(t('toast.bizCreated', { name: biz.name }), 'ok');
      break;
    }
    case 'biz-delete': {
      if (!window.confirm(t('confirm.bizDelete', { name: S.biz.name, n: S.entries.length }))) return;
      if (S.entries.length && !window.confirm(t('confirm.bizDelete2'))) return;
      await db.deleteBusiness(S.biz.id);
      S.businesses = S.businesses.filter((b) => b.id !== S.biz.id);
      await selectBiz(S.businesses[0] ? S.businesses[0].id : null);
      S.view = 'home';
      render();
      showToast(t('toast.bizDeleted'));
      break;
    }
    case 'cat-add': {
      const input = document.getElementById('cat-new');
      const name = input.value.trim();
      if (!name || S.biz.categories.includes(name)) return;
      S.biz.categories = [...S.biz.categories, name];
      await saveBiz();
      render();
      break;
    }
    case 'cat-del': {
      if (S.biz.categories.length <= 1) return showToast(t('err.lastCategory'), 'err');
      S.biz.categories = S.biz.categories.filter((_, i) => i !== Number(arg));
      await saveBiz();
      render();
      break;
    }
    case 'pick-sup': {
      syncModal();
      const d = S.modal.data;
      d.party = arg;
      S.modal.touched.add('party');
      const sug = suggest(S.biz, arg);
      if (sug && sug.cat && !S.modal.touched.has('desc') && S.modal.kind === 'receipt') d.desc = sug.cat;
      renderModal();
      break;
    }
    case 'sup-del': {
      if (!window.confirm(t('confirm.supDelete', { name: arg }))) return;
      const sup = { ...(S.biz.suppliers || {}) };
      Object.keys(sup).forEach((k) => { if (sup[k].name === arg) delete sup[k]; });
      S.biz.suppliers = sup;
      await saveBiz();
      render();
      break;
    }
    case 'pick-party':
      syncModal();
      S.modal.data.party = arg;
      S.modal.touched.add('party');
      renderModal();
      break;
    case 'partner-add': {
      const name = document.getElementById('partner-new').value.trim();
      if (!name || (S.biz.partners || []).includes(name)) return;
      S.biz.partners = [...(S.biz.partners || []), name];
      await saveBiz();
      render();
      break;
    }
    case 'partner-del': {
      const name = (S.biz.partners || [])[Number(arg)];
      if (!name || !window.confirm(t('confirm.partnerDelete', { name }))) return;
      S.biz.partners = S.biz.partners.filter((_, i) => i !== Number(arg));
      await saveBiz();
      render();
      break;
    }
    case 'emp-add': {
      const name = readEmployee('emp');
      if (!name) return;
      S.biz.employees = [...S.biz.employees, { id: uid(), name, last: 0 }];
      await saveBiz();
      render();
      break;
    }
    case 'emp-del': {
      const emp = S.biz.employees.find((x) => x.id === arg);
      if (!emp || !window.confirm(t('confirm.empDelete', { name: emp.name }))) return;
      S.biz.employees = S.biz.employees.filter((x) => x.id !== arg);
      await saveBiz();
      render();
      break;
    }
    case 'key-save': {
      const key = document.getElementById('api-key').value.trim();
      if (!key) return;
      el.disabled = true;
      el.textContent = t('set.keyChecking');
      try {
        await ocr.checkKey(key, S.settings.model);
        S.settings.apiKey = key;
        await saveSettings();
        render();
        showToast(t('set.keyOk'), 'ok');
      } catch (err) {
        const why = await ocr.explainError(err);
        render();
        showToast(why, 'err');
      }
      break;
    }
    case 'key-clear':
      S.settings.apiKey = '';
      await saveSettings();
      render();
      break;
    case 'lang':
      setLang(arg);
      S.settings.lang = arg;
      await saveSettings();
      render();
      break;
    case 'export-run': runExport(); break;
    default: break;
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset && el.dataset.upper !== undefined) {
    const before = el.value;
    const pos = el.selectionStart;
    const up = before.toLocaleUpperCase('de-AT');
    if (up !== before) {
      el.value = up;
      // ß wird zu SS und damit länger, daher den Cursor entsprechend verschieben.
      const p = pos + (up.length - before.length);
      try { el.setSelectionRange(p, p); } catch { /* nicht unterstützt */ }
    }
    return;
  }
  const m = S.modal;
  if (!m) return;
  if (m.type === 'entry') {
    if (el.dataset.f) {
      m.touched.add(el.dataset.f);
      m.data[el.dataset.f] = el.value;
      // Kategorie aus dem Lieferanten vorschlagen, solange sie nicht selbst gewählt wurde.
      if (el.dataset.f === 'party') {
        const chips = document.getElementById('sup-chips');
        if (chips) chips.innerHTML = supplierChips(el.value);
      }
      if (el.dataset.f === 'party' && m.kind === 'receipt' && !m.touched.has('desc')) {
        const sug = suggest(S.biz, el.value);
        const sel = document.querySelector('#modal-root [data-f="desc"]');
        if (sug && sug.cat && sel) { sel.value = sug.cat; m.data.desc = sug.cat; }
      }
    }
    if (el.dataset.part !== undefined) {
      m.data.parts[Number(el.dataset.part)] = el.value;
      const total = m.data.parts.reduce((s, p) => s + (parseAmount(p) || 0), 0);
      const out = document.getElementById('tips-total');
      if (out) out.textContent = fmtMoney(total);
    }
  } else if (m.type === 'salary' && el.dataset.salrow !== undefined) {
    syncModal();
    const total = m.rows.filter((r) => r.on).reduce((s, r) => s + (parseAmount(r.amount) || 0), 0);
    const out = document.getElementById('sal-total');
    if (out) out.textContent = fmtMoney(total);
    const n = m.rows.filter((r) => r.on && parseAmount(r.amount) > 0).length;
    const btn = document.querySelector('[data-act="salary-save"]');
    if (btn) { btn.disabled = !n; btn.textContent = t('salary.book', { n }); }
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'in-camera' || el.id === 'in-gallery') {
    addFiles(el.files);
    el.value = '';
    return;
  }
  if (el.id === 'in-backup') {
    const f = el.files[0];
    el.value = '';
    if (f) importBackup(f);
    return;
  }
  const m = S.modal;
  if (m && m.type === 'entry' && el.dataset.f === 'desc' && el.value === '__new') {
    const name = (window.prompt(t('cat.prompt')) || '').trim();
    if (name && !S.biz.categories.includes(name)) {
      S.biz.categories = [...S.biz.categories, name];
      await saveBiz();
    }
    syncModal();
    m.data.desc = name || S.biz.categories[0];
    m.touched.add('desc');
    renderModal();
    return;
  }
  if (m && m.type === 'entry' && el.dataset.f === 'sub') {
    const types = m.kind === 'cashIn' ? CASH_IN : CASH_OUT;
    syncModal();
    const type = types.find((x) => x.id === el.value);
    if (type && !m.touched.has('desc')) m.data.desc = type.desc;
    renderModal();
    return;
  }
  if (m && m.type === 'salary' && el.dataset.k === 'on') {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (el.dataset.set && S.biz) {
    const key = el.dataset.set;
    if (key === 'startBalance') {
      const v = el.value.trim() ? parseAmount(el.value) : 0;
      if (v === null) { showToast(t('err.amountFormat'), 'err'); return; }
      S.biz.startBalance = v;
      markChanged();
    } else if (key === 'name') {
      if (!el.value.trim()) return;
      S.biz.name = el.value.trim();
    } else S.biz[key] = el.value;
    await saveBiz();
    render();
    showToast(t('toast.settingsSaved'), 'ok');
    return;
  }
  if (el.dataset.setGlobal) {
    S.settings[el.dataset.setGlobal] = el.value;
    await saveSettings();
    showToast(t('toast.settingsSaved'), 'ok');
    return;
  }
  if (el.dataset.setUi === 'exportYear') {
    S.exportYear = Number(el.value);
    render();
  }
});

// ---------- Start ----------

async function init() {
  const saved = await db.getMeta('settings');
  if (saved) Object.assign(S.settings, saved);
  else S.settings.lang = (navigator.language || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
  setLang(S.settings.lang);
  S.businesses = (await db.getAll('businesses')).sort((a, b) => a.created - b.created);
  const active = S.businesses.find((b) => b.id === S.settings.activeBiz) || S.businesses[0];
  if (active) await selectBiz(active.id);
  render();
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker', e));
  }
}

init().catch((err) => {
  console.error(err);
  app.innerHTML = `<main class="main"><div class="banner err">${esc(t('err.start'))}<br><small>${esc(err.message)}</small></div></main>`;
});
