/* Vilpinesto.
 *
 * Jokainen mittariin sidottu taito on pelattavissa. Jos virkerytmi pisteytetään
 * keskihajonnalla, oppii pultaamaan yhden 40 sanan virkkeen jokaisen työn perään:
 * luku näyttää hyvältä eikä mikään parane.
 *
 * Siksi kaksivaiheinen portti:
 *   mittari läpi → kielimalli vahvistaa → suoritus pisteytyy
 *   mittari läpi → kielimalli hylkää    → suoritus hylätään perusteluineen
 * Mittari yksin ei koskaan riitä läpipääsyyn.
 */

import { analyzeText } from './metrics.js';
import { callJSON } from './provider.js';

/**
 * Mittariportit taidoittain. check() saa deterministiset metriikat ja palauttaa
 * { pass, value, need, reason }. Vain nämä taidot ovat mittariin sidottuja;
 * muut arvioidaan pelkästään arvioijan tageilla.
 */
export const METRIC_GATES = {
  'kie-virkerytmi': {
    label: 'Virkerytmin vaihtelu',
    what: 'virkkeiden pituuden keskihajonta',
    check: m => ({ pass: m.sdSentenceLength >= 4 && m.sentenceCount >= 4,
                   value: m.sdSentenceLength, need: '≥ 4 (vähintään 4 virkettä)' }),
    // Tämä on se, mitä yksi bolttattu jättivirke tuottaa.
    llmAsk: 'Vaihteleeko virkerytmi luontevasti sisällön mukaan, vai onko tekstiin liitetty keinotekoisen pitkä tai lyhyt virke pelkästään vaihtelun vuoksi?',
  },
  'kie-virkerakenne': {
    label: 'Virkerakenteen selkeys',
    what: 'pisimmän virkkeen pituus',
    check: m => ({ pass: m.maxSentenceLength > 0 && m.maxSentenceLength <= 45,
                   value: m.maxSentenceLength, need: '≤ 45 sanaa' }),
    llmAsk: 'Pysyvätkö pitkätkin virkkeet hahmotettavina, vai onko rakenne katkeava tai sekava?',
  },
  'kie-lauseenvastikkeet': {
    label: 'Lauseenvastikkeet',
    what: 'lauseenvastikkeiden määrä',
    check: m => ({ pass: m.lauseenvastikeTotal >= 1,
                   value: m.lauseenvastikeTotal, need: '≥ 1' }),
    llmAsk: 'Ovatko lauseenvastikkeet muodostettu oikein ja onko niiden tekijä sama kuin päälauseessa, vai onko niitä tungettu tekstiin väkisin?',
  },
  'san-nominalisaatio': {
    label: 'Nominalisaatio',
    what: 'nominalisaatioiden tiheys (per 1000 sanaa)',
    // Ylätuloskin on virhe: nominalisaatiotykitys tekee tekstistä raskaan.
    check: m => ({ pass: m.nominalisationDensity >= 8 && m.nominalisationDensity <= 60,
                   value: m.nominalisationDensity, need: '8–60' }),
    llmAsk: 'Tiivistävätkö teonnimirakenteet ilmaisua, vai tekevätkö ne tekstistä kankean ja raskaan?',
  },
  'san-toisto': {
    label: 'Toiston välttäminen',
    what: 'leksikaalinen vaihtelu (MTLD tai TTR)',
    check: m => (m.mtld != null
      ? { pass: m.mtld >= 45, value: m.mtld, need: 'MTLD ≥ 45' }
      : { pass: m.typeTokenRatio >= 0.55, value: m.typeTokenRatio, need: 'TTR ≥ 0.55 (lyhyt teksti)' }),
    llmAsk: 'Palveleeko sanaston vaihtelu merkitystä, vai onko synonyymejä vaihdeltu niin että ilmaisu muuttuu epätäsmälliseksi?',
  },
  'rak-kappalejako': {
    label: 'Kappalejako',
    what: 'kappaleiden määrä',
    check: m => ({ pass: m.paragraphCount >= 2 && m.meanParagraphLength >= 25,
                   value: m.paragraphCount, need: '≥ 2 kappaletta, keskipituus ≥ 25 sanaa' }),
    llmAsk: 'Vastaako kappalejako ajatuskokonaisuuksia, vai onko teksti pilkottu mielivaltaisesti kappalemäärän kasvattamiseksi?',
  },
  'rak-siirtymailmaisut': {
    label: 'Siirtymäilmaisut',
    what: 'eri alistuskonjunktioiden määrä',
    check: m => ({ pass: m.subordinatorTypes >= 2,
                   value: m.subordinatorTypes, need: '≥ 2 eri ilmaisua' }),
    llmAsk: 'Ilmaisevatko siirtymät todellista loogista suhdetta, vai onko sidesanoja ripoteltu tekstiin ilman että ne vastaavat ajatuksen kulkua?',
  },
  'kie-passiivi': {
    label: 'Passiivin käyttö',
    what: 'passiivin osuus',
    check: m => ({ pass: m.passiveRatio <= 0.4, value: m.passiveRatio, need: '≤ 0.40' }),
    llmAsk: 'Onko passiivia käytetty perustellusti, vai peitetäänkö sillä tekijä silloin kun tekijä olisi olennainen?',
  },
};

export const GATED_SKILLS = Object.keys(METRIC_GATES);
export const isGated = skillId => !!METRIC_GATES[skillId];

/**
 * Vaihe 1: deterministinen portti. Ei verkkoa, ei kustannusta.
 * @returns {{gated:boolean, pass:boolean, value?:number, reason?:string}}
 */
export function checkMetricGate(skillId, textOrMetrics) {
  const gate = METRIC_GATES[skillId];
  if (!gate) return { gated: false, pass: true };
  const m = typeof textOrMetrics === 'string' ? analyzeText(textOrMetrics) : textOrMetrics;
  const r = gate.check(m);
  return {
    gated: true, pass: !!r.pass, value: r.value, metrics: m,
    reason: r.pass ? null
      : `${gate.label}: ${gate.what} oli ${r.value}, vaadittu ${r.need}.`,
  };
}

/**
 * Vaihe 2: kielimalli vahvistaa, että luku syntyi oikeasta kirjoittamisesta.
 * Palauttaa { genuine, reason }. Verkkovirhe ei saa hylätä suoritusta, joten
 * epäonnistunut tarkistus tulkitaan hyväksi (fail-open) ja merkitään.
 */
export async function confirmNotGamed(skillId, text, llmConfig, callFn = callJSON) {
  const gate = METRIC_GATES[skillId];
  if (!gate) return { genuine: true, checked: false };
  const messages = [
    { role: 'system', content:
      'Olet suomen kielen arvioija. Tehtäväsi on erottaa aito kirjoitustaito tilastollisesta ' +
      'huijaamisesta: teksti voi täyttää mittarin vaikka se olisi kömpelö tai keinotekoinen. ' +
      'Vastaa VAIN JSON-muodossa: {"genuine": true|false, "reason": "<enintään 25 sanaa suomeksi>"}' },
    { role: 'user', content:
      `TAITO: ${gate.label}\nKYSYMYS: ${gate.llmAsk}\n\nTEKSTI:\n"""${text}"""\n\n` +
      'Palauta {"genuine": true} jos teksti on luettava ja tarkoituksenmukainen tämän taidon osalta. ' +
      'Palauta {"genuine": false} jos mittari on täytetty keinotekoisesti. Perustele lyhyesti suomeksi.' },
  ];
  try {
    const out = await callFn(messages, { role: 'check', config: llmConfig, maxTokens: 600, temperature: 0 });
    return { genuine: out.genuine !== false, reason: out.reason || '', checked: true };
  } catch (e) {
    // Tarkistus ei toiminut — ei rangaista käyttäjää verkkovirheestä.
    return { genuine: true, reason: '', checked: false, error: e.message };
  }
}

/**
 * Koko portti yhdelle taidolle.
 * Mittari kiinni → hylätty. Mittari auki + malli hylkää → hylätty.
 * Vain molempien läpäisy pisteyttää.
 *
 * @returns {{skillId, result, passed, stage, explanation, metricValue, checked}}
 */
export async function verifySkillAttempt(skillId, text, proposedResult, llmConfig, callFn = callJSON) {
  const gate = checkMetricGate(skillId, text);
  if (!gate.gated) return { skillId, result: proposedResult, passed: true, stage: 'ei-porttia', explanation: null };

  if (!gate.pass) {
    return { skillId, result: 0, passed: false, stage: 'mittari',
             explanation: gate.reason, metricValue: gate.value, checked: false };
  }
  const conf = await confirmNotGamed(skillId, text, llmConfig, callFn);
  if (!conf.genuine) {
    return { skillId, result: 0, passed: false, stage: 'tarkistus',
             explanation: `Mittari täyttyi, mutta teksti ei vakuuta: ${conf.reason}`,
             metricValue: gate.value, checked: true };
  }
  return { skillId, result: proposedResult, passed: true, stage: 'läpi',
           explanation: null, metricValue: gate.value, checked: conf.checked };
}

/** Portitetut taidot yhdestä tuotoksesta kerralla. */
export async function verifyAll(skillResults, text, llmConfig, callFn = callJSON) {
  const out = [];
  for (const [skillId, result] of skillResults) {
    out.push(isGated(skillId)
      ? await verifySkillAttempt(skillId, text, result, llmConfig, callFn)
      : { skillId, result, passed: true, stage: 'ei-porttia', explanation: null });
  }
  return out;
}
