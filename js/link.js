// Verbindung Handy -> PC: Das Handy schickt Belegfotos direkt an die App am PC (WebRTC, Gerät zu Gerät).
// Für den Verbindungsaufbau wird kurz der Vermittlungsdienst von PeerJS genutzt; die Fotos selbst gehen direkt
// und verschlüsselt vom Handy zum PC, im selben WLAN verlassen sie das Haus nicht.
// Kopplung: Der PC zeigt einen QR-Code mit seiner Kennung, das Handy liest ihn im Scanner und merkt sich die Kennung.

const PEER_LIB = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
export const PAIR_PREFIX = 'KASSABUCH-PC:';

let libPromise = null;
function loadPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PEER_LIB;
      s.onload = () => resolve(window.Peer);
      s.onerror = () => { libPromise = null; reject(new Error('peerjs')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

// QR-Code als SVG (für die Kopplung am PC).
const QRGEN_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrPromise = null;
export async function qrSvg(text) {
  if (!window.qrcode) {
    qrPromise = qrPromise || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QRGEN_LIB;
      s.onload = resolve;
      s.onerror = () => { qrPromise = null; reject(new Error('qrcode')); };
      document.head.appendChild(s);
    });
    await qrPromise;
  }
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

export const newPcId = () => `kassabuch-${[...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

// ---------- PC: empfangen ----------

let host = null; // { peer, conns, id }

/**
 * Startet den Empfang unter der festen Kennung id (bleibt über Neustarts gleich, damit das Handy gekoppelt bleibt).
 * onStatus(status, info): 'ready' | 'connected' | 'waiting' | 'error'. onReceipt(nachricht, antworten) für jedes Foto.
 */
export async function hostPc(id, { onStatus, onReceipt }) {
  if (host && host.id === id && !host.peer.destroyed) return;
  stopHost();
  const Peer = await loadPeer();
  const peer = new Peer(id);
  host = { peer, conns: new Set(), id };
  const me = host;
  peer.on('open', () => onStatus(me.conns.size ? 'connected' : 'ready'));
  peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
  peer.on('error', (e) => onStatus('error', e && e.type));
  peer.on('connection', (conn) => {
    conn.on('open', () => { me.conns.add(conn); onStatus('connected'); });
    conn.on('data', (msg) => {
      if (msg && msg.type === 'receipt') onReceipt(msg, (reply) => conn.send(reply));
    });
    conn.on('close', () => { me.conns.delete(conn); onStatus(me.conns.size ? 'connected' : 'waiting'); });
  });
}

export function stopHost() {
  if (host) host.peer.destroy();
  host = null;
}

export const hostConnected = () => !!(host && host.conns.size);

// ---------- Handy: senden ----------

let client = null; // { peer, conn, id }
const waiting = new Map(); // Nachrichten-ID -> Bestätigung

/** Verbindet mit dem PC. onStatus('connected' | 'lost' | 'error'). */
export async function connectPc(id, onStatus) {
  if (client && client.id === id && client.conn && client.conn.open) return true;
  disconnectPc();
  const Peer = await loadPeer();
  return new Promise((resolve) => {
    const peer = new Peer();
    client = { peer, conn: null, id };
    const me = client;
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    setTimeout(() => finish(false), 12000);
    peer.on('error', (e) => { onStatus('error', e && e.type); finish(false); });
    peer.on('open', () => {
      const conn = peer.connect(id, { reliable: true, serialization: 'binary' });
      me.conn = conn;
      conn.on('open', () => { onStatus('connected'); finish(true); });
      conn.on('data', (msg) => {
        if (msg && msg.type === 'ack' && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
      });
      conn.on('close', () => { if (client === me) onStatus('lost'); });
    });
  });
}

export function disconnectPc() {
  if (client) client.peer.destroy();
  client = null;
}

export const pcConnected = () => !!(client && client.conn && client.conn.open);

/** Schickt ein Foto; wartet auf die Bestätigung des PCs (höchstens 30 Sekunden). */
export function sendToPc(msg) {
  if (!pcConnected()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waiting.delete(msg.id); resolve(false); }, 30000);
    waiting.set(msg.id, () => { clearTimeout(timer); resolve(true); });
    client.conn.send(msg);
  });
}
