// Branchenvorlagen, Buchungsarten für Bargeldbewegungen und bekannte Lieferanten.

// Branchen: bestimmen nur, welche Kategorien vorgeschlagen werden (typische Barausgaben kleiner Betriebe).
// Die Kategorien lassen sich danach in den Einstellungen frei ändern.
export const BRANCHES = ['gastro', 'beauty', 'retail', 'craft', 'service', 'health', 'transport', 'empty'];

export const TEMPLATES = {
  gastro: {
    categories: ['Speisen', 'Getränke', 'Getränke und Speisen', 'Verpackung und Einweggeschirr',
      'Küchenbedarf', 'Reinigungsmittel', 'Hygieneartikel', 'Schädlingsbekämpfung', 'Blumen und Dekoration',
      'Renovierungsmaterial', 'Reparaturen', 'Zeitungen und Zeitschriften', 'Büroartikel', 'Porto', 'Sonstiges'],
  },
  beauty: {
    categories: ['Haar- und Kosmetikprodukte', 'Verbrauchsmaterial', 'Hygieneartikel', 'Reinigungsmittel',
      'Wäscherei', 'Einrichtung und Deko', 'Blumen und Dekoration', 'Elektrogeräte', 'Renovierungsmaterial',
      'Lebensmittel und Getränke', 'Zeitungen und Zeitschriften', 'Büroartikel', 'Porto', 'Sonstiges'],
  },
  retail: {
    categories: ['Wareneinkauf', 'Verpackung und Tragetaschen', 'Ladeneinrichtung und Deko', 'Reinigungsmittel',
      'Hygieneartikel', 'Renovierungsmaterial', 'Reparaturen', 'Lebensmittel und Getränke', 'Büroartikel',
      'Porto', 'Sonstiges'],
  },
  craft: {
    categories: ['Material', 'Werkzeug', 'Kleinteile', 'Arbeitskleidung', 'Treibstoff', 'Parken und Maut',
      'Fahrzeugpflege', 'Reinigungsmittel', 'Lebensmittel und Getränke', 'Büroartikel', 'Porto', 'Sonstiges'],
  },
  service: {
    categories: ['Büroartikel', 'Druck und Kopien', 'Porto', 'Fachliteratur', 'EDV-Zubehör', 'Bewirtung',
      'Lebensmittel und Getränke', 'Fahrtkosten und Parken', 'Reinigungsmittel', 'Einrichtung und Deko',
      'Sonstiges'],
  },
  health: {
    categories: ['Medizinischer Bedarf', 'Verbrauchsmaterial', 'Hygieneartikel', 'Reinigungsmittel', 'Wäscherei',
      'Einrichtung und Deko', 'Lebensmittel und Getränke', 'Büroartikel', 'Porto', 'Sonstiges'],
  },
  transport: {
    categories: ['Treibstoff', 'Parken und Maut', 'Fahrzeugpflege', 'Reparaturen', 'Fahrzeugzubehör',
      'Lebensmittel und Getränke', 'Büroartikel', 'Sonstiges'],
  },
  empty: {
    categories: ['Wareneinkauf', 'Material', 'Büroartikel', 'Porto', 'Reinigungsmittel', 'Reparaturen',
      'Lebensmittel und Getränke', 'Sonstiges'],
  },
};

// desc = Text, der im Kassabuch in der Spalte "Beschreibung" steht.
export const CASH_IN = [
  { id: 'einlage', de: 'Einlage Gesellschafter', en: 'Owner contribution', desc: 'Einlage von Gesellschafter', who: 'partner' },
  { id: 'bank', de: 'Bankabhebung', en: 'Bank withdrawal', desc: 'Bankabhebung', who: 'bank' },
  { id: 'nachlieferung', de: 'Nachlieferung Barmittel', en: 'Cash top-up', desc: 'Nachlieferung Barmittel' },
  { id: 'sonstige', de: 'Sonstige Einnahme', en: 'Other cash in', desc: '' },
];

export const CASH_OUT = [
  { id: 'bankeinzahlung', de: 'Bareinzahlung auf Bank', en: 'Cash deposit to bank', desc: 'Bareinlage', who: 'bank' },
  { id: 'auszahlung', de: 'Auszahlung Gesellschafter', en: 'Owner payout', desc: 'Auszahlung', who: 'partner' },
  { id: 'sonstige', de: 'Sonstige Ausgabe', en: 'Other cash out', desc: '' },
];

export const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
  'September', 'Oktober', 'November', 'Dezember'];

// Fixe Texte im Kassabuch (bleiben bewusst deutsch, weil das Buch zum österreichischen Steuerberater geht).
export const BOOK = {
  takings: 'Tageslosung BAR',
  takingsDesc: 'Gesamt',
  tips: 'Tips aus Karten',
  salary: 'Gehalt',
};

export const normKey = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

// Bekannte Ketten. name: einheitliche Schreibweise (null = Originalnamen behalten).
// cats: mögliche Kategorien in dieser Reihenfolge; genommen wird die erste, die der Betrieb hat.
// Ältere Kategorienamen stehen dabei, damit bestehende Betriebe weiter passende Vorschläge bekommen.
const FOOD = ['Speisen', 'Wareneinkauf', 'Lebensmittel und Getränke', 'Speisen u Getränke', 'Bewirtung'];
const WHOLESALE = ['Getränke und Speisen', 'Wareneinkauf', 'Lebensmittel und Getränke', 'Speisen u Getränke'];
const DRUGSTORE = ['Hygieneartikel', 'Haar- und Kosmetikprodukte', 'Verbrauchsmaterial', 'Reinigungsmittel', 'Sonstiges'];
const HARDWARE = ['Renovierungsmaterial', 'Material', 'Werkzeug', 'Reparaturen', 'Sonstiges'];
const DECOR = ['Einrichtung und Deko', 'Ladeneinrichtung und Deko', 'Blumen und Dekoration', 'Interio', 'Sonstiges'];
const PRESETS = [
  { re: /\b(inter|euro)?spar\b|warenhandels/i, name: 'SPAR', cats: FOOD },
  { re: /\bbilla\b/i, name: 'BILLA', cats: FOOD },
  { re: /\bhofer\b/i, name: 'HOFER KG', cats: FOOD },
  { re: /\blidl\b/i, name: 'LIDL', cats: FOOD },
  { re: /\bpenny\b/i, name: 'PENNY', cats: FOOD },
  { re: /\bmetro\b/i, name: 'METRO', cats: WHOLESALE },
  { re: /transgourmet/i, name: 'Transgourmet Österreich GmbH', cats: WHOLESALE },
  { re: /\bbipa\b/i, name: 'BIPA', cats: DRUGSTORE },
  { re: /\bdm\b|drogerie ?markt/i, name: 'dm drogerie markt GmbH', cats: DRUGSTORE },
  { re: /\bm(ü|ue|u)ller\b/i, name: 'Müller', cats: DRUGSTORE },
  { re: /\baction\b/i, name: 'ACTION', cats: ['Sonstiges'] },
  { re: /\bikea\b|m(ö|oe)belix|\bkika\b|xxxlutz/i, name: null, cats: DECOR },
  { re: /\bobi\b/i, name: 'OBI Bau', cats: HARDWARE },
  { re: /bauhaus/i, name: 'BAUHAUS Depot GmbH', cats: HARDWARE },
  { re: /hornbach/i, name: 'HORNBACH', cats: HARDWARE },
  { re: /apotheke/i, name: null, cats: ['Medizinischer Bedarf', 'Medizin', 'Hygieneartikel', 'Verbrauchsmaterial', 'Sonstiges'] },
  { re: /\bpagro\b|\blibro\b/i, name: null, cats: ['Büroartikel', 'Druck und Kopien', 'Sonstiges'] },
  { re: /media ?markt|saturn|hartlauer/i, name: null, cats: ['Elektrogeräte', 'EDV-Zubehör', 'Elektroartikel', 'Sonstiges'] },
  { re: /\b(omv|bp|shell|eni|avanti|turm(ö|oe)l|jet)\b.*|tankstelle/i, name: null, cats: ['Treibstoff', 'Fahrtkosten und Parken', 'Sonstiges'] },
  { re: /(ö|oe)sterreichische post|\bpost ag\b|postfiliale/i, name: 'Österreichische Post AG', cats: ['Porto'] },
  { re: /blumen|flowers|g(ä|a)rtnerei|floristik/i, name: null, cats: ['Blumen und Dekoration', 'Blumen', 'Einrichtung und Deko', 'Ladeneinrichtung und Deko', 'Sonstiges'] },
];

export const KNOWN_CHAINS = PRESETS.map((p) => p.re);

// Typische Lesefehler der Texterkennung angleichen: 0/O, 1/l/I, 5/S, 6/G, 8/B.
const fold = (s) => normKey(s).replace(/0/g, 'o').replace(/[1l]/g, 'i').replace(/5/g, 's').replace(/6/g, 'g').replace(/8/g, 'b');

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Ähnlichkeit zweier Namen zwischen 0 und 1.
export function similarity(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// Gespeicherten (vom Nutzer bestätigten) Lieferanten zu einem erkannten Text finden:
// exakt, als Teil einer längeren Zeile ("MUSTERFIRMA 0G Obsthandel") oder sehr ähnlich (ab 80 %).
export function findLearned(biz, text) {
  const sup = biz.suppliers || {};
  const key = normKey(text);
  if (!key) return null;
  if (sup[key]) return sup[key];
  const f = fold(text);
  let best = null;
  let bestScore = 0;
  for (const [k, v] of Object.entries(sup)) {
    const fk = fold(k);
    if (fk.length < 4) continue;
    let score = similarity(k, text);
    if (fk.length >= 5 && f.includes(fk)) score = Math.max(score, 0.95);
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return bestScore >= 0.8 ? best : null;
}

// Vorschlag für Lieferantenname und Kategorie. Gelerntes hat Vorrang vor den Vorlagen.
export function suggest(biz, party) {
  const key = normKey(party);
  if (!key) return null;
  const learned = findLearned(biz, party);
  if (learned) return { name: learned.name, cat: biz.categories.includes(learned.cat) ? learned.cat : null, learned: true };
  for (const p of PRESETS) {
    if (p.re.test(party)) {
      const cat = p.cats.find((c) => biz.categories.includes(c)) || null;
      return { name: p.name, cat, learned: false };
    }
  }
  return null;
}
