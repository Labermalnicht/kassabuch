// Beträge werden intern in Cent (ganze Zahlen) geführt, um Rundungsfehler zu vermeiden.
import { getLang, locale } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Akzeptiert "12,49", "12.49", "1.234,56", "1,234.56", "€ 5". Liefert Cent oder null.
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = String(input).replace(/[\s€]/g, '').replace(/^EUR|EUR$/i, '');
  if (!s) return null;
  const dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  let intPart = s;
  let frac = '';
  if (dec >= 0) {
    const tail = s.length - dec - 1;
    if (tail >= 1 && tail <= 2) {
      intPart = s.slice(0, dec);
      frac = s.slice(dec + 1);
    }
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart + frac) === '') return null;
  return parseInt(intPart || '0', 10) * 100 + (frac ? parseInt(frac.padEnd(2, '0'), 10) : 0);
}

export function fmtMoney(cents) {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);
}

export function fmtAmountInput(cents) {
  if (cents === null || cents === undefined) return '';
  const s = (cents / 100).toFixed(2);
  return getLang() === 'de' ? s.replace('.', ',') : s;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(new Date(y, m - 1, d));
}

export function fmtMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Reihenfolge innerhalb eines Tages wie in den bestehenden Kassabüchern:
// Einlagen zuerst, dann Gehälter, Belege und sonstige Buchungen, dann Tips, zuletzt die Tageslosung.
const RANK = { cashIn: 0, salary: 1, receipt: 2, manual: 2, cashOut: 2, tips: 3, takings: 4 };

// Auch manuell getippte "Tips aus Karten" / "Tageslosung BAR" landen am Tagesende.
function rank(e) {
  const party = String(e.party || '').trim().toLowerCase();
  if (e.kind === 'takings' || party === 'tageslosung bar') return 4;
  if (e.kind === 'tips' || party === 'tips aus karten') return 3;
  return RANK[e.kind] ?? 2;
}

export function sortEntries(list) {
  return list.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const r = rank(a) - rank(b);
    return r || (a.created - b.created);
  });
}

export const signed = (e) => (e.dir === 'in' ? e.amount : -e.amount);

// Sortierte Buchungen mit laufendem Kassastand (balance) nach jeder Buchung.
export function withBalances(biz, entries) {
  let bal = biz.startBalance || 0;
  return sortEntries(entries).map((e) => {
    bal += signed(e);
    return { ...e, balance: bal };
  });
}

export function currentBalance(biz, entries) {
  return entries.reduce((sum, e) => sum + signed(e), biz.startBalance || 0);
}
