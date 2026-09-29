// Kostenlose Texterkennung direkt im Browser, ohne Server und ohne Installation.
// Standard: PaddleOCR (PP-OCRv6 tiny, etwa 6 MB Modell und 5 MB Laufzeit), läuft auf jedem Gerät auf dem Prozessor.
// Grafikkarte: zusätzlich das Bildsprachmodell Qwen3-VL-2B über WebGPU (einmalig etwa 1,8 GB, danach im Browser
// gespeichert). Es prüft Lieferant, Betrag und Datum gegen; die Nummern liest PaddleOCR zuverlässiger.

const PADDLE_LIB = 'https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.6.0/web/+esm';
const TF_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm';
const VLM_ID = 'onnx-community/Qwen3-VL-2B-Instruct-ONNX';
const VLM_DTYPE = { embed_tokens: 'q4f16', vision_encoder: 'fp16', decoder_model_merged: 'q4f16' };
const VLM_BYTES = 1.85e9; // Summe der Modelldateien, für die Fortschrittsanzeige
export const VLM_SIZE = '1,8 GB';
// Braucht ein Beleg länger, ist die Grafikkarte zu schwach für das große Modell.
export const VLM_SLOW_MS = 25000;

// ---------- Leistungsstufe ----------

let gpuPromise = null;
/**
 * Prüft die Grafikkarte über WebGPU. Ergebnis: { tier: 'gpu' | 'standard', name }.
 * Stark gilt: eigene Grafikkarte von NVIDIA oder AMD, Intel Arc oder Apple (M-Chips), mit 16-Bit-Rechnung,
 * großen Speicherpuffern und mindestens 8 GB Arbeitsspeicher. Integrierte Intel-Grafik reicht nicht.
 */
export function detectGpu() {
  if (!gpuPromise) {
    gpuPromise = (async () => {
      if (!navigator.gpu) return { tier: 'standard', name: '' };
      let a = null;
      try { a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { a = null; }
      if (!a) return { tier: 'standard', name: '' };
      const info = a.info || {};
      const vendor = String(info.vendor || '').toLowerCase();
      const arch = String(info.architecture || '').toLowerCase();
      const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
      const intelDiscrete = vendor === 'intel' && /xe-hpg|xe2-hpg|alchemist|battlemage/.test(arch);
      const strongVendor = /nvidia|amd|apple/.test(vendor) || intelDiscrete;
      const ok = strongVendor && !a.isFallbackAdapter && !info.isFallbackAdapter && a.features.has('shader-f16')
        && a.limits.maxBufferSize >= 1024 ** 3 && (navigator.deviceMemory || 8) >= 8;
      return { tier: ok ? 'gpu' : 'standard', name };
    })();
  }
  return gpuPromise;
}

// ---------- Standard: PaddleOCR ----------

let paddle = null;
function paddleService() {
  if (!paddle) {
    paddle = (async () => {
      const mod = await import(PADDLE_LIB);
      const svc = new mod.PaddleOcrService();
      await svc.initialize();
      return svc;
    })().catch((e) => { paddle = null; throw e; });
  }
  return paddle;
}

// Bild als Canvas in Farbe, längste Seite höchstens max Pixel.
function toCanvas(src, max) {
  const sc = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * sc);
  c.height = Math.round(src.height * sc);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Text eines Belegbilds (ImageBitmap/Canvas) mit PaddleOCR, Zeilen mit Zeilenumbruch getrennt. */
export async function paddleText(src) {
  const svc = await paddleService();
  const res = await svc.recognize(toCanvas(src, 2000));
  return res.text || '';
}

// ---------- Grafikkarte: Qwen3-VL-2B ----------

let vlm = null;
let vlmLoaded = false;
export const vlmIsLoaded = () => vlmLoaded;

/** Lädt das Bildsprachmodell (beim ersten Mal Download). onProgress(anteil 0 bis 1). */
export function loadVlm(onProgress) {
  if (!vlm) {
    vlm = (async () => {
      const tf = await import(TF_LIB);
      const files = {};
      const progress_callback = (p) => {
        if (p.status !== 'progress' || !p.file) return;
        files[p.file] = p.loaded || 0;
        if (onProgress) onProgress(Math.min(1, Object.values(files).reduce((s, v) => s + v, 0) / VLM_BYTES));
      };
      const processor = await tf.AutoProcessor.from_pretrained(VLM_ID, { progress_callback });
      const model = await tf.Qwen3VLForConditionalGeneration.from_pretrained(VLM_ID, { device: 'webgpu', dtype: VLM_DTYPE, progress_callback });
      vlmLoaded = true;
      return { tf, processor, model };
    })().catch((e) => { vlm = null; throw e; });
  }
  return vlm;
}

const PROMPT = 'Das ist ein österreichischer Kassenbon oder eine Rechnung. Antworte nur mit JSON: '
  + '{"lieferant": "Name des Geschäfts oder der Firma", "datum": "JJJJ-MM-TT", "betrag": Endbetrag in Euro als Zahl}';

function isoDate(s) {
  const v = String(s || '').trim();
  let m = v.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** Lieferant, Datum und Betrag (Cent) laut Bildsprachmodell; dazu die Rechenzeit in ms. */
export async function vlmFields(src, onProgress) {
  const { tf, processor, model } = await loadVlm(onProgress);
  const image = await tf.RawImage.fromCanvas(toCanvas(src, 1024));
  const text = processor.apply_chat_template([{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: PROMPT }] }], { add_generation_prompt: true });
  const inputs = await processor(text, image);
  const t0 = performance.now();
  const out = await model.generate({ ...inputs, max_new_tokens: 80, do_sample: false });
  const ms = performance.now() - t0;
  const answer = processor.batch_decode(out.slice(null, [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true })[0] || '';
  const json = answer.match(/\{[\s\S]*\}/);
  let d = {};
  try { d = json ? JSON.parse(json[0]) : {}; } catch { d = {}; }
  const amount = typeof d.betrag === 'number' ? d.betrag : parseFloat(String(d.betrag || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return {
    supplier: String(d.lieferant || '').trim().slice(0, 60),
    date: isoDate(d.datum),
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null,
    ms,
  };
}
