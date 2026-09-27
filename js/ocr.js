// Belegerkennung: mit API-Schlüssel über Claude, sonst offline mit Tesseract.
import { t } from './i18n.js';
import { KNOWN_CHAINS } from './templates.js';
import { parseAmount, todayISO } from './ledger.js';

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
Gib für das Foto genau die angeforderten Felder zurück:
- is_receipt: true, wenn auf dem Foto ein Zahlungsbeleg, Kassenbon oder eine Rechnung zu sehen ist.
- supplier: der Name des Geschäfts oder Lieferanten, kurz wie im Alltag geschrieben (z. B. "SPAR", "BILLA", "METRO"). Keine Adresse, keine Filialnummer. Ist der Lieferant in der Liste bekannter Lieferanten des Betriebs, übernimm genau diese Schreibweise.
- date: das Belegdatum im Format JJJJ-MM-TT.
- receipt_number: die kurze Beleg-, Bon- oder Rechnungsnummer, wie sie auf dem Beleg steht, z. B. nach "Bon", "Bon-Nr.", "Beleg-Nr.", "Rechnungsnummer" oder "Re-Nr.". In einer Zeile wie "Kassier 123456 Kassa 001 Bon 1234" ist 1234 die Belegnummer. Nicht die Kassier- oder Kassennummer, nicht die Transaktions- oder Terminalnummer der Kartenzahlung, keine Signatur und keine Steuernummer.
- total: der tatsächlich bezahlte Endbetrag brutto in Euro, nach Rabatten (Zeilen wie "Summe", "Gesamt", "Zu zahlen", "Total"). Nicht den gegebenen Betrag und nicht das Rückgeld.
- category: die passendste Kategorie aus der vorgegebenen Liste, anhand von Geschäft und Artikeln.
- payment: "bar" bei Barzahlung (z. B. "Bar", "Gegeben", "Rückgeld"), "karte" bei Karten- oder Bankomatzahlung (z. B. "Karte", "Bankomat", "Maestro", "Visa", "Mastercard", "kontaktlos"), sonst "unbekannt".
Wenn ein Feld nicht lesbar ist, gib null zurück. Rate keine Werte.`;

function schema(categories) {
  const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['is_receipt', 'supplier', 'date', 'receipt_number', 'total', 'category', 'payment'],
    properties: {
      is_receipt: { type: 'boolean' },
      supplier: nullable({ type: 'string' }),
      date: nullable({ type: 'string', format: 'date' }),
      receipt_number: nullable({ type: 'string' }),
      total: nullable({ type: 'number' }),
      category: { type: 'string', enum: categories },
      payment: { type: 'string', enum: ['bar', 'karte', 'unbekannt'] },
    },
  };
}

const BRANCH = {
  gastro: 'Gastronomie', beauty: 'Friseur, Kosmetik oder Nagelstudio', retail: 'Einzelhandel', craft: 'Handwerk und Bau',
  service: 'Dienstleistung und Büro', health: 'Gesundheit und Therapie', transport: 'Taxi und Transport', empty: 'Kleinbetrieb',
};

function userText(biz) {
  const known = [...new Set(Object.values(biz.suppliers || {}).map((s) => s.name))].slice(0, 80);
  return [
    `Branche: ${BRANCH[biz.template] || 'Kleinbetrieb'}`,
    `Kategorien: ${biz.categories.join(', ')}`,
    `Bekannte Lieferanten: ${known.length ? known.join(', ') : 'noch keine'}`,
    `Heutiges Datum: ${todayISO()}`,
    'Lies den Beleg auf dem Foto aus.',
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
  return {
    source: 'claude',
    isReceipt: data.is_receipt !== false,
    supplier: data.supplier ? String(data.supplier).trim() : '',
    date: plausibleDate(data.date),
    ref: data.receipt_number ? String(data.receipt_number).trim() : '',
    amount: typeof data.total === 'number' && data.total > 0 ? Math.round(data.total * 100) : null,
    category: biz.categories.includes(data.category) ? data.category : null,
    payment: data.payment || 'unbekannt',
  };
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

export async function recognizeOffline(canvas, biz, onProgress) {
  await loadTesseract();
  progressCb = onProgress;
  if (!workerPromise) {
    workerPromise = window.Tesseract.createWorker('deu', 1, {
      logger: (m) => { if (m.status === 'recognizing text' && progressCb) progressCb(m.progress); },
    }).then(async (w) => {
      // Seitenmodus 4: eine Textspalte, damit Artikel und Betrag in derselben Zeile bleiben.
      await w.setParameters({ tessedit_pageseg_mode: '4' });
      return w;
    }).catch((e) => { workerPromise = null; throw e; });
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(canvas);
  return parseReceiptText(data.text || '', biz);
}

const AMOUNT_RE = /(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.]\s?(\d{2})(?!\d)/g;
const TOTAL_WORDS = /(zu\s*zahlen|zahlbetrag|summe|gesamt|total|endbetrag|betrag|bar\s*eur)/i;
const SKIP_WORDS = /(gegeben|r(ü|ue)ckgeld|zur(ü|ue)ck|mwst|ust|netto|steuer|rabatt|ersparnis|punkte|pfand)/i;

// Belegnummer, in dieser Reihenfolge gesucht:
// "Bon-Nr.: 1234", "Belegnummer 12", dann "Rechnungsnr. RE01-123", dann "Kassa 001 Bon 1234" oder "Beleg: 1234".
// Reine Zahlen ohne "Nr." brauchen mindestens drei Ziffern und dürfen kein Datum oder Betrag sein.
const REF_PATTERNS = [
  /\b(?:bon|beleg)[\s.-]*(?:nr|nummer|no)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/gi,
  /\b(?:rechnungs?|rech|re|rg)[\s.-]*(?:nr|nummer|no)\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{1,19})/gi,
  /\b(?:bon|beleg|rechnung)\s*[:#]?\s+(\d[\d/-]{2,19})(?![.,]\d)\b/gi,
  /\b(?:bon|beleg|rechnung)\s*[:#]\s*([A-Z0-9][A-Z0-9/-]{1,19})/gi,
];

function amountsIn(line) {
  const out = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(line))) {
    const c = parseAmount(m[1].replace(/[.\s]/g, '') + ',' + m[2]);
    if (c !== null && c > 0 && c < 10_000_000) out.push(c);
  }
  return out;
}

// Heuristische Auswertung des erkannten Texts. Exportiert, damit sie testbar ist.
export function parseReceiptText(text, biz) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const full = lines.join('\n');

  // Lieferant: bekannte Kette, gelernter Lieferant oder erste Zeile mit Buchstaben.
  let supplier = '';
  const known = Object.values(biz.suppliers || {}).map((s) => s.name);
  for (const name of known) {
    if (name && name.length >= 3 && full.toLowerCase().includes(name.toLowerCase())) { supplier = name; break; }
  }
  if (!supplier) {
    const chain = lines.find((l) => KNOWN_CHAINS.some((re) => re.test(l)));
    if (chain) supplier = chain;
  }
  if (!supplier) {
    supplier = lines.find((l) => (l.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 3 && !/^(rechnung|beleg|kassa|datum)/i.test(l)) || '';
  }
  supplier = supplier.replace(/[^\p{L}\p{N}&.,'\s-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);

  // Datum
  let date = null;
  const dm = full.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (dm) {
    let y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    const iso = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    date = plausibleDate(iso);
  }

  // Endbetrag: Zeile mit Summenwort, sonst größter Betrag ohne Rückgeld/Steuerzeilen.
  let amount = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (TOTAL_WORDS.test(l) && !SKIP_WORDS.test(l)) {
      const a = amountsIn(l);
      const next = a.length ? a : amountsIn(lines[i + 1] || '');
      if (next.length) { amount = next[next.length - 1]; if (/zu\s*zahlen|summe|gesamt|total/i.test(l)) break; }
    }
  }
  if (amount === null) {
    const all = lines.filter((l) => !SKIP_WORDS.test(l)).flatMap(amountsIn);
    if (all.length) amount = Math.max(...all);
  }

  // Belegnummer
  let ref = '';
  for (const re of REF_PATTERNS) {
    const m = [...full.matchAll(re)].find((x) => /\d/.test(x[1]));
    if (m) { ref = m[1]; break; }
  }

  // Zahlungsart
  let payment = 'unbekannt';
  if (/bankomat|maestro|visa|mastercard|kontaktlos|kartenzahlung|zahlung\s*karte|debit\s*card|kreditkarte/i.test(full)) payment = 'karte';
  else if (/\bbar\b|gegeben|r(ü|ue)ckgeld/i.test(full)) payment = 'bar';

  return { source: 'offline', isReceipt: true, supplier, date, ref, amount, category: null, payment };
}
