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

const SYSTEM = `Olet tarkka litteroija. Saat valokuvia opiskelijan käsin tai koneella kirjoitetusta esseestä, jossa opettaja on tehnyt merkintöjä tekstin päälle ja marginaaliin.

EHDOTON SÄÄNTÖ: litteroi opiskelijan teksti TÄSMÄLLEEN sellaisena kuin se on.
- ÄLÄ korjaa kirjoitusvirheitä, yhdyssanavirheitä, pilkkuja tai kongruenssia.
- ÄLÄ paranna sanavalintoja, sanajärjestystä tai tyyliä.
- ÄLÄ täydennä keskeneräisiä lauseita.
- Jos opiskelija on kirjoittanut "monet ihmiset ajattelee", litteroi juuri niin.
- Virheiden säilyttäminen on tämän tehtävän tärkein vaatimus. Korjattu litterointi on hyödytön.

Erota opiskelijan oma teksti ja opettajan merkinnät toisistaan. Opettajan merkinnät ovat tyypillisesti eri värillä, marginaalissa, yliviivauksina tai alleviivauksina.

Jos jokin kohta on epäselvä, merkitse se hakasulkeisiin: [epäselvä]. Älä arvaa.

Vastaa VAIN JSON-muodossa.`;

function userPrompt(pageCount) {
  return `Litteroi tämä essee (${pageCount} sivua). Palauta:
{
  "text": "<opiskelijan teksti sanatarkasti, kappaleet erotettuna kahdella rivinvaihdolla>",
  "annotations": [
    {"quote":"<kohta opiskelijan tekstistä johon merkintä osuu>","note":"<opettajan merkintä>","kind":"korjaus|kysymys|kehu|muu"}
  ],
  "teacherSummary": "<opettajan loppukommentti kokonaisuudessaan, tai tyhjä>",
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
  const parts = [{ type: 'text', text: userPrompt(images.length) }];
  images.forEach(img => parts.push({ type: 'image', mime: img.mime, data: img.data }));

  const out = await callFn(
    [{ role: 'system', content: SYSTEM }, { role: 'user', content: parts }],
    { role: 'vision', config: llmConfig, maxTokens: 8000, temperature: 0 }
  );

  const annotations = (Array.isArray(out.annotations) ? out.annotations : [])
    .filter(a => a && (a.quote || a.note))
    .map(a => ({ quote: String(a.quote || ''), note: String(a.note || ''), kind: a.kind || 'muu' }));

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

/** Litteroinnin luotettavuus lyhyesti — käyttäjälle näytettävä varoitus. */
export function transcriptionWarnings(t) {
  const w = [];
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
