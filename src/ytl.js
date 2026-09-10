/* YTL:n arvostelukohteet ja pisteasteikot — äidinkieli ja kirjallisuus.
 *
 * LÄHDE: Ylioppilastutkintolautakunnan määräykset ja hyvän vastauksen piirteet.
 *   Lukutaidon koe        60 p, kaksi tehtävää (24 p + 36 p)
 *   Kirjoitustaidon koe   60 p
 *   Yhteensä             120 p
 *
 * Syksystä 2026 alkaen käytössä ovat päivitetyt kriteerit; tämä tiedosto
 * noudattaa niitä, koska tavoitevuosi on 2028.
 *
 * HUOM. Sallitut pistearvot (lukutaito 24 p: 0,4,8,12,16,20,24 · 36 p:
 * 0,6,12,18,24,30,36 · kirjoitustaito: 0,10,20,30,40,50,60) ovat lautakunnan
 * julkaisemia. Se, että ne muodostuvat seitsemästä tasosta (0-6) skaalattuna
 * tehtävän maksimiin, on niistä tehty PÄÄTELMÄ, ei suora lainaus. Rakenne
 * sopii kaikkiin kolmeen asteikkoon täsmälleen.
 */

export const SCALE_LEVELS = 7;          // tasot 0..6

/** Arvostelukohteet kokeittain, lautakunnan nimillä ja järjestyksellä. */
export const YTL_EXAMS = {
  lukutaito: {
    id: 'lukutaito',
    label: 'Lukutaidon koe',
    labelGen: 'Lukutaidon kokeen',      // taivutettu muoto kehotteita varten
    total: 60,
    tasks: [{ id: 'lt-24', max: 24 }, { id: 'lt-36', max: 36 }],
    defaultMax: 36,
    criteria: [
      { key: 'sisalto',    name: 'Sisältö',                    weighted: false },
      { key: 'erittely',   name: 'Erittely',                   weighted: false },
      { key: 'paatelmat',  name: 'Päätelmät ja tulkinta',      weighted: true  },
      { key: 'kokonaiskuva', name: 'Kokonaiskuva lukutaidosta', weighted: false },
    ],
  },
  kirjoitustaito: {
    id: 'kirjoitustaito',
    label: 'Kirjoitustaidon koe',
    labelGen: 'Kirjoitustaidon kokeen',
    total: 60,
    tasks: [{ id: 'kt-60', max: 60 }],
    defaultMax: 60,
    criteria: [
      { key: 'nakokulma',    name: 'Näkökulma ja tekstin omaäänisyys', weighted: false },
      { key: 'aineistot',    name: 'Aineistojen käyttö',               weighted: false },
      { key: 'rakenne',      name: 'Tekstin rakenne',                  weighted: true  },
      { key: 'kieli',        name: 'Kieli ja ilmaisu',                 weighted: true  },
      { key: 'kokonaiskuva', name: 'Kokonaiskuva kirjoitustaidosta',   weighted: false },
    ],
  },
};

export const EXAM_IDS = Object.keys(YTL_EXAMS);
export function examSpec(examType) { return YTL_EXAMS[examType] || YTL_EXAMS.kirjoitustaito; }
export function criteriaFor(examType) { return examSpec(examType).criteria; }

/** Sallitut pistearvot annetulle maksimille: 7 tasoa, tasavälein. */
export function allowedPoints(max) {
  const step = max / (SCALE_LEVELS - 1);
  return Array.from({ length: SCALE_LEVELS }, (_, i) => Math.round(i * step));
}

/** Lähin sallittu pistearvo — malli ei saa keksiä väliarvoja. */
export function snapToScale(points, max) {
  const allowed = allowedPoints(max);
  const p = Math.max(0, Math.min(max, Number(points) || 0));
  return allowed.reduce((best, v) => Math.abs(v - p) < Math.abs(best - p) ? v : best, allowed[0]);
}

/** Piste → taso 0-6. */
export function levelOf(points, max) {
  return allowedPoints(max).indexOf(snapToScale(points, max));
}

/** Piste → Elon tarvitsema 0..1. */
export function pointsToResult(points, max) {
  return max > 0 ? Math.max(0, Math.min(1, snapToScale(points, max) / max)) : 0;
}

/** Sanallinen taso — sama seitsemänportaisuus kuin pisteissä. */
export const LEVEL_LABELS = [
  'Ei vastaa tehtävään', 'Heikko', 'Välttävä', 'Tyydyttävä', 'Hyvä', 'Kiitettävä', 'Erinomainen',
];
export function levelLabel(points, max) {
  return LEVEL_LABELS[Math.max(0, levelOf(points, max))] || '';
}

/**
 * Kokonaispisteet arvostelukohteista. Painotetut kohteet lasketaan kaksinkertaisina,
 * koska lautakunta painottaa niitä; tulos pyöristetään sallittuun arvoon.
 */
export function totalFromCriteria(criteriaScores, examType, max) {
  const spec = examSpec(examType);
  const m = max || spec.defaultMax;
  const byKey = Object.fromEntries((criteriaScores || []).map(c => [c.key, c]));
  let sum = 0, weight = 0;
  for (const c of spec.criteria) {
    const got = byKey[c.key];
    if (!got || typeof got.points !== 'number') continue;
    const w = c.weighted ? 2 : 1;
    sum += (got.points / m) * w;
    weight += w;
  }
  return weight ? snapToScale((sum / weight) * m, m) : 0;
}

/* ── Osataitojen kytkentä arvostelukohteisiin ───────────────────────────── */
/**
 * Sama osataito voi palvella eri arvostelukohdetta eri kokeessa: lähdeviittaus
 * on kirjoitustaidossa "Aineistojen käyttö", lukutaidossa osa erittelyä.
 * Avain on osataidon oma ryhmä (crit) taksonomiassa.
 */
export const SKILLGROUP_TO_YTL = {
  rakenne:       { kirjoitustaito: 'rakenne',   lukutaito: 'kokonaiskuva' },
  kieliasu:      { kirjoitustaito: 'kieli',     lukutaito: 'kokonaiskuva' },
  sanasto:       { kirjoitustaito: 'kieli',     lukutaito: 'kokonaiskuva' },
  argumentaatio: { kirjoitustaito: 'nakokulma', lukutaito: 'paatelmat' },
};

/** Yksittäiset poikkeukset, jotka eivät seuraa ryhmänsä oletusta. */
export const SKILL_TO_YTL = {
  'arg-lahdeviittaus':      { kirjoitustaito: 'aineistot', lukutaito: 'erittely' },
  'arg-aineiston-tulkinta': { kirjoitustaito: 'aineistot', lukutaito: 'paatelmat' },
  'arg-kasitteen-maarittely': { kirjoitustaito: 'nakokulma', lukutaito: 'erittely' },
  'arg-varaukset':          { kirjoitustaito: 'nakokulma', lukutaito: 'paatelmat' },
  'rak-otsikon-vastaavuus': { kirjoitustaito: 'nakokulma', lukutaito: 'sisalto' },
};

export function ytlCriterionFor(skillId, skillGroup, examType) {
  const exam = YTL_EXAMS[examType] ? examType : 'kirjoitustaito';
  const explicit = SKILL_TO_YTL[skillId];
  if (explicit && explicit[exam]) return explicit[exam];
  const grp = SKILLGROUP_TO_YTL[skillGroup];
  return (grp && grp[exam]) || criteriaFor(exam)[0].key;
}

/* ── Kuvasta luettujen nimien ja pisteiden tulkinta ─────────────────────── */
/**
 * Kuvassa lukeva arvostelukohteen nimi → tunniste. Malli palauttaa nimen siinä
 * muodossa kuin se paperilla lukee, joten täsmävertailu ei riitä.
 */
export function matchCriterionName(name, examType) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return null;
  for (const ex of (examType ? [examType] : EXAM_IDS)) {
    for (const c of criteriaFor(ex)) {
      const cn = c.name.toLowerCase();
      if (n === cn || n === c.key) return c.key;
      // Osuma kumpaankin suuntaan: "kieli" ~ "Kieli ja ilmaisu"
      const head = cn.split(' ja ')[0];
      if (n.includes(head) || head.includes(n)) return c.key;
    }
  }
  return null;
}

/** "32/60", "32 / 60", "32 p" tai "32" → { grade, max }. */
export function parseGradeSeen(str) {
  const t = String(str || '').replace(/,/g, '.').trim();
  if (!t) return null;
  const frac = t.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) return { grade: parseFloat(frac[1]), max: parseFloat(frac[2]) };
  const num = t.match(/(\d+(?:\.\d+)?)/);
  if (!num) return null;
  const g = parseFloat(num[1]);
  // Paljas luku: pisteitä jos se ylittää tavallisen kouluarvosana-asteikon.
  return { grade: g, max: g > 10 ? 60 : null };
}
