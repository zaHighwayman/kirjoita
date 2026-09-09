/* Deterministiset tekstimetriikat suomenkieliselle asiatekstille.
 *
 * Ei DOM:ia, ei verkkoa, ei satunnaisuutta — sama syöte antaa aina saman tuloksen.
 * Kaikki mitä voidaan laskea, lasketaan täällä; kielimalli ei näe näitä lukuja.
 *
 * Tarkkuudesta: osa mittareista on nimenomaisesti approksimaatioita. Ne on merkitty
 * kentässä `warnings`, eikä niitä saa käyttää pisteytykseen ilman että varoitus
 * kulkee mukana.
 */

import { stemFi } from './stemmer-fi.js';

/* ── Lyhenteet, jotka eivät päätä virkettä ───────────────────────────────── */
// Ilman tätä listaa jokainen "esim." katkaisee virkkeen ja kaikki pituusmitat valehtelevat.
export const ABBREVIATIONS = [
  'esim', 'mm', 'ns', 'jne', 'ym', 'yms', 'ts', 'eli', 'n', 'v', 's', 'nk',
  'ao', 'ko', 'vrt', 'huom', 'ks', 'jkl', 'tms', 'ent', 'nykyk', 'ao',
  'prof', 'tri', 'os', 'ao', 'lkm', 'ao', 'mrd', 'milj', 'tuh', 'kpl',
  'klo', 'ao', 'srk', 'yliop', 'toim', 'suom', 'engl', 'lat',
];
const ABBR = new Set(ABBREVIATIONS);

// Osa lyhenteistä esiintyy tyypillisesti luettelon lopussa, jolloin piste on
// oikeasti virkkeen loppupiste ("...maitoa jne. Sitten lähdimme."). Näiden
// kohdalla katkaisu sallitaan. "ym." jätetään pois, koska se esiintyy usein
// lähdeviitteen keskellä ("Virtanen ym. tutkivat").
const SENTENCE_FINAL_ABBR = new Set(['jne', 'yms', 'tms']);

/* ── Alistuskonjunktiot ──────────────────────────────────────────────────── */
// Suljettu lista, tarkka osuma. Monisanaiset ensin, jotta "ennen kuin" ei
// laskeudu pelkäksi "kuin"-osumaksi.
export const SUBORDINATORS = [
  'siitä huolimatta että', 'sen jälkeen kun', 'sikäli kuin', 'jos kohta',
  'ennen kuin', 'ikään kuin',
  'että', 'koska', 'kun', 'jos', 'vaikka', 'jotta', 'kunnes', 'mikäli',
  'sillä', 'jolloin', 'joten',
];

/* ── Lauseenvastikkeet ───────────────────────────────────────────────────── */
// Vartaloon osuvat, eivät päätteeseen, koska pääte taipuu.
const RE_FINAALI    = /\b\w{2,}[aä]kse(en|ni|si|mme|nne)\b/gu;
// Omistusliite on se, mikä erottaa temporaalin tavallisesta inessiivistä.
const RE_TEMPORAALI = /\b\w{2,}ess[aä](an|än|ni|si|nsa|nsä|mme|nne)\b/gu;
// Törmää -va-adjektiivien genetiiviin ("tulevan vuoden") ja antaa vääriä osumia.
// Raportoidaan erikseen, EI mukana missään pistemäärässä.
const RE_REFERATIIVI = /\b\w{2,}(van|vän)\b/gu;

const RE_NOMINAL_MINEN = /\b\w{3,}mise[a-zäö]*\b|\b\w{3,}minen\b/gu;
const RE_NOMINAL_UUS   = /\b\w{3,}(uude|yyde)[a-zäö]*\b|\b\w{3,}(uus|yys)\b/gu;
const RE_PASSIVE       = /\b\w{2,}(taan|tään|tiin|ttiin)\b/gu;
// Karkea finiittiverbin korvike passiivisuhteen nimittäjäksi.
const RE_FINITE_PROXY  = /\b\w{2,}(aa|ää|vat|vät|imme|itte|ivat|ivät|isi|nut|nyt|neet|taan|tään|tiin|ttiin|an|än|en|in|on|ee|oo)\b/gu;

const WORD_RE = /[a-zA-ZäöåÄÖÅ][a-zA-ZäöåÄÖÅ-]*/gu;

function countMatches(text, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

/* ── Virkejako ───────────────────────────────────────────────────────────── */
/**
 * Katkaisee .!? kohdalla, kun perässä on väli ja iso alkukirjain.
 * Ei katkaise lyhenteen, järjestysluvun eikä desimaaliluvun jälkeen.
 */
export function splitSentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Perässä on oltava väli ja iso alkukirjain (tai tekstin loppu).
    const rest = s.slice(i + 1);
    const m = /^(["»')\]]*)\s+(\S)/u.exec(rest);
    if (!m) {
      if (i === s.length - 1) { out.push(s.slice(start).trim()); start = s.length; }
      continue;
    }
    const next = m[2];
    if (next !== next.toUpperCase() || next === next.toLowerCase()) continue;

    if (ch === '.') {
      const before = s.slice(start, i);
      // Desimaaliluku: 3.14 — seuraava merkki olisi numero, jo torjuttu ylempänä.
      // Järjestysluku: "3." tai "1900-luvun 3." → ei virkeraja.
      if (/(^|\s)\d+$/u.test(before)) continue;
      const lastWord = (/([A-Za-zÄÖÅäöå]+)$/u.exec(before) || [])[1];
      const lw = lastWord && lastWord.toLowerCase();
      if (lw && ABBR.has(lw) && !SENTENCE_FINAL_ABBR.has(lw)) continue;
      // Yksikirjaiminen alkukirjainlyhenne: "J. K. Paasikivi"
      if (lastWord && lastWord.length === 1) continue;
    }
    const end = i + 1 + m[1].length;
    out.push(s.slice(start, end).trim());
    start = end;
  }
  if (start < s.length) {
    const tail = s.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out.filter(Boolean);
}

export function tokenizeWords(text) {
  return (String(text || '').match(WORD_RE) || []).map(w => w.toLowerCase());
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function round(x, d = 2) { const f = 10 ** d; return Math.round(x * f) / f; }

/* ── MTLD ────────────────────────────────────────────────────────────────── */
/**
 * Pituusnormalisoitu leksikaalinen vaihtelu. Raaka TTR putoaa aina tekstin
 * pidetessä, joten lyhyt essee näyttäisi muuten rikkaammalta kuin pitkä.
 * McCarthy & Jarvis (2010), kaksisuuntainen, kynnys 0.72.
 */
export const MTLD_MIN_TOKENS = 100;
export function mtld(tokens, threshold = 0.72) {
  // MTLD on epävakaa lyhyillä teksteillä: jos TTR ei ehdi pudota kynnyksen alle,
  // tekijöitä kertyy liian vähän ja arvo räjähtää. Alle 100 sanan teksteistä
  // palautetaan null eikä arvausta — juuri tätä pituusharhaa mittari on torjumassa.
  if (tokens.length < MTLD_MIN_TOKENS) return null;
  const run = seq => {
    let factors = 0, types = new Set(), n = 0, ttr = 1;
    for (const t of seq) {
      n++; types.add(t); ttr = types.size / n;
      if (ttr <= threshold) { factors++; types = new Set(); n = 0; ttr = 1; }
    }
    if (n > 0) factors += (1 - ttr) / (1 - threshold);
    return factors > 0 ? seq.length / factors : seq.length;
  };
  return round((run(tokens) + run([...tokens].reverse())) / 2);
}

/* ── Pääfunktio ──────────────────────────────────────────────────────────── */
/**
 * @param {string} text
 * @returns {object} metriikat; `warnings` kertoo mitkä luvut ovat epätarkkoja.
 */
export function analyzeText(text) {
  const raw = String(text || '');
  const paragraphs = raw.split(/\n\s*\n+/u).map(p => p.trim()).filter(Boolean);
  const sentences = splitSentences(raw);
  const words = tokenizeWords(raw);
  const lower = raw.toLowerCase();
  const warnings = [];

  const sentLens = sentences.map(s => tokenizeWords(s).length).filter(n => n > 0);
  const paraLens = paragraphs.map(p => tokenizeWords(p).length);
  const nS = sentLens.length || 1;
  const nW = words.length;

  // Alistus
  let subordinatorTokens = 0;
  const typesUsed = new Set();
  let scan = ' ' + lower.replace(/[^\wäöå\s]/gu, ' ').replace(/\s+/gu, ' ') + ' ';
  for (const sub of SUBORDINATORS) {          // pisimmät ensin, poistetaan osumat
    const re = new RegExp('\\s' + sub.replace(/ /gu, '\\s') + '\\s', 'gu');
    const hits = (scan.match(re) || []).length;
    if (hits > 0) { subordinatorTokens += hits; typesUsed.add(sub); scan = scan.replace(re, ' '); }
  }
  const commaCount = (raw.match(/,/gu) || []).length;

  const finaali = countMatches(lower, RE_FINAALI);
  const temporaali = countMatches(lower, RE_TEMPORAALI);
  const referatiiviRaw = countMatches(lower, RE_REFERATIIVI);
  if (referatiiviRaw > 0) {
    warnings.push('referatiiviRaw on epäluotettava: kaava osuu myös -va/-vä-adjektiivien ' +
                  'genetiiviin (esim. "tulevan vuoden"). Ei saa käyttää pisteytykseen.');
  }

  const nominalMinen = countMatches(lower, RE_NOMINAL_MINEN);
  const nominalUus = countMatches(lower, RE_NOMINAL_UUS);
  const passiveHits = countMatches(lower, RE_PASSIVE);
  const finiteProxy = countMatches(lower, RE_FINITE_PROXY);

  const stems = words.map(stemFi);
  const rawTTR = nW ? new Set(stems).size / nW : 0;
  const mtldValue = mtld(stems);
  if (mtldValue === null && nW > 0) {
    warnings.push(`mtld on null: teksti on alle ${MTLD_MIN_TOKENS} sanaa (${nW}). ` +
                  'Käytä typeTokenRatio-arvoa vain saman pituisten tekstien vertailuun.');
  }

  return {
    // Perusluvut
    wordCount: nW,
    sentenceCount: sentLens.length,
    paragraphCount: paragraphs.length,

    // Pituusjakauma — hajonta on tärkein, vaihtelu merkitsee enemmän kuin keskiarvo
    meanSentenceLength: round(mean(sentLens)),
    medianSentenceLength: round(median(sentLens)),
    sdSentenceLength: round(sd(sentLens)),
    maxSentenceLength: sentLens.length ? Math.max(...sentLens) : 0,
    pctUnder8: round(sentLens.filter(n => n < 8).length / nS * 100, 1),
    pctOver25: round(sentLens.filter(n => n > 25).length / nS * 100, 1),

    // Alistus
    subordinatorTypes: typesUsed.size,
    subordinatorTokens,
    subordinatorsUsed: [...typesUsed],
    clauseDensityProxy: round((subordinatorTokens + commaCount) / nS),

    // Lauseenvastikkeet
    finaali, temporaali,
    lauseenvastikeTotal: finaali + temporaali,
    referatiiviRaw,

    // Rekisteri
    nominalisationDensity: round(nW ? (nominalMinen + nominalUus) / nW * 1000 : 0, 1),
    passiveHits,
    passiveRatio: round(finiteProxy ? passiveHits / finiteProxy : 0, 3),

    // Sanasto
    typeTokenRatio: round(rawTTR, 3),
    mtld: mtldValue,

    // Rakenne
    meanParagraphLength: round(mean(paraLens)),
    sdParagraphLength: round(sd(paraLens)),

    warnings,
  };
}
