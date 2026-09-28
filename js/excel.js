// Excel-Export im Layout der bestehenden Kassabücher und Wiederherstellung aus der eingebetteten Sicherung.
import { withBalances } from './ledger.js';
import { BOOK } from './templates.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NUM = '#,##0.00';
// Hintergrund der Tageslosung-Zeilen, für alle Betriebe gleich.
const TAKINGS_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAF7' } };
const BACKUP_SHEET = '_daten';
const BACKUP_MARK = 'KASSABUCH-SICHERUNG';
const CHUNK = 30000; // Excel erlaubt höchstens 32.767 Zeichen pro Zelle

// Lokale Kopie zuerst (offline verfügbar), sonst dieselbe Version vom CDN.
const EXCEL_SOURCES = ['vendor/exceljs.min.js', 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(`load ${src}`)); };
    document.head.appendChild(s);
  });
}

let excelLoad = null;
export function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelLoad) {
    excelLoad = (async () => {
      for (const src of EXCEL_SOURCES) {
        try {
          await loadScript(src);
          if (window.ExcelJS) return window.ExcelJS;
        } catch (e) {
          console.warn(e.message);
        }
      }
      throw new Error('ExcelJS');
    })().catch((e) => { excelLoad = null; throw e; });
  }
  return excelLoad;
}

const pad = (n) => String(n).padStart(2, '0');
export const sheetName = (year, month) => `${pad(month)} ${year}`;
const eur = (cents) => Math.round(cents) / 100;

export function yearsOf(biz, entries) {
  const ys = new Set(entries.map((e) => Number(e.date.slice(0, 4))));
  if (biz.startDate) ys.add(Number(biz.startDate.slice(0, 4)));
  return [...ys].sort((a, b) => b - a);
}

// Kennzahlen eines Jahres für die Export-Ansicht.
export function yearInfo(biz, entries, year) {
  const all = withBalances(biz, entries);
  const before = all.filter((e) => e.date < `${year}-01-01`);
  const inYear = all.filter((e) => e.date.startsWith(`${year}-`));
  const carry = before.length ? before[before.length - 1].balance : (biz.startBalance || 0);
  const end = inYear.length ? inYear[inYear.length - 1].balance : carry;
  const months = inYear.map((e) => Number(e.date.slice(5, 7)));
  let first = months.length ? Math.min(...months) : null;
  const last = months.length ? Math.max(...months) : null;
  if (first !== null && biz.startDate && biz.startDate.startsWith(`${year}-`)) {
    first = Math.min(first, Number(biz.startDate.slice(5, 7)));
  }
  return { carry, end, count: inYear.length, first, last, entries: inYear };
}

export async function buildWorkbook(biz, entries, year) {
  const ExcelJS = await loadExcel();
  const info = yearInfo(biz, entries, year);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Kassabuch';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // Spalte Tips nur, wenn in diesem Jahr Tips gebucht wurden.
  const tipsCol = info.entries.some((e) => e.kind === 'tips');
  const headers = ['LNr.', 'Lieferant', 'Dat.', 'Beschreibung', 'ReNr', 'Ausgaben', 'BAR', 'Kassa'];
  const widths = [8, 34, 12, 28, 17, 13, 13, 14];
  if (tipsCol) { headers.push('Tips'); widths.push(12); }

  let carry = info.carry;
  let prevRef = null;
  let lnr = 0;
  const first = info.first ?? 1;
  const last = info.last ?? first;

  for (let m = first; m <= last; m++) {
    const name = sheetName(year, m);
    const ws = wb.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = widths.map((w) => ({ width: w }));

    const head = ws.getRow(1);
    headers.forEach((h, i) => {
      const c = head.getCell(i + 1);
      c.value = h;
      c.font = { bold: true };
      c.border = { bottom: { style: 'thin' } };
    });

    const r2 = ws.getRow(2);
    r2.getCell(2).value = 'Übertrag';
    r2.getCell(3).value = String(year);
    r2.getCell(8).value = prevRef ? { formula: prevRef, result: eur(carry) } : eur(carry);
    r2.getCell(8).numFmt = NUM;

    const monthEntries = info.entries.filter((e) => Number(e.date.slice(5, 7)) === m);
    let r = 3;
    for (const e of monthEntries) {
      const row = ws.getRow(r);
      // LNr. nur, wenn gewünscht; sonst vergibt die Buchhaltung die Nummern selbst.
      if (biz.autoLnr !== false) row.getCell(1).value = ++lnr;
      row.getCell(2).value = e.party || '';
      const [y, mo, d] = e.date.split('-').map(Number);
      row.getCell(3).value = new Date(Date.UTC(y, mo - 1, d));
      row.getCell(3).numFmt = 'dd.mm.yyyy';
      row.getCell(4).value = e.desc || '';
      if (e.ref) {
        row.getCell(5).value = String(e.ref);
        row.getCell(5).numFmt = '@';
      }
      const col = e.dir === 'out' ? 6 : 7;
      if (e.parts && e.parts.length > 1) {
        // Wie im Original: mehrere Teilbeträge als Formel, z. B. =12.5+7.3
        row.getCell(col).value = { formula: e.parts.map((p) => String(eur(p))).join('+'), result: eur(e.amount) };
      } else {
        row.getCell(col).value = eur(e.amount);
      }
      row.getCell(6).numFmt = NUM;
      row.getCell(7).numFmt = NUM;
      row.getCell(8).value = { formula: `H${r - 1}-F${r}+G${r}`, result: eur(e.balance) };
      row.getCell(8).numFmt = NUM;
      if (e.kind === 'takings') {
        // Wie im Original: Lieferant bis BAR einfärben (B, D, E, F, G), LNr., Datum und Kassa bleiben weiß.
        [2, 4, 5, 6, 7].forEach((c) => { row.getCell(c).fill = TAKINGS_FILL; });
      }
      if (tipsCol && e.kind === 'tips') {
        row.getCell(9).value = { formula: `F${r}`, result: eur(e.amount) };
        row.getCell(9).numFmt = NUM;
      }
      carry = e.balance;
      r++;
    }
    const lastRow = r - 1;

    if (monthEntries.length) {
      const outSum = monthEntries.filter((e) => e.dir === 'out').reduce((s, e) => s + e.amount, 0);
      const inSum = monthEntries.filter((e) => e.dir === 'in').reduce((s, e) => s + e.amount, 0);
      const takings = monthEntries.filter((e) => e.kind === 'takings').reduce((s, e) => s + e.amount, 0);
      const tips = monthEntries.filter((e) => e.kind === 'tips').reduce((s, e) => s + e.amount, 0);

      const sum = ws.getRow(r);
      sum.getCell(2).value = 'Summe';
      sum.getCell(6).value = { formula: `SUM(F3:F${lastRow})`, result: eur(outSum) };
      sum.getCell(7).value = { formula: `SUM(G3:G${lastRow})`, result: eur(inSum) };
      // Endstand der Kassa noch einmal unter dem Strich als Ergebnis des Monats.
      sum.getCell(8).value = { formula: `H${lastRow}`, result: eur(carry) };
      if (tipsCol) sum.getCell(9).value = { formula: `SUM(I3:I${lastRow})`, result: eur(tips) };
      for (let c = 1; c <= headers.length; c++) {
        const cell = sum.getCell(c);
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' } };
        if (c >= 6) cell.numFmt = NUM;
      }
      const sub = ws.getRow(r + 1);
      sub.getCell(2).value = `davon ${BOOK.takings}`;
      sub.getCell(7).value = { formula: `SUMIF(B3:B${lastRow},"${BOOK.takings}",G3:G${lastRow})`, result: eur(takings) };
      sub.getCell(7).numFmt = NUM;
    }

    prevRef = `'${name}'!H${lastRow}`;
  }

  if (!wb.worksheets.length) {
    // Jahr ohne Buchungen: trotzdem ein gültiges Blatt mit Übertrag.
    const ws = wb.addWorksheet(sheetName(year, 1));
    ws.getRow(1).values = headers;
    ws.getRow(2).getCell(2).value = 'Übertrag';
    ws.getRow(2).getCell(8).value = eur(carry);
  }

  // Unsichtbare Sicherung aller Daten dieses Betriebs (alle Jahre).
  const bs = wb.addWorksheet(BACKUP_SHEET);
  bs.state = 'veryHidden';
  const payload = JSON.stringify({ app: 'kassabuch', version: 1, exported: new Date().toISOString(), business: biz, entries });
  bs.getCell('A1').value = BACKUP_MARK;
  for (let i = 0, row = 2; i < payload.length; i += CHUNK, row++) {
    bs.getCell(`A${row}`).value = payload.slice(i, i + CHUNK);
  }
  return wb;
}

export async function exportYear(biz, entries, year) {
  const wb = await buildWorkbook(biz, entries, year);
  const buf = await wb.xlsx.writeBuffer();
  const safe = biz.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Betrieb';
  return { blob: new Blob([buf], { type: XLSX_MIME }), filename: `Kassabuch ${safe} ${year}.xlsx` };
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (v.richText) return v.richText.map((p) => p.text).join('');
  if (v.text) return v.text;
  return String(v);
}

export async function readBackup(file) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet(BACKUP_SHEET);
  if (!ws || cellText(ws.getCell('A1').value) !== BACKUP_MARK) throw new Error('no-backup');
  let json = '';
  for (let row = 2; ; row++) {
    const part = cellText(ws.getCell(`A${row}`).value);
    if (!part) break;
    json += part;
  }
  const data = JSON.parse(json);
  if (data.app !== 'kassabuch' || !data.business || !Array.isArray(data.entries)) throw new Error('no-backup');
  return data;
}
