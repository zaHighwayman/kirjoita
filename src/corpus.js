/* Korpus: käyttäjän omat esseet lähtötasojen johtamiseen.
 *
 * Kolme syötettä, kolme eri tehtävää — pidetään erillään (§4):
 *   4a opettajan kommentit → mitkä osataidot ylipäätään ovat olemassa
 *   4b arvosanat           → absoluuttinen ankkuri, ei mitään muuta
 *   4c metriikat           → suhteellinen heikkous lajityypin sisällä
 *   4d kronologia          → liikkuuko mikään
 *
 * n on 15. Tässä luetaan listaa, ei soviteta mallia.
 */

import { analyzeText } from './metrics.js';
import { callJSON } from './provider.js';
import { START_ELO } from './elo.js';

export const GENRES = ['referaatti', 'pohtiva', 'analyysi', 'kertova', 'muu'];
export const GENRE_LABELS = {
  referaatti: 'Referaatti', pohtiva: 'Pohtiva', analyysi: 'Analyysi',
  kertova: 'Kertova', muu: 'Muu',
};

/* ── Esseiden erottelu liitetystä tekstistä ─────────────────────────────── */
/**
 * Ensin eksplisiittinen erotin (--- tai ===), muuten kahden tyhjän rivin heuristiikka.
 * Käyttäjä vahvistaa rajat, joten heuristiikan ei tarvitse olla täydellinen —
 * sen pitää vain osua useimmiten oikeaan.
 */
export function splitEssays(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const byDelim = raw.split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n/);
  if (byDelim.length > 1) return byDelim.map(t => t.trim()).filter(Boolean);
  const byGap = raw.split(/\n{3,}/);
  if (byGap.length > 1) return byGap.map(t => t.trim()).filter(Boolean);
  return [raw];
}

export function newEssay(fields) {
  return {
    id: fields.id || `es_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    text: fields.text || '',
    source: fields.source || 'pasted',
    genre: fields.genre || 'muu',
    prompt: fields.prompt || null,
    date: fields.date || new Date().toISOString().slice(0, 10),
    grade: fields.grade ?? null,
    gradeScaleMax: fields.gradeScaleMax ?? null,
    teacherComment: fields.teacherComment || null,
    metrics: fields.metrics || analyzeText(fields.text || ''),
    llmAnalysis: fields.llmAnalysis || null,
  };
}

/* ── 4b. Arvosanat: absoluuttinen ankkuri ───────────────────────────────── */
export function median(nums) {
  const a = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Mediaaniarvosana lajityypissä → lähtö-Elo. Siinä kaikki.
 * Arvosanoja EI korreloida metriikoihin: n = 15 tuottaisi itsevarmaa hölynpölyä.
 * Asteikko normalisoidaan esseekohtaisesti, koska asteikot vaihtelevat.
 */
export function gradeAnchor(essays, genre) {
  const pool = (genre ? essays.filter(e => e.genre === genre) : essays)
    .filter(e => typeof e.grade === 'number' && e.gradeScaleMax > 0)
    .map(e => e.grade / e.gradeScaleMax);
  const med = median(pool);
  if (med == null) return { elo: START_ELO, basis: 'ei arvosanoja', n: 0 };
  return {
    elo: Math.round(Math.max(900, Math.min(1700, 800 + med * 800))),
    basis: `mediaani ${(med * 100).toFixed(0)} % asteikosta`,
    n: pool.length,
  };
}

/* ── 4c. Metriikat: suhteellinen heikkous ───────────────────────────────── */
/** YTL:n hyvän vastauksen piirteitä vastaavat karkeat odotusalueet lajityypeittäin. */
export const GENRE_BANDS = {
  _default: {
    sdSentenceLength:     [4, 11],
    meanSentenceLength:   [11, 22],
    subordinatorTypes:    [3, 99],
    clauseDensityProxy:   [1.0, 4.0],
    nominalisationDensity:[8, 55],
    mtld:                 [50, 200],
    paragraphCount:       [3, 99],
    lauseenvastikeTotal:  [1, 99],
    passiveRatio:         [0, 0.40],
  },
  referaatti: { nominalisationDensity: [15, 70], meanSentenceLength: [12, 24], paragraphCount: [2, 99] },
  kertova:    { nominalisationDensity: [2, 35], sdSentenceLength: [5, 14] },
};
export function bandsFor(genre) {
  return { ...GENRE_BANDS._default, ...(GENRE_BANDS[genre] || {}) };
}

/** Mikä metriikka kertoo mistäkin osataidosta. Yksi metriikka voi koskea useaa. */
export const METRIC_TO_SKILLS = {
  sdSentenceLength:      ['kie-virkerytmi'],
  meanSentenceLength:    ['kie-virkerakenne'],
  subordinatorTypes:     ['rak-siirtymailmaisut', 'kie-virkerakenne'],
  clauseDensityProxy:    ['kie-virkerakenne'],
  nominalisationDensity: ['san-nominalisaatio', 'san-rekisteri'],
  mtld:                  ['san-toisto', 'san-tasmallisyys'],
  paragraphCount:        ['rak-kappalejako'],
  lauseenvastikeTotal:   ['kie-lauseenvastikkeet'],
  passiveRatio:          ['kie-passiivi'],
};

/**
 * Vertaa mediaanimetriikkaa lajityypin odotusalueeseen.
 * Alle alueen → taito heikko (negatiivinen säätö). Yli ylärajan → myös poikkeama
 * (esim. nominalisaatiotykitys), mutta lievempi.
 */
export function metricWeakness(essays, genre) {
  const pool = (genre ? essays.filter(e => e.genre === genre) : essays).filter(e => e.metrics);
  if (!pool.length) return { adjustments: {}, findings: [] };
  const bands = bandsFor(genre);
  const adjustments = {}, findings = [];

  for (const [metric, [lo, hi]] of Object.entries(bands)) {
    const med = median(pool.map(e => e.metrics[metric]));
    if (med == null) continue;
    let adj = 0, verdict = 'alueella';
    if (med < lo) { adj = -120; verdict = 'alle odotuksen'; }
    else if (med > hi) { adj = -60; verdict = 'yli odotuksen'; }
    if (adj) {
      findings.push({ metric, median: med, band: [lo, hi], verdict, skills: METRIC_TO_SKILLS[metric] || [] });
      (METRIC_TO_SKILLS[metric] || []).forEach(s => { adjustments[s] = Math.min(adjustments[s] ?? 0, adj); });
    }
  }
  return { adjustments, findings, n: pool.length };
}

/* ── 4d. Kronologia ─────────────────────────────────────────────────────── */
/**
 * Ensimmäinen kolmannes vs viimeinen. Litteä käyrä ON tulos: kaksi vuotta ilman
 * liikettä tarkoittaa, ettei nykyinen harjoittelutapa toimi.
 */
export const CHRONO_METRICS = ['sdSentenceLength', 'subordinatorTypes', 'mtld',
                               'nominalisationDensity', 'clauseDensityProxy'];
export function chronologicalCheck(essays, minPerBucket = 2) {
  const dated = essays.filter(e => e.date && e.metrics).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const third = Math.floor(dated.length / 3);
  if (third < minPerBucket) {
    return { available: false, reason: `Liian vähän päivättyjä esseitä (${dated.length}).`, changes: [], flat: null };
  }
  const first = dated.slice(0, third), last = dated.slice(-third);
  const changes = CHRONO_METRICS.map(metric => {
    const a = median(first.map(e => e.metrics[metric]));
    const b = median(last.map(e => e.metrics[metric]));
    if (a == null || b == null) return null;
    // Nollasta nollaan on aito havainto — juuri se tapaus, jossa mikään ei ole
    // muuttunut (esim. alistuskonjunktioita ei käytetty silloin eikä nyt).
    let pctChange;
    if (a === 0 && b === 0) pctChange = 0;
    else if (a === 0) pctChange = 100;
    else pctChange = ((b - a) / Math.abs(a)) * 100;
    return { metric, first: a, last: b, pctChange };
  }).filter(Boolean);
  // "Litteä" = mikään seuratuista mittareista ei liikkunut yli 10 %.
  const flat = changes.length > 0 && changes.every(c => Math.abs(c.pctChange) < 10);
  return {
    available: true, n: dated.length, bucketSize: third, changes, flat,
    span: [dated[0].date, dated[dated.length - 1].date],
    message: flat
      ? 'Mittarit eivät ole liikkuneet korpuksen aikana. Tämä on itsessään havainto: nykyinen harjoittelutapa ei näytä muuttavan kirjoittamista.'
      : 'Mittareissa on liikettä korpuksen aikana.',
  };
}

/* ── 4a. Opettajan kommentit → osataidot (yksi LLM-kutsu) ───────────────── */
/**
 * Ainoa perusteltu päättelevä käyttö 15 esseen korpukselle: tämä lukee listaa,
 * ei sovita mallia. Teemat, jotka toistuvat 3+ esseessä, nousevat prioriteetiksi.
 */
export async function clusterComments(essays, taxonomy, llmConfig, callFn = callJSON) {
  const withComments = essays.filter(e => e.teacherComment && e.teacherComment.trim());
  if (withComments.length === 0) return { themes: [], priority: [], n: 0, skipped: 'ei kommentteja' };

  const menu = taxonomy.map(t => `${t.id} (${t.name})`).join(', ');
  const list = withComments.map((e, i) =>
    `[${i + 1}] genre=${e.genre} pvm=${e.date}\n"${e.teacherComment.trim()}"`).join('\n\n');

  const out = await callFn([
    { role: 'system', content:
      'Olet suomen kielen opettaja. Saat listan opettajien kommentteja saman opiskelijan esseistä. ' +
      'Ryhmittele TOISTUVAT moitteet teemoiksi. Älä keksi teemoja, joita kommenteissa ei ole. ' +
      'Yhdistä jokainen teema yhteen osataitoon alla olevasta listasta; jos mikään ei sovi, jätä skillId tyhjäksi.\n' +
      `OSATAIDOT: ${menu}\n\n` +
      'Vastaa VAIN JSONina: {"themes":[{"theme":"<lyhyt suomenkielinen nimi>","skillId":"<tunniste tai tyhjä>",' +
      '"essayCount":<monessako esseessä>,"essayIndexes":[<numerot>],"evidence":["<lainaus kommentista>"]}]}' },
    { role: 'user', content: `Kommentit (${withComments.length} kpl):\n\n${list}` },
  ], { role: 'classification', config: llmConfig, maxTokens: 3000, temperature: 0.2 });

  const byId = new Set(taxonomy.map(t => t.id));
  const themes = (out.themes || [])
    .map(t => ({
      theme: String(t.theme || '').trim(),
      skillId: byId.has(t.skillId) ? t.skillId : null,
      essayCount: Number(t.essayCount) || (Array.isArray(t.essayIndexes) ? t.essayIndexes.length : 0),
      evidence: (Array.isArray(t.evidence) ? t.evidence : []).map(String).slice(0, 5),
    }))
    .filter(t => t.theme);
  // 3+ esseessä toistuva = prioriteetti. Kertaluontoinen huomautus ei ole trendi.
  const priority = themes.filter(t => t.skillId && t.essayCount >= 3);
  return { themes, priority, n: withComments.length };
}

/* ── Yhdistäminen: lähtö-Elo per osataito ───────────────────────────────── */
/**
 * elo = arvosana-ankkuri + metriikkasäätö + kommenttiprioriteetti, rajattuna.
 * Painotettu kaava, ei malli.
 */
export const COMMENT_PENALTY = -150;
export function deriveStartingElo(taxonomy, { anchor, weakness, comments }) {
  const base = (anchor && anchor.elo) || START_ELO;
  const adj = (weakness && weakness.adjustments) || {};
  const priorityBySkill = {};
  ((comments && comments.priority) || []).forEach(p => { priorityBySkill[p.skillId] = p; });

  return taxonomy.map(t => {
    const metricAdj = adj[t.id] || 0;
    const prio = priorityBySkill[t.id];
    const commentAdj = prio ? COMMENT_PENALTY : 0;
    const elo = Math.round(Math.max(900, Math.min(1700, base + metricAdj + commentAdj)));
    const reasons = [];
    if (anchor && anchor.n) reasons.push(`arvosana-ankkuri ${base} (${anchor.basis})`);
    if (metricAdj) reasons.push(`metriikka ${metricAdj}`);
    if (commentAdj) reasons.push(`opettajan palaute ${commentAdj} (${prio.theme}, ${prio.essayCount} esseessä)`);
    return {
      id: t.id, label: t.name, crit: t.crit, elo,
      sourceEvidence: prio ? prio.evidence : [],
      derivation: reasons.length ? reasons.join(' · ') : 'ei näyttöä, lähtöarvo',
    };
  });
}

/* ── Rubriikkipohjainen esseeanalyysi (kerran per essee, välimuistiin) ──── */
export async function analyseEssay(essay, taxonomy, llmConfig, callFn = callJSON) {
  if (essay.llmAnalysis) return essay.llmAnalysis;              // välimuisti ikuisesti
  const menu = taxonomy.map(t => `${t.id} (${t.name})`).join(', ');
  const out = await callFn([
    { role: 'system', content:
      'Olet YTL:n kokenut arvioija. Arvioi essee hyvän vastauksen piirteiden mukaan. ' +
      'Vastaa VAIN JSONina. Käytä skillTag-kentissä TÄSMÄLLEEN annettuja tunnisteita.\n' +
      `OSATAIDOT: ${menu}` },
    { role: 'user', content:
      `GENRE: ${essay.genre}\n${essay.prompt ? 'TEHTÄVÄNANTO: ' + essay.prompt + '\n' : ''}` +
      `ESSEE:\n"""${essay.text}"""\n\n` +
      'Palauta: {"summary":"<2 lausetta>","strengths":[{"skillTag":"<id>","note":"<lyhyt>"}],' +
      '"weaknesses":[{"skillTag":"<id>","note":"<lyhyt>","example":"<lainaus esseestä>"}],' +
      '"bandEstimate":"<heikko|kehittyvä|hyvä|erinomainen>"}' },
  ], { role: 'analysis', config: llmConfig, maxTokens: 3000, temperature: 0.2 });

  const byId = new Set(taxonomy.map(t => t.id));
  const clean = arr => (Array.isArray(arr) ? arr : []).filter(x => byId.has(x.skillTag));
  return {
    summary: String(out.summary || ''),
    strengths: clean(out.strengths),
    weaknesses: clean(out.weaknesses),
    bandEstimate: out.bandEstimate || null,
    analysedAt: new Date().toISOString(),
  };
}
