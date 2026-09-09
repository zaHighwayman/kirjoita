/* Renderöijät — §5:n auditin tulos.
 *
 * Vanhat 14 "harjoitustyyppiä" eivät olleet taitoja vaan esitysmuotoja. Osa niistä
 * oli sama esitysmuoto eri genrellä, ei eri taito. Auditissa 14 → 9.
 *
 * Romahtaneet (sama renderöijä, eri aihekehys — genre ei ole osataito):
 *   kirjoita + argumentoi + vertailu + pohdinta → free_production
 *   johdanto + paatos                          → passage_production
 *   luku_vastaus + luku_viittaus               → source_response
 *
 * Jokainen renderöijä ilmoittaa vaikeusalueensa Elo-asteikolla. Alue on lähtöarvio,
 * ei totuus: exercises.difficulty liikkuu portaikossa ja korjaa arvion.
 */

export const RENDERERS = {
  word_swap: {
    id: 'word_swap', exam: 'kirjoitustaito', label: 'Sanaston rikastus', legacy: ['tayta_aukot'],
    band: [900, 1250], retrieval: 'cued',
    skills: ['san-tasmallisyys','san-rekisteri','san-kliseet','san-abstraktisanasto','san-sivistyssanat','san-puhekielisyys'],
    fromOwnText: false,
  },
  sentence_rewrite: {
    id: 'sentence_rewrite', exam: 'kirjoitustaito', label: 'Muotoile uudelleen', legacy: ['muotoile'],
    band: [1000, 1400], retrieval: 'cued',
    skills: ['san-rekisteri','san-puhekielisyys','san-nominalisaatio','san-tasmallisyys','kie-virkerakenne','kie-passiivi'],
    fromOwnText: true,
  },
  sentence_combine: {
    id: 'sentence_combine', exam: 'kirjoitustaito', label: 'Yhdistä lauseet', legacy: ['siirtymä'],
    band: [950, 1350], retrieval: 'cued',
    skills: ['rak-siirtymailmaisut','rak-koherenssi','arg-myonnytys','kie-virkerakenne','kie-pilkku','kie-lauseenvastikkeet'],
    fromOwnText: true,
  },
  order_sentences: {
    id: 'order_sentences', exam: 'kirjoitustaito', label: 'Järjestä kappale', legacy: ['jarjesta'],
    band: [900, 1200], retrieval: 'recognition',
    skills: ['rak-jasennyksen-logiikka','rak-koherenssi','rak-ydinvirke','rak-kappalejako'],
    fromOwnText: true,
  },
  error_hunt: {
    id: 'error_hunt', exam: 'kirjoitustaito', label: 'Korjaa virheet', legacy: ['korjaa'],
    band: [950, 1350], retrieval: 'recognition',
    skills: ['kie-kongruenssi','kie-sijamuodot','kie-rektio','kie-pilkku','kie-lauseenvastikkeet','kie-virkerakenne','kie-aikamuodot','kie-oikeinkirjoitus'],
    fromOwnText: false,   // virheet on injektoitava, joten omaa tekstiä ei voi käyttää sellaisenaan
  },
  passage_production: {
    id: 'passage_production', exam: 'kirjoitustaito', label: 'Kirjoita jakso', legacy: ['johdanto','paatos'],
    band: [1200, 1600], retrieval: 'free',
    skills: ['rak-aloitusvirke','rak-johdanto-teesi','rak-paatoksen-sitominen','rak-otsikon-vastaavuus','arg-vaite','arg-kasitteen-maarittely','san-kliseet'],
    fromOwnText: false,
  },
  source_response: {
    id: 'source_response', exam: 'lukutaito', label: 'Aineistovastaus', legacy: ['luku_vastaus','luku_viittaus'],
    band: [1300, 1700], retrieval: 'free',
    skills: ['arg-aineiston-tulkinta','arg-lahdeviittaus','arg-perustelu','arg-varaukset','arg-nakokulma','rak-ydinvirke'],
    fromOwnText: false,
  },
  summarise: {
    id: 'summarise', exam: 'lukutaito', label: 'Tiivistelmä', legacy: ['tiivistelmä'],
    band: [1150, 1500], retrieval: 'free',
    skills: ['san-tasmallisyys','san-toisto','san-nominalisaatio','arg-aineiston-tulkinta','kie-virkerakenne'],
    fromOwnText: false,
  },
  free_production: {
    id: 'free_production', exam: 'kirjoitustaito', label: 'Vapaa tuotos', legacy: ['kirjoita','argumentoi','vertailu','pohdinta'],
    band: [1300, 1900], retrieval: 'free',
    skills: '*',          // mikä tahansa osataito
    fromOwnText: false,
    // Genre ei ole osataito vaan tehtävänannon kehys.
    frames: ['pohtiva','argumentoiva','vertaileva','kertova'],
  },
};

/** Renderöijä → kumman kokeen suoritusta se harjoittelee. */
export function examForRenderer(id) { return (RENDERERS[id] || {}).exam || 'kirjoitustaito'; }

export const RENDERER_IDS = Object.keys(RENDERERS);

/** Vanha tyyppitunnus → renderöijä, jotta olemassa oleva historia ei katkea. */
export const LEGACY_TO_RENDERER = Object.fromEntries(
  Object.values(RENDERERS).flatMap(r => r.legacy.map(l => [l, r.id]))
);

/** Renderöijät, joilla annettua osataitoa voi harjoitella. */
export function renderersForSkill(skillId) {
  return RENDERER_IDS.filter(id => {
    const r = RENDERERS[id];
    return r.skills === '*' || r.skills.includes(skillId);
  });
}

/** Hakuvaikeus: renderöijän alue rajaa, portaikko valitsee alueen sisältä. */
export function clampToBand(rendererId, difficulty) {
  const [lo, hi] = RENDERERS[rendererId].band;
  return Math.min(hi, Math.max(lo, difficulty));
}
