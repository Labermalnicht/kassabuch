// Branchenvorlagen, Buchungsarten für Bargeldbewegungen und bekannte Lieferanten.

export const TEMPLATES = {
  gastro: {
    tips: true,
    categories: ['Speisen', 'Getränke', 'Getränke und Speisen', 'Blumen', 'Hygieneartikel',
      'Reinigungsmittel', 'Renovierungsmaterial', 'Zeitungen u Zeitschriften',
      'Schädlingsbekämpfung', 'Tee', 'Büroartikel', 'Sonstiges'],
  },
  beauty: {
    tips: false,
    categories: ['Speisen u Getränke', 'Hygieneartikel', 'Kosmetik', 'Beauty-Artikel', 'Interio',
      'Blumen', 'Renovierungsmaterial', 'Elektroartikel', 'Büroartikel', 'Medizin', 'Sonstiges'],
  },
  empty: {
    tips: false,
    categories: ['Wareneinkauf', 'Büroartikel', 'Reinigungsmittel', 'Sonstiges'],
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
const FOOD = { gastro: 'Speisen', beauty: 'Speisen u Getränke', empty: 'Wareneinkauf' };
const PRESETS = [
  { re: /\b(inter|euro)?spar\b|warenhandels/i, name: 'SPAR', cat: FOOD },
  { re: /\bbilla\b/i, name: 'BILLA', cat: FOOD },
  { re: /\bhofer\b/i, name: 'HOFER KG', cat: FOOD },
  { re: /\blidl\b/i, name: 'LIDL', cat: FOOD },
  { re: /\bpenny\b/i, name: 'PENNY', cat: FOOD },
  { re: /\bmetro\b/i, name: 'METRO', cat: { gastro: 'Getränke und Speisen', beauty: 'Speisen u Getränke', empty: 'Wareneinkauf' } },
  { re: /transgourmet/i, name: 'Transgourmet Österreich GmbH', cat: { gastro: 'Getränke und Speisen', empty: 'Wareneinkauf' } },
  { re: /\bbipa\b/i, name: 'BIPA', cat: { any: 'Hygieneartikel' } },
  { re: /\bdm\b|drogerie ?markt/i, name: 'dm drogerie markt GmbH', cat: { any: 'Hygieneartikel' } },
  { re: /\bm(ü|ue|u)ller\b/i, name: 'Müller', cat: { any: 'Sonstiges' } },
  { re: /\baction\b/i, name: 'ACTION', cat: { any: 'Sonstiges' } },
  { re: /\bikea\b/i, name: 'IKEA', cat: { beauty: 'Interio', any: 'Sonstiges' } },
  { re: /\bobi\b/i, name: 'OBI Bau', cat: { any: 'Renovierungsmaterial' } },
  { re: /bauhaus/i, name: 'BAUHAUS Depot GmbH', cat: { any: 'Renovierungsmaterial' } },
  { re: /hornbach/i, name: 'HORNBACH', cat: { any: 'Renovierungsmaterial' } },
  { re: /apotheke/i, name: null, cat: { beauty: 'Medizin', any: 'Sonstiges' } },
  { re: /\bpagro\b/i, name: 'PAGRO', cat: { any: 'Büroartikel' } },
  { re: /\blibro\b/i, name: 'LIBRO', cat: { any: 'Büroartikel' } },
  { re: /media ?markt/i, name: 'Media Markt', cat: { beauty: 'Elektroartikel', any: 'Sonstiges' } },
  { re: /blumen|flowers|g(ä|a)rtnerei/i, name: null, cat: { any: 'Blumen' } },
];

export const KNOWN_CHAINS = PRESETS.map((p) => p.re);

// Vorschlag für Lieferantenname und Kategorie. Gelerntes hat Vorrang vor den Vorlagen.
export function suggest(biz, party) {
  const key = normKey(party);
  if (!key) return null;
  const learned = biz.suppliers && biz.suppliers[key];
  if (learned) return { name: learned.name, cat: biz.categories.includes(learned.cat) ? learned.cat : null, learned: true };
  for (const p of PRESETS) {
    if (p.re.test(party)) {
      let cat = p.cat[biz.template] ?? p.cat.any ?? null;
      if (cat && !biz.categories.includes(cat)) cat = null;
      return { name: p.name, cat, learned: false };
    }
  }
  return null;
}
