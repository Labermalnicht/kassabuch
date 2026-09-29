// Belegerkennung: mit API-Schlüssel über Claude, sonst offline mit Tesseract.
import { t } from './i18n.js';
import { KNOWN_CHAINS, findLearned, suggest, similarity, chainByUid } from './templates.js';
import { parseAmount, todayISO } from './ledger.js';
import { paddleText, vlmFields } from './localai.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export const MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', noteKey: 'model.opus' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', noteKey: 'model.sonnet' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', noteKey: 'model.haiku' },
];
export const DEFAULT_MODEL = 'claude-opus-5';

let sdkPromise = null;
async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import(SDK_URL).then((m) => m.default || m.Anthropic).catch((e) => {
      sdkPromise = null;
      throw e;
    });
  }
  return sdkPromise;
}

async function client(apiKey) {
  const Anthropic = await loadSdk();
  return { Anthropic, api: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 90_000 }) };
}

const SYSTEM = `Du liest Kassenbons und Rechnungen österreichischer Kleinbetriebe für deren Kassabuch.
Auf einem Foto können mehrere Belege nebeneinander liegen. Gib jeden echten Beleg genau einmal im Feld receipts zurück, in der Reihenfolge von links nach rechts und oben nach unten. Kopien oder Durchschläge eines Belegs, die darunter oder daneben liegen, zählst du nicht als eigenen Beleg. Ein Kundenbeleg der Kartenzahlung, der auf demselben Bon mitgedruckt ist, gehört zu diesem Bon und ist kein eigener Beleg.
Felder je Beleg:
- supplier: der Name des Geschäfts oder Lieferanten, kurz wie im Alltag geschrieben (z. B. "SPAR", "BILLA", "METRO"). Keine Adresse, keine Filialnummer. Ist der Lieferant in der Liste bekannter Lieferanten des Betriebs, übernimm genau diese Schreibweise. Wenn das Logo nicht lesbar ist, achte auf Zeilen wie "Vielen Dank für Ihren Einkauf bei ..." oder die Internetadresse.
- date: das Belegdatum im Format JJJJ-MM-TT.
- receipt_number: die Bon- oder Rechnungsnummer der Kasse, z. B. nach "Bon", "Bon-Nr.", "Beleg:", "Rechnungsnummer" oder "Re-Nr.". In einer Zeile wie "Kassier 123456 Kassa 001 Bon 1234" ist 1234 die Belegnummer. Nicht nehmen: Kassier- oder Kassennummer, die "Beleg-Nr.", "Trace-Nr." oder "Trx"-Nummern im Kundenbeleg des Kartenterminals, die "RKSV-Beleg-Nr." (Signaturzähler), Signaturen, UID- oder Steuernummern.
- total: der tatsächlich bezahlte Endbetrag brutto in Euro, nach Rabatten (Zeilen wie "Summe", "Gesamt", "Zu zahlen", "Total"). Nicht den gegebenen Betrag und nicht das Rück- oder Restgeld.
- category: die passendste Kategorie aus der vorgegebenen Liste, anhand von Geschäft und Artikeln.
- payment: "bar" bei Barzahlung (z. B. "Bar", "Gegeben", "Rückgeld"), "karte" bei Karten- oder Bankomatzahlung (z. B. "Karte", "Bankomat", "Maestro", "Visa", "Mastercard", "MC", "kontaktlos"), sonst "unbekannt".
Hintergrund zu österreichischen Belegen: Registrierkassenbelege (RKSV) enthalten Unternehmen, fortlaufende Belegnummer, Datum und Uhrzeit, Kassen-ID, Artikel und die Beträge getrennt nach Steuersatz (20 %, 10 %, 13 %, 0 %, seit 1. 7. 2026 auch 4,9 % für Grundnahrungsmittel). Der Endbetrag ist die Summe der Bruttobeträge aller Steuersätze. Kleinbetragsrechnungen und Lieferantenrechnungen nennen den Endbetrag oft "Rechnungsbetrag", "Gesamtbetrag", "Zahlbetrag" oder "Endsumme" und die Nummer "Rechnungsnummer", "Re-Nr." oder "Rg.-Nr.". Datumsangaben stehen meist als TT.MM.JJJJ.
Wenn ein Feld nicht lesbar ist, gib null zurück. Rate keine Werte. Ist auf dem Foto kein Beleg zu sehen, gib eine leere Liste zurück.`;

function schema(categories) {
  const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['receipts'],
    properties: {
      receipts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['supplier', 'date', 'receipt_number', 'total', 'category', 'payment'],
          properties: {
            supplier: nullable({ type: 'string' }),
            date: nullable({ type: 'string', format: 'date' }),
            receipt_number: nullable({ type: 'string' }),
            total: nullable({ type: 'number' }),
            category: { type: 'string', enum: categories },
            payment: { type: 'string', enum: ['bar', 'karte', 'unbekannt'] },
          },
        },
      },
    },
  };
}

const BRANCH = {
  gastro: 'Gastronomie', beauty: 'Friseur, Kosmetik oder Nagelstudio', retail: 'Einzelhandel', craft: 'Handwerk und Bau',
  service: 'Dienstleistung und Büro', health: 'Gesundheit und Therapie', transport: 'Taxi und Transport', empty: 'Kleinbetrieb',
};

function userText(biz) {
  const byName = new Map();
  Object.values(biz.suppliers || {}).forEach((s) => { if (s.name && (!byName.has(s.name) || s.refLabel)) byName.set(s.name, s); });
  const known = [...byName.values()].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 60)
    .map((s) => (s.refLabel ? `${s.name} (Belegnummer steht nach "${s.refLabel}")` : s.name));
  return [
    `Branche: ${BRANCH[biz.template] || 'Kleinbetrieb'}`,
    `Kategorien: ${biz.categories.join(', ')}`,
    `Bekannte Lieferanten: ${known.length ? known.join(', ') : 'noch keine'}`,
    `Heutiges Datum: ${todayISO()}`,
    'Lies alle Belege auf dem Foto aus.',
  ].join('\n');
}

function plausibleDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() > now + 2 * 86400000 || d.getTime() < now - 3 * 365 * 86400000) return null;
  return iso;
}

export async function recognizeWithClaude({ apiKey, model, base64, biz }) {
  const { Anthropic, api } = await client(apiKey);
  const params = {
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: userText(biz) },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: schema(biz.categories) } },
  };
  // Haiku 4.5 kennt den effort-Parameter nicht.
  if (model !== 'claude-haiku-4-5') params.output_config.effort = 'low';

  let resp;
  if (model === 'claude-opus-5') {
    // Serverseitiger Fallback, falls ein Sicherheitsfilter die Anfrage ablehnt.
    try {
      resp = await api.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
        resp = await api.messages.create(params);
      } else {
        throw e;
      }
    }
  } else {
    resp = await api.messages.create(params);
  }

  if (resp.stop_reason === 'refusal') throw new Error(t('ocr.err.refused'));
  if (resp.stop_reason === 'max_tokens') throw new Error(t('ocr.err.truncated'));
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  // Liste aller Belege auf dem Foto; leer, wenn kein Beleg erkannt wurde.
  return (data.receipts || []).map((r) => ({
    source: 'claude',
    isReceipt: true,
    supplier: r.supplier ? String(r.supplier).trim() : '',
    date: plausibleDate(r.date),
    ref: r.receipt_number ? String(r.receipt_number).trim() : '',
    amount: typeof r.total === 'number' && r.total > 0 ? Math.round(r.total * 100) : null,
    category: biz.categories.includes(r.category) ? r.category : null,
    payment: r.payment || 'unbekannt',
  }));
}

// Prüft den Schlüssel kostenlos über die Modell-Abfrage.
export async function checkKey(apiKey, model) {
  const { api } = await client(apiKey);
  await api.models.retrieve(model);
}

export async function explainError(err) {
  let Anthropic = null;
  try { Anthropic = await loadSdk(); } catch { /* SDK nicht ladbar */ }
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return t('ocr.err.auth');
    if (err instanceof Anthropic.PermissionDeniedError) return t('ocr.err.permission');
    if (err instanceof Anthropic.RateLimitError) return t('ocr.err.rate');
    if (err instanceof Anthropic.APIConnectionError) return t('ocr.err.network');
    if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) return t('ocr.err.credit');
    if (err instanceof Anthropic.APIError) return t('ocr.err.api', { msg: err.message });
  } else {
    return t('ocr.err.network');
  }
  return err && err.message ? err.message : String(err);
}

// ---------- Offline-Erkennung ----------

let tesseractLoad = null;
let workerPromise = null;
let progressCb = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (!tesseractLoad) {
    tesseractLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = () => resolve();
      s.onerror = () => { tesseractLoad = null; reject(new Error(t('ocr.err.offlineLoad'))); };
      document.head.appendChild(s);
    });
  }
  return tesseractLoad;
}

// altCanvas: anders aufbereitetes Bild für einen zweiten Versuch, falls der erste weder Betrag noch Datum liefert.
export async function recognizeOffline(canvas, biz, onProgress, altCanvas) {
  await loadTesseract();
  progressCb = onProgress;
  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker('deu', 1, {
      logger: (m) => { if (m.status === 'recognizing text' && progressCb) progressCb(m.progress); },
    }).then(async (w) => {
      // Seitenmodus 6: ein zusammenhängender Textblock. Bei echten Belegfotos liefert er die vollständigsten Zeilen
      // (verglichen mit den Modi 3, 4 und 11 an echten Belegfotos).
      await w.setParameters({ tessedit_pageseg_mode: '6' });
      return w;
    }).catch((e) => { workerPromise = null; throw e; });
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(canvas);
  const first = parseReceiptText(data.text || '', biz);
  if ((first.amount && first.date) || !altCanvas) return first;
  const second = parseReceiptText((await worker.recognize(altCanvas)).data.text || '', biz);
  const filled = (r) => [r.amount, r.date, r.ref, r.supplier].filter(Boolean).length;
  return filled(second) > filled(first) ? second : first;
}

/**
 * Kostenlose Erkennung auf dem Gerät. img: Ergebnis von prepareImage.
 * PaddleOCR liest den Text; nur wenn das nicht klappt, die ältere Tesseract-Erkennung. Mit vlm: true prüft das
 * Bildsprachmodell auf der Grafikkarte Lieferant, Betrag und Datum gegen.
 * Ergebnis wie recognizeOffline, dazu engine ('paddle', 'tesseract', mit '+vlm') und vlmMs (Rechenzeit).
 */
export async function recognizeLocal(img, biz, { onProgress, vlm = false, onVlmProgress } = {}) {
  let res = null;
  try {
    res = parseReceiptText(await paddleText(img.src), biz);
    res.engine = 'paddle';
  } catch (e) { console.warn('PaddleOCR', e); }
  if (!res || (!res.amount && !res.date)) {
    const tess = await recognizeOffline(img.ocrCanvas, biz, onProgress, img.ocrCanvasAlt);
    tess.engine = 'tesseract';
    const filled = (r) => [r.amount, r.date, r.ref, r.supplier].filter(Boolean).length;
    if (!res || filled(tess) > filled(res)) res = tess;
  }
  if (vlm) {
    try {
      const v = await vlmFields(img.src, onVlmProgress);
      res.vlmMs = v.ms;
      res.engine += '+vlm';
      mergeVlm(res, v);
    } catch (e) {
      console.warn('Bildsprachmodell', e);
      res.vlmError = true;
    }
  }
  return res;
}

// Ergebnis des Bildsprachmodells mit dem gelesenen Text abgleichen. Das Modell versteht den Beleg gut (welcher Betrag
// der Endbetrag ist, wie das Geschäft heißt), irrt sich aber bei einzelnen Ziffern. Darum: Betrag nur, wenn er fehlt
// oder genau so auf dem Beleg steht; Datum nur, wenn keins gelesen wurde; Lieferant, wenn keiner gelernt ist.
function mergeVlm(res, v) {
  if (v.amount) {
    if (!res.amount) res.amount = v.amount;
    else if (v.amount !== res.amount && amountsIn(res.text || '').includes(v.amount)) res.amount = v.amount;
  }
  if (v.date && !res.date && plausibleDate(v.date)) res.date = v.date;
  if (v.supplier && !res.known) res.supplier = v.supplier;
}

// Betrag mit zwei Nachkommastellen. Nicht Teil eines Datums ("18.09.2026"), keiner längeren Zahl und kein Prozentsatz.
// Ohne Lookbehind, damit auch ältere iPhones den Ausdruck verstehen: das Zeichen davor wird mitgelesen.
const AMOUNT_RE = /(^|[^\d.,])(\d{1,3}(?:\.\d{3})+|\d+)[,.]\s?(\d{2})(?!\d)(?![.,]\d)(?!\.\s?\d)(?!\s?%)/g;
// Beschriftungen, wie sie auf österreichischen Kassenbons und Kleinbetragsrechnungen üblich sind.
const STRONG_TOTAL = /(zu\s*(be)?zahlen|zahl(ungs)?betrag|summe|gesamt(betrag|summe)?|rechnungsbetrag|endsumme|endbetrag|bruttobetrag|total|empfangen|betrag\s*eur|betrag\s*dankend)/i;
const PAID = /(zahlung|\bbar\b|mastercard|\bmc\b|bankomat|karte|maestro|visa|v\s?pay|debit|kredit|apple\s*pay|google\s*pay|kontaktlos|contactless|nfc|amex)/i;
const GIVEN = /(gegeben|erhalten|zahlung\s*bar|\bbar\s*eur|\bbar\b)/i;
const CHANGE = /(r(ü|ue|u)ckgeld|restgeld|retour|wechselgeld|zur(ü|ue)ck)/i;
const SKIP = /(r(ü|ue|u)ckgeld|restgeld|retour|wechselgeld|zur(ü|ue)ck|ersparnis|sparen|rabatt|punkte|pfand|zw-?summe|zwischensumme|zw\.\s*summe|subtotal|netto|mwst-?satz|trinkgeld)/i;
// Eindeutige Endbeträge zählen stärker als ein einfaches "Summe".
const FINAL_TOTAL = /(zu\s*(be)?zahlen|endsumme|endbetrag|gesamtbetrag|gesamtsumme|rechnungsbetrag|zahl(ungs)?betrag)/i;
// Steuerzeile, z. B. "20% MwSt von 17,06 = 3,41" oder "USt 10 %": ihre Beträge sind nie der Endbetrag.
const VAT_LINE = /(mwst|mw\.?\s?st|ust\b|u\.st|steuer|\d\s?%)/i;

// Belegnummer, nach Verlässlichkeit geordnet. Die "Beleg-Nr." des Kartenterminals und die
// RKSV-Beleg-Nr. (Signaturzähler) kommen zuletzt bzw. gar nicht in Frage.
const REF_PATTERNS = [
  /\bbon[\s.-]*(?:nr|nummer|no)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,19})/gi, // Bon-Nr.: 1234
  /\bbon\s*[:#]?\s+(\d[\d/-]{2,19})(?![.,]\d)\b/gi, // Kassa 001 Bon 1234
  /\bb[aeo][l1i][aeo]g\s*[:#!]\s*(\d[\d/-]{2,19})\b/gi, // Beleg: 12345, auch verlesen als "Balag:"
  /\b(?:rechnungs?|rech|re|rg)[\s.-]*(?:nr|mr|nummer|no)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,29})/gi, // Re-Nr: 0100-20260101-01-1234
  /\b(?:beleg[\s-]*id|quittung[\s.-]*(?:nr|nummer)\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{1,29})/gi, // Beleg-ID / Quittung Nr.
  /\bbeleg(?:nummer|[\s.-]*nr\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{2,19})/gi, // Beleg-Nr. 1234
  /\brechnung\s*[:#]?\s+(\d[\d/-]{2,19})(?![.,]\d)\b/gi, // Rechnung 4711
];
const REF_EXCLUDE = /(rks[vu]|signatur|trace|terminal|trx|uid|atu)/i;

function amountsIn(line) {
  const out = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(line))) {
    const c = parseAmount(m[2].replace(/\./g, '') + ',' + m[3]);
    if (c !== null && c > 0 && c < 10_000_000) out.push(c);
  }
  return out;
}

// Endbetrag per Punktevergabe: Summenzeilen, Zahlungszeilen, MwSt-Tabellen (netto + Steuer = brutto),
// "Gegeben minus Rückgeld" und die Häufigkeit eines Betrags sprechen jeweils für ihn.
function findTotal(lines, profile) {
  const score = new Map();
  const label = profile && profile.totalLabel;
  const add = (c, pts) => { if (c) score.set(c, (score.get(c) || 0) + pts); };
  let given = null;
  let change = null;
  const vatGross = [];
  lines.forEach((l, i) => {
    const a = amountsIn(l);
    if (CHANGE.test(l)) { if (a.length) change = a[a.length - 1]; else { const n = amountsIn(lines[i + 1] || ''); if (n.length) change = n[0]; } }
    if (GIVEN.test(l) && !CHANGE.test(l) && a.length) given = a[a.length - 1];
    if (SKIP.test(l)) return;
    a.forEach((c) => add(c, 1));
    if (STRONG_TOTAL.test(l)) {
      // Ohne eigenen Betrag gilt die Folgezeile, aber nicht, wenn dort die Steuer steht ("Betrag dankend erhalten").
      const next = lines[i + 1] || '';
      const own = a.length ? a : VAT_LINE.test(next) ? [] : amountsIn(next);
      if (own.length) add(own[own.length - 1], FINAL_TOTAL.test(l) ? 7 : 5);
    } else if (PAID.test(l) && a.length) {
      add(a[a.length - 1], 2);
    }
    if (label && lineLetters(l).includes(label)) {
      const own = a.length ? a : amountsIn(lines[i + 1] || '');
      if (own.length) add(own[own.length - 1], 8);
    }
    if (a.length === 2 && VAT_LINE.test(l) && /\bvon\b/i.test(l)) {
      vatGross.push(a[0] + a[1]); // "MwSt von netto = Steuer"
    } else if (a.length >= 3) {
      const [x, y, z] = a.slice(-3);
      if (Math.abs(x + y - z) <= 1) vatGross.push(z); // netto, Steuer, brutto
      else if (Math.abs(y + z - x) <= 1) vatGross.push(x); // brutto, netto, Steuer
    }
  });
  // Steuertabelle (netto + Steuer = brutto): bei einem Steuersatz ist brutto der Endbetrag,
  // bei mehreren Steuersätzen die Summe der Bruttowerte.
  if (vatGross.length === 1) add(vatGross[0], 4);
  if (vatGross.length > 1) add(vatGross.reduce((s, c) => s + c, 0), 6);
  if (given && change && given > change) add(given - change, 5);
  let best = null;
  for (const [c, pts] of score) {
    if (!best || pts > best[1] || (pts === best[1] && c > best[0])) best = [c, pts];
  }
  return best ? best[0] : null;
}

const MONTHS = { jan: 1, jän: 1, jaen: 1, feb: 2, mär: 3, mar: 3, maer: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

function findDate(text) {
  const counts = new Map();
  const add = (y, mo, d) => {
    const iso = plausibleDate(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    if (iso) counts.set(iso, (counts.get(iso) || 0) + 1);
  };
  let m;
  const dmy = /(\d{1,2})\s?[./-]\s?(\d{1,2})\s?[./,-]\s?(20\d{2}|\d{2})(?!\d)/g;
  while ((m = dmy.exec(text))) add(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), m[2], m[1]);
  const ymd = /(20\d{2})-(\d{2})-(\d{2})(?!\d)/g;
  while ((m = ymd.exec(text))) add(m[1], m[2], m[3]);
  const named = /(\d{1,2})\.?\s*(j(?:ä|ae|a)n|feb|m(?:ä|ae|a)r|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec)[a-zä]*\.?\s*(20\d{2})/gi;
  while ((m = named.exec(text))) {
    const key = m[2].toLowerCase().replace('ae', 'ä');
    const mo = MONTHS[key] || MONTHS[key.slice(0, 3)];
    if (mo) add(m[3], mo, m[1]);
  }
  let best = null;
  for (const [d, n] of counts) if (!best || n > best[1]) best = [d, n];
  return best ? best[0] : null;
}

function findRef(text, profile) {
  if (profile && profile.refLabel) {
    // Wort vor einer Nummer, das der gelernten Beschriftung gleicht (ein bis zwei Lesefehler erlaubt).
    const re = /([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.-]{1,20})\s*[:#.!]?\s*([A-Z0-9][A-Z0-9/-]{1,29})/g;
    for (const m of text.matchAll(re)) {
      const word = m[1].toLowerCase().replace(/[.:-]+$/, '');
      if (/\d/.test(m[2]) && Math.abs(word.length - profile.refLabel.length) <= 2
        && similarity(word, profile.refLabel) >= 0.6 && !REF_EXCLUDE.test(m[0])) return m[2].replace(/[/-]+$/, '');
    }
  }
  for (const re of REF_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (/\d/.test(m[1]) && !REF_EXCLUDE.test(before + m[0])) return m[1].replace(/[/-]+$/, '');
    }
  }
  return '';
}

// Heuristische Auswertung des erkannten Texts. Exportiert, damit sie testbar ist.
export function parseReceiptText(text, biz) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const full = lines.join('\n');

  // Lieferant: gelernter Lieferant, bekannte Kette (auch in "Vielen Dank ... bei SPAR" oder der Internetadresse)
  // oder die erste Zeile mit Buchstaben.
  let supplier = '';
  // 1. Merkmale früherer Belege (UID-Nummer, Internetadresse) erkennen den Lieferanten auch bei verlesenem Namen.
  let profile = profileByFingerprint(biz, fingerprintsOf(full));
  if (profile) supplier = profile.name;
  // 2. gespeicherte Lieferanten, auch unscharf
  if (!supplier) {
    for (const l of lines.slice(0, 25)) {
      const hit = findLearned(biz, l);
      if (hit) { supplier = hit.name; profile = hit; break; }
    }
  }
  // 3. UID-Nummer einer bekannten Kette auf dem Beleg (sicherer als ein verlesener Name)
  if (!supplier) {
    const hit = fingerprintsOf(full).map((id) => chainByUid(biz, id)).find(Boolean);
    if (hit) supplier = hit.name;
  }
  if (!supplier) {
    const chain = lines.find((l) => KNOWN_CHAINS.some((re) => re.test(l)));
    if (chain) supplier = (suggest(biz, chain) || {}).name || chain;
  }
  if (!supplier) {
    // Firmenzeile mit Rechtsform, z. B. "... OG", "... GmbH", "... KG"
    supplier = lines.slice(0, 15).find((l) => /(?:^|[\s,])(GmbH|GesmbH|Ges\.?\s?m\.?\s?b\.?\s?H\.?|mbH|OG|0G|KG|AG|SE|e\.\s?U\.?|eU)(?=$|[\s,.&])/.test(l)
      && (l.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 5) || '';
  }
  if (!supplier) {
    // Name aus der Internetadresse, z. B. "musterfirma.at" -> "Musterfirma"
    const domain = fingerprintsOf(full).find((id) => !id.startsWith('ATU') && !/fiskaltrust|efsta|rksv/.test(id));
    if (domain) supplier = domain.replace(/\.[a-z]+$/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
  }
  if (!supplier) {
    // erste Textzeile, aber keine Branchen-, Adress- oder Formularzeilen
    supplier = lines.slice(0, 12).find((l) => (l.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 4
      && !/^(rechnung|beleg|kassa|kassenbon|quittung|datum|summe|www|tel|uid|atu|fn\s)/i.test(l)
      && !/(handel|gemüse|gemuese|obst|stra(ss|ß)e|gasse|platz|markt\s*\d|wien|graz|linz|salzburg|filiale|\b\d{4}\b)/i.test(l)) || '';
  }
  supplier = supplier.replace(/[^\p{L}\p{N}&.,'\s-]/gu, '').replace(/\s+/g, ' ').trim()
    .replace(/\b0G\b/g, 'OG').replace(/\bGmbh\b/g, 'GmbH').replace(/\bK6\b/g, 'KG').slice(0, 60);
  let chain = null;
  if (supplier) {
    chain = suggest(biz, supplier);
    if (!profile) profile = findLearned(biz, (chain && chain.name) || supplier);
  }

  // Zahlungsart
  let payment = 'unbekannt';
  if (/bankomat|maestro|visa|v\s?pay|mastercard|kontaktlos|contactless|kartenzahlung|zahlung\s*karte|debit|kreditkarte|apple\s*pay|google\s*pay|amex|gegeben\s*mc/i.test(full)) payment = 'karte';
  else if (/\bbar\b|barzahlung|bar\s*bezahlt|gegeben|r(ü|ue)ckgeld|restgeld|retour|wechselgeld/i.test(full)) payment = 'bar';

  const date = findDate(full);
  let ref = findRef(full, profile);
  // Belegnummer am Ende der Strichcode-Zahl (gelernt oder bei bekannten Ketten hinterlegt).
  // Die Zahl muss das Belegdatum (JJMMTT) enthalten; dann ist sie verlässlicher als eine schlecht gelesene Textzeile.
  const tail = (profile && profile.refTail) || (chain && chain.refTail) || 0;
  if (tail) {
    const code = barcodeNumbers(full).find((n) => !date || n.includes(date.slice(2).replace(/-/g, '')));
    if (code && (date || !ref)) ref = code.slice(-tail);
  }
  return {
    source: 'offline', isReceipt: true, supplier, date, ref,
    amount: findTotal(lines, profile), category: null, payment, text: full, known: profile ? profile.name : '',
  };
}

// Lange Ziffernfolgen, wie sie unter Strichcodes gedruckt sind (einzelne Leerzeichen der Erkennung werden entfernt).
function barcodeNumbers(text) {
  return [...text.matchAll(/\d[\d ]{18,40}\d/g)].map((m) => m[0].replace(/ /g, '')).filter((n) => n.length >= 16);
}

// ---------- Lernen aus bestätigten Belegen ----------

const lineLetters = (l) => l.toLowerCase().replace(/[^a-zäöüß\s-]/g, ' ').replace(/\s+/g, ' ').trim();

// Merkmale eines Lieferanten: UID-Nummer (ATU...) und Internetadresse.
export function fingerprintsOf(text) {
  const ids = new Set();
  // UID: typische Lesefehler in den Ziffern angleichen (O/0, B/8, I/l/1, S/5, Z/2).
  const digits = (s) => s.toUpperCase().replace(/O/g, '0').replace(/B/g, '8').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/Z/g, '2');
  for (const m of text.matchAll(/\bAT[UV]\s?([0-9OBILSZ]{8})\b/gi)) {
    const d = digits(m[1]);
    if (/^\d{8}$/.test(d)) ids.add(`ATU${d}`);
  }
  for (const m of text.matchAll(/(?:www\.\s?|https?:\/\/(?:[a-z0-9-]+\.)?)([a-z0-9-]{3,}\.(?:at|de|com|eu|net))\b/gi)) ids.add(m[1].toLowerCase());
  // Firmenbuchnummer, z. B. "FN 123456a"
  for (const m of text.matchAll(/\bFN\s?(\d{4,6}\s?[a-z])\b/gi)) ids.add(`FN${m[1].replace(/\s/g, '').toLowerCase()}`);
  return [...ids];
}

function profileByFingerprint(biz, ids) {
  if (!ids.length) return null;
  return Object.values(biz.suppliers || {}).find((s) => (s.ids || []).some((id) => ids.includes(id))) || null;
}

// Was lässt sich aus einem bestätigten Beleg über den Lieferanten lernen?
// refLabel: Beschriftung vor der Belegnummer, totalLabel: Beschriftung der Betragszeile, ids: Merkmale.
export function learnFromReceipt(text, { ref, amount }) {
  const out = { refLabel: '', totalLabel: '', refTail: 0, ids: fingerprintsOf(text || '') };
  if (!text) return out;
  if (ref && /^\d{3,8}$/.test(String(ref)) && barcodeNumbers(text).some((n) => n.endsWith(String(ref)))) {
    out.refTail = String(ref).length;
  }
  if (ref) {
    const idx = text.toLowerCase().indexOf(String(ref).toLowerCase());
    if (idx > 0) {
      const before = text.slice(Math.max(0, idx - 30), idx).split('\n').pop();
      const m = before.match(/([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.-]{1,20})\s*[:#.]?\s*$/);
      if (m && !REF_EXCLUDE.test(m[1])) out.refLabel = m[1].toLowerCase().replace(/[.:-]+$/, '');
    }
  }
  if (amount) {
    const eur = (amount / 100).toFixed(2);
    const variants = [eur, eur.replace('.', ',')];
    const candidates = text.split('\n').filter((l) => variants.some((v) => l.includes(v)))
      .map((l) => lineLetters(l.slice(0, l.indexOf(variants.find((v) => l.includes(v))))).split(' ').slice(0, 3).join(' '))
      .filter((lbl) => lbl.replace(/[\s-]/g, '').length >= 3);
    const pick = candidates.find((lbl) => STRONG_TOTAL.test(lbl)) || candidates.find((lbl) => !PAID.test(lbl) && !GIVEN.test(lbl) && !CHANGE.test(lbl));
    if (pick) out.totalLabel = pick;
  }
  return out;
}
