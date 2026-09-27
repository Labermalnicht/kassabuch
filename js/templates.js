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

// Vorschlag für Lieferantenname und Kategorie. Gelerntes hat Vorrang vor den Vorlagen.
export function suggest(biz, party) {
  const key = normKey(party);
  if (!key) return null;
  const learned = biz.suppliers && biz.suppliers[key];
  if (learned) return { name: learned.name, cat: biz.categories.includes(learned.cat) ? learned.cat : null, learned: true };
  for (const p of PRESETS) {
    if (p.re.test(party)) {
      const cat = p.cats.find((c) => biz.categories.includes(c)) || null;
      return { name: p.name, cat, learned: false };
    }
  }
  return null;
}
