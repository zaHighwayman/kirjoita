/* Elo-portaikko ja kertausväli. Puhtaita funktioita: ei tilaa, ei tallennusta.
 *
 * Korpus antaa lähtöarvot, portaikko tekee varsinaisen kalibroinnin. Huono
 * lähtöarvio maksaa kolme harjoitusta, ei koko järjestelmää.
 */

export const START_ELO = 1200;
export const K_SKILL = 24;       // taito liikkuu nopeasti
export const K_EXERCISE = 16;    // harjoitus liikkuu hitaammin
export const TARGET_SUCCESS = 0.8;
export const ELO_CEILING = 2000;   // jonon painotuksen yläraja

/** Todennäköisyys onnistua: standardi Elo-odotusarvo. */
export function expectedScore(skillElo, difficulty) {
  return 1 / (1 + Math.pow(10, (difficulty - skillElo) / 400));
}

/**
 * Vaikeus, jolla onnistumistodennäköisyys on p.
 * p = 0.8 → skillElo − 240.8, eli spesifikaation "≈ skillElo − 240".
 */
export function targetDifficulty(skillElo, p = TARGET_SUCCESS) {
  return skillElo - 400 * Math.log10(p / (1 - p));
}

/**
 * Elo-päivitys molempiin suuntiin. result ∈ [0,1].
 * Onnistuminen nostaa taitoa ja laskee harjoituksen vaikeutta.
 */
export function updateElo(skillElo, difficulty, result) {
  const r = Math.min(1, Math.max(0, result));
  const exp = expectedScore(skillElo, difficulty);
  return {
    skillElo: skillElo + K_SKILL * (r - exp),
    difficulty: difficulty + K_EXERCISE * (exp - r),
    expected: exp,
    surprise: r - exp,
  };
}

/* ── Kertausväli ─────────────────────────────────────────────────────────── */
// Elon päälle: taito voi olla vahva ja silti unohtua, jos siihen ei palata.
export const SR_INTERVALS = [1, 3, 7, 16, 35, 75, 150];   // vuorokausina
export const SR_SUCCESS_THRESHOLD = 0.7;
const DAY_MS = 86400000;

/** Onnistuminen kasvattaa väliä askeleen, epäonnistuminen palauttaa alkuun. */
export function nextSrStep(step, result) {
  return result >= SR_SUCCESS_THRESHOLD ? Math.min((step || 0) + 1, SR_INTERVALS.length - 1) : 0;
}

export function dueAtFrom(step, now = Date.now()) {
  return new Date(now + SR_INTERVALS[Math.min(step, SR_INTERVALS.length - 1)] * DAY_MS).toISOString();
}

export function isOverdue(skill, now = Date.now()) {
  return !!skill.dueAt && Date.parse(skill.dueAt) <= now;
}

/** Kuinka monta vuorokautta yli eräpäivän. Negatiivinen = ei vielä erääntynyt. */
export function overdueDays(skill, now = Date.now()) {
  if (!skill.dueAt) return Infinity;          // ei koskaan harjoiteltu → korkein prioriteetti
  return (now - Date.parse(skill.dueAt)) / DAY_MS;
}

/**
 * Tarjontajono. Erääntyneet menevät ensin Elosta riippumatta — muuten vahva
 * taito ei koskaan palaisi kertaukseen ja unohtuisi hiljaa.
 */
export function buildServeQueue(skills, now = Date.now()) {
  // Kolme kaistaa, jotta mikään ryhmä ei syö toista:
  //   2000+  erääntyneet     — myöhässäolo ratkaisee, Elosta riippumatta
  //   1000+  harjoittelemattomat — mitattava ensin; keskenään heikoin Elo edellä
  //     0+   ei vielä erääntyneet — heikoin Elo edellä
  // Ilman erillistä keskikaistaa kaikki koskemattomat taidot olisivat samanarvoisia
  // ja korpuksesta johdettu lähtötaso jäisi vaikutuksetta.
  const byWeakness = s => (ELO_CEILING - Math.min(ELO_CEILING, s.elo ?? START_ELO)) / 10;
  const scored = skills.map(s => {
    const od = overdueDays(s, now);
    let priority;
    if (od === Infinity)  priority = 1000 + byWeakness(s);
    else if (od >= 0)     priority = 2000 + Math.min(od, 500);
    else                  priority = byWeakness(s);
    return { skill: s, overdue: od >= 0 && od !== Infinity, priority };
  });
  return scored.sort((a, b) => b.priority - a.priority).map(x => x.skill);
}

/**
 * Yksi suoritus → uusi taito- ja harjoitustila.
 * Palauttaa uudet objektit; kutsuja tallentaa.
 */
export function applyAttempt(skill, exercise, result, now = Date.now()) {
  const { skillElo, difficulty, expected, surprise } =
    updateElo(skill.elo ?? START_ELO, exercise.difficulty ?? START_ELO, result);
  const step = nextSrStep(skill.srStep, result);
  return {
    skill: {
      ...skill,
      elo: skillElo,
      srStep: step,
      lastPractised: new Date(now).toISOString(),
      dueAt: dueAtFrom(step, now),
    },
    exercise: { ...exercise, difficulty },
    expected, surprise,
  };
}
