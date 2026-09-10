/* Kuvista tekstiksi: valokuvatut ja merkatut esseet korpukseen.
 *
 * Opettaja merkitsee korjaukset tekstin päälle, joten pelkkä leikepöytä hukkaa
 * juuri sen tiedon, joka on arvokkainta. Kuvasta saadaan sekä oppilaan teksti
 * että opettajan merkinnät.
 *
 * KRIITTINEN VAATIMUS: transkription on oltava sanatarkka. Kielimallilla on
 * voimakas taipumus korjata kirjoitusvirheet huomaamattaan. Jos se tekee niin,
 * kieliasun mittarit mittaavat mallin kielitaitoa eivätkä opiskelijan, ja koko
 * kieliasu-ulottuvuus muuttuu arvottomaksi. Kehote kieltää korjaamisen useaan
 * kertaan, ja tulos merkitään aina epävarmaksi (needsReview).
 */

import { callJSON, hasVision } from './provider.js';

export const MAX_IMAGE_EDGE = 1600;     // px — riittää käsialalle, pitää pyynnön kohtuullisena
export const JPEG_QUALITY = 0.82;

/**
 * Skaalaa ja pakkaa kuvan selaimessa ennen lähetystä.
 * @returns {Promise<{mime:string, data:string, width:number, height:number}>} data = base64 ilman etuliitettä
 */
export function prepareImage(file, maxEdge = MAX_IMAGE_EDGE) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // läpinäkyvyys pois, muuten teksti katoaa
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        URL.revokeObjectURL(url);
        resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], width: w, height: h });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kuvaa ei voitu lukea.')); };
    img.src = url;
  });
}

const SYSTEM = `Olet tarkka litteroija. Saat valokuvia tai kuvakaappauksia opiskelijan esseestä, jonka opettaja on arvioinut.

AINEISTO KOOSTUU KAHDENLAISISTA SIVUISTA:
1. ESSEESIVUT — opiskelijan oma teksti. Korjattavat kohdat on usein korostettu ja
   merkitty yläindeksinumerolla, esim. "ja tämä^1)".
2. KOMMENTTISIVUT — opettajan yleiskommentti ja NUMEROITU LISTA korjauksista,
   esim. "1) , mikä" ja "13) Musiikkimarkkinat ovat nykyään niin suuret, että…".
   Numero viittaa esseessä olevaan samannumeroiseen korostukseen.

EHDOTTOMAT SÄÄNNÖT:

A) "text"-kenttään tulee VAIN opiskelijan oma esseeteksti. Numeroitua korjauslistaa,
   opettajan kommenttia tai otsikkoa "Kommentti" EI saa koskaan sisällyttää "text"-kenttään.
   Jos korjauslista päätyisi esseetekstiin, koko analyysi menisi pilalle.
   Älä myöskään sisällytä yläindeksinumeroita esseetekstiin.

B) Litteroi opiskelijan teksti TÄSMÄLLEEN sellaisena kuin se on.
   - ÄLÄ korjaa kirjoitusvirheitä, yhdyssanavirheitä, pilkkuja tai kongruenssia.
   - ÄLÄ ota korjauslistan korjauksia käyttöön tekstissä. Teksti jää virheelliseksi.
   - ÄLÄ paranna sanavalintoja, sanajärjestystä tai tyyliä.
   - ÄLÄ täydennä keskeneräisiä lauseita.
   - Jos opiskelija on kirjoittanut "monet ihmiset ajattelee", litteroi juuri niin.
   - Virheiden säilyttäminen on tämän tehtävän tärkein vaatimus. Siistitty litterointi on hyödytön.

C) Yhdistä numerot: jokaiselle korjauslistan numerolle etsi esseestä samalla numerolla
   merkitty kohta. Palauta pari: mihin kohtaan korjaus osuu ja mitä opettaja sanoo.
   Jos et löydä paria, palauta korjaus silti ilman "quote"-kenttää.

Jos jokin kohta on epäselvä, merkitse se hakasulkeisiin: [epäselvä]. Älä arvaa.

Vastaa VAIN JSON-muodossa.`;

function userPrompt(pageCount, roleHint) {
  return `Litteroi tämä yksi essee (${pageCount} sivua).${roleHint}

Palauta:
{
  "text": "<VAIN opiskelijan esseeteksti sanatarkasti, kappaleet erotettuna kahdella rivinvaihdolla>",
  "annotations": [
    {"marker":"<korjauksen numero, esim. 13>","quote":"<esseen kohta johon numero osuu>","note":"<opettajan korjaus tai huomautus>","kind":"pilkku|oikeinkirjoitus|muotoilu|sisalto|kehu|muu"}
  ],
  "teacherSummary": "<opettajan yleiskommentti kokonaisuudessaan, tai tyhjä>",
  "gradeSeen": "<näkyvä arvosana tai pistemäärä sellaisenaan, tai tyhjä>",
  "criterionPointsSeen": [{"name":"<arvostelukohteen nimi kuvassa>","points":<luku>}],
  "legible": true,
  "uncertainSpans": ["<kohta jota et saanut varmasti luettua>"]
}`;
}

/**
 * Litteroi yhden esseen sivuista.
 * @param {Array<{mime,data}>} images valmiiksi pakatut sivut järjestyksessä
 */
export async function transcribeEssay(images, llmConfig, callFn = callJSON) {
  if (!images || !images.length) throw new Error('Ei kuvia litteroitavaksi.');
  if (!hasVision(llmConfig)) {
    throw new Error('Kuvien lukeminen vaatii Gemini-avaimen tai kuvia tukevan Groq-mallin. Lisää avain Asetuksista.');
  }
  // Jos käyttäjä on merkinnyt sivujen roolit, kerrotaan ne mallille suoraan —
  // se on luotettavampaa kuin antaa mallin päätellä ne itse.
  const roles = images.map(im => im.role).filter(Boolean);
  const roleHint = roles.length === images.length
    ? '\n\nSivujen roolit järjestyksessä: ' + images.map((im, i) =>
        `sivu ${i + 1} = ${im.role === 'feedback' ? 'KOMMENTTISIVU' : 'ESSEESIVU'}`).join(', ') + '.'
    : '';
  const parts = [{ type: 'text', text: userPrompt(images.length, roleHint) }];
  images.forEach(img => parts.push({ type: 'image', mime: img.mime, data: img.data }));

  const out = await callFn(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: parts }],
    { role: 'vision', config: llmConfig, maxTokens: 8000, temperature: 0 }
  );

  const annotations = (Array.isArray(out.annotations) ? out.annotations : [])
    .filter(a => a && (a.quote || a.note))
    .map(a => ({ marker: a.marker != null ? String(a.marker) : '',
                 quote: String(a.quote || ''), note: String(a.note || ''), kind: a.kind || 'muu' }));

  return {
    text: String(out.text || '').trim(),
    annotations,
    teacherSummary: String(out.teacherSummary || '').trim(),
    gradeSeen: String(out.gradeSeen || '').trim(),
    criterionPointsSeen: (Array.isArray(out.criterionPointsSeen) ? out.criterionPointsSeen : [])
      .filter(c => c && typeof c.points === 'number')
      .map(c => ({ name: String(c.name || ''), points: c.points })),
    legible: out.legible !== false,
    uncertainSpans: (Array.isArray(out.uncertainSpans) ? out.uncertainSpans : []).map(String),
    // Litterointi on aina tarkistettava: mittarit lasketaan tästä tekstistä.
    needsReview: true,
    pages: images.length,
  };
}

/** Onko numeroitu korjauslista vuotanut esseetekstiin? */
export function looksLikeCorrectionList(text) {
  const numbered = (String(text || '').match(/(^|\n)\s*\d{1,2}\)\s/g) || []).length;
  return numbered >= 5;
}

/* ── Manuaalinen reitti: litterointi millä tahansa tekoälyllä ──────────── */
/**
 * Kaikilla ei ole API-avainta, ja kuvien lataaminen chat-käyttöliittymään on
 * usein helpompaa kuin avaimen hankkiminen. Sama kehote toimii Geminissä,
 * ChatGPT:ssä tai Claudessa: käyttäjä liittää kuvat, kopioi vastauksen ja
 * liittää sen takaisin tänne.
 *
 * Vastaus pyydetään JSONina, jotta merkinnät ja korjaukset säilyvät rakenteisina
 * eivätkä muutu pelkäksi tekstimassaksi.
 */
export function manualPrompt() {
  return `${SYSTEM}

---

Liitä tähän viestiin kuvat esseestä (ja mahdolliset kommenttisivut). Litteroi ne yllä olevien sääntöjen mukaan.

Jos kuvissa on useita eri esseitä, palauta TAULUKKO objekteja. Jos vain yksi essee, palauta yksi objekti.

Palauta VAIN JSON, ei mitään muuta tekstiä:

{
  "text": "<VAIN opiskelijan esseeteksti sanatarkasti, kappaleet erotettuna kahdella rivinvaihdolla>",
  "annotations": [
    {"marker":"<korjauksen numero>","quote":"<esseen kohta johon numero osuu>","note":"<opettajan korjaus>","kind":"pilkku|oikeinkirjoitus|muotoilu|sisalto|kehu|muu"}
  ],
  "teacherSummary": "<opettajan yleiskommentti kokonaisuudessaan, tai tyhjä>",
  "gradeSeen": "<näkyvä arvosana tai pistemäärä, tai tyhjä>",
  "criterionPointsSeen": [{"name":"<arvostelukohteen nimi>","points":<luku>}],
  "legible": true,
  "uncertainSpans": []
}`;
}

function coerceTranscript(o, index) {
  const anns = (Array.isArray(o.annotations) ? o.annotations : [])
    .filter(a => a && (a.quote || a.note))
    .map(a => ({ marker: a.marker != null ? String(a.marker) : '',
                 quote: String(a.quote || ''), note: String(a.note || ''), kind: a.kind || 'muu' }));
  return {
    text: String(o.text || '').trim(),
    annotations: anns,
    teacherSummary: String(o.teacherSummary || '').trim(),
    gradeSeen: String(o.gradeSeen || '').trim(),
    criterionPointsSeen: (Array.isArray(o.criterionPointsSeen) ? o.criterionPointsSeen : [])
      .filter(c => c && typeof c.points === 'number')
      .map(c => ({ name: String(c.name || ''), points: c.points })),
    legible: o.legible !== false,
    uncertainSpans: (Array.isArray(o.uncertainSpans) ? o.uncertainSpans : []).map(String),
    needsReview: true,
    pages: 0,
    source: 'manual',
    index,
  };
}

/**
 * Lukee liitetyn vastauksen. Ensisijaisesti JSON; jos se ei kelpaa, teksti
 * otetaan sellaisenaan esseenä, jottei käyttäjän työ mene hukkaan.
 * @returns {{transcripts:Array, parsed:boolean, error:string|null}}
 */
export function parseManualTranscript(raw) {
  const text = String(raw || '').trim();
  if (!text) return { transcripts: [], parsed: false, error: 'Tyhjä syöte.' };

  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  let data = null;
  try { data = JSON.parse(cleaned); }
  catch {
    const a = cleaned.indexOf('['), b = cleaned.lastIndexOf(']');
    if (a >= 0 && b > a) { try { data = JSON.parse(cleaned.slice(a, b + 1)); } catch {} }
    if (!data) {
      const c = cleaned.indexOf('{'), d = cleaned.lastIndexOf('}');
      if (c >= 0 && d > c) { try { data = JSON.parse(cleaned.slice(c, d + 1)); } catch {} }
    }
  }

  if (!data) {
    // Ei JSONia — otetaan teksti sellaisenaan yhtenä esseenä.
    return {
      transcripts: [coerceTranscript({ text: cleaned }, 0)],
      parsed: false,
      error: 'Vastaus ei ollut JSONia, joten se luettiin pelkkänä esseetekstinä. Opettajan merkinnät jäivät pois.',
    };
  }
  const list = Array.isArray(data) ? data : [data];
  const transcripts = list.filter(o => o && typeof o === 'object').map(coerceTranscript);
  if (!transcripts.length) return { transcripts: [], parsed: false, error: 'JSONista ei löytynyt esseitä.' };
  return { transcripts, parsed: true, error: null };
}

/** Litteroinnin luotettavuus lyhyesti — käyttäjälle näytettävä varoitus. */
export function transcriptionWarnings(t) {
  const w = [];
  if (looksLikeCorrectionList(t.text))
    w.push('Esseetekstiin näyttää päätyneen opettajan numeroitu korjauslista. Poista se ennen jatkamista — muuten mittarit laskevat opettajan tekstiä.');
  if (!t.legible) w.push('Malli ilmoitti, ettei kuva ollut kunnolla luettavissa.');
  if (t.uncertainSpans && t.uncertainSpans.length)
    w.push(`${t.uncertainSpans.length} kohtaa jäi epävarmaksi.`);
  if (/\[epäselvä\]/.test(t.text)) w.push('Tekstissä on [epäselvä]-merkintöjä.');
  if (!t.text || t.text.split(/\s+/).length < 30) w.push('Litteroitu teksti on hyvin lyhyt.');
  w.push('Tarkista litterointi ennen analyysiä: kielimalli korjaa herkästi kirjoitusvirheitä, ja se vääristäisi kieliasun mittarit.');
  return w;
}

/** Opettajan merkinnät yhdeksi tekstiksi kommenttien ryhmittelyä varten. */
export function annotationsToComment(t) {
  const lines = [];
  if (t.teacherSummary) lines.push(t.teacherSummary);
  (t.annotations || []).forEach(a => {
    if (a.note) lines.push(a.quote ? `"${a.quote}" → ${a.note}` : a.note);
  });
  return lines.join('\n');
}
