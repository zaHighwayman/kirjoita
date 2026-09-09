/* Yksikkötestit deterministiselle metriikkamoduulille.
   Painopiste siellä missä bugit ovat: lyhennejako ja lauseenvastikkeet. */

import { analyzeText, splitSentences, mtld, tokenizeWords } from '../src/metrics.js';
import { stemFi } from '../src/stemmer-fi.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });
const eq = (name, got, want) => ok(name, got === want, `sai ${JSON.stringify(got)}, odotettiin ${JSON.stringify(want)}`);

/* ── Virkejako: lyhenteet ── */
const abbrCases = [
  ['Tämä on lause. Tämä on toinen.', 2, 'perusjako'],
  ['Käytämme esim. tätä menetelmää. Se toimii hyvin.', 2, 'esim. ei katkaise'],
  ['Mukana olivat mm. Virtanen ja Laine. Kaikki tulivat.', 2, 'mm. ei katkaise'],
  ['Kokous alkaa n. kello viisi. Tule ajoissa.', 2, 'n. ei katkaise'],
  ['Tämä on ns. hiljainen tieto. Sitä on vaikea siirtää.', 2, 'ns. ei katkaise'],
  ['Ostimme leipää, maitoa jne. Sitten lähdimme kotiin.', 2, 'jne. ei katkaise'],
  ['Vrt. aiempi tutkimus. Tulokset poikkeavat.', 2, 'vrt. ei katkaise'],
  ['Juhla on 3. kesäkuuta. Kaikki ovat tervetulleita.', 2, 'järjestysluku ei katkaise'],
  ['Arvo on 3.14 yksikköä. Se riittää.', 2, 'desimaali ei katkaise'],
  ['Presidentti J. K. Paasikivi johti maata. Aika oli vaikea.', 2, 'nimikirjaimet eivät katkaise'],
  ['Onko tämä totta? Kyllä on.', 2, 'kysymysmerkki katkaisee'],
  ['Se oli uskomatonta! Kukaan ei odottanut sitä.', 2, 'huutomerkki katkaisee'],
  ['Yksi lause ilman pistettä', 1, 'ei loppupistettä'],
  ['', 0, 'tyhjä teksti'],
  ['Hän sanoi: "Tule tänne." Sitten hän lähti.', 2, 'lainausmerkki ennen väliä'],
  ['Tämä on lause. tämä jatkuu pienellä.', 1, 'pieni alkukirjain ei katkaise'],
];
for (const [text, want, label] of abbrCases) eq('jako: ' + label, splitSentences(text).length, want);

eq('jako: säilyttää sisällön',
   splitSentences('Käytämme esim. tätä. Se toimii.')[0], 'Käytämme esim. tätä.');

/* ── Lauseenvastikkeet ── */
const fin = analyzeText('Hän lähti kaupunkiin opiskellakseen lääkäriksi. Tulimme tänne nähdäksemme sinut.');
eq('finaali: kaksi osumaa', fin.finaali, 2);

const temp = analyzeText('Kotiin tullessaan hän huomasi oven auki. Lukiessani kirjaa nukahdin.');
eq('temporaali: kaksi osumaa', temp.temporaali, 2);

// Tavallinen inessiivi ilman omistusliitettä ei saa osua temporaaliin.
const notTemp = analyzeText('Talossa oli kylmä. Metsässä oli hiljaista. Kirjassa oli paljon sivuja.');
eq('temporaali: pelkkä inessiivi ei osu', notTemp.temporaali, 0);

const ref = analyzeText('Luulin hänen tulevan kotiin.');
ok('referatiivi: osuu', ref.referatiiviRaw >= 1, 'sai ' + ref.referatiiviRaw);
ok('referatiivi: varoitus mukana', ref.warnings.some(w => /referatiiviRaw/.test(w)));
const refFalse = analyzeText('Tulevan vuoden aikana ratkaisu on valmis.');
ok('referatiivi: tunnettu väärä osuma dokumentoitu',
   refFalse.referatiiviRaw >= 1 && refFalse.warnings.length > 0,
   'osumia=' + refFalse.referatiiviRaw);
ok('referatiivi: ei mukana lauseenvastikkeiden summassa',
   refFalse.lauseenvastikeTotal === 0, 'total=' + refFalse.lauseenvastikeTotal);

/* ── Alistuskonjunktiot ── */
const sub = analyzeText('Vaikka sää oli huono, lähdimme ulos, koska halusimme liikkua. Uskon että se kannatti.');
eq('alistus: kolme tyyppiä', sub.subordinatorTypes, 3);
eq('alistus: kolme osumaa', sub.subordinatorTokens, 3);

const multi = analyzeText('Ennen kuin aloitamme, tarkistetaan laitteet.');
ok('alistus: monisanainen tunnistuu', multi.subordinatorsUsed.includes('ennen kuin'), multi.subordinatorsUsed.join(','));
ok('alistus: monisanainen ei tuplaudu kuin-osumaksi', multi.subordinatorTokens === 1, 'tokens=' + multi.subordinatorTokens);

const noSub = analyzeText('Kissa istui matolla. Koira nukkui sohvalla.');
eq('alistus: ei osumia', noSub.subordinatorTokens, 0);

/* ── Pituusjakauma ── */
const varied = analyzeText('Hän tuli. Hän oli odottanut tätä hetkeä hyvin pitkään ja valmistautunut siihen huolellisesti monin tavoin. Sitten hän lähti.');
ok('pituus: hajonta > 0', varied.sdSentenceLength > 0, 'sd=' + varied.sdSentenceLength);
eq('pituus: kolme virkettä', varied.sentenceCount, 3);
ok('pituus: lyhyet tunnistuvat', varied.pctUnder8 > 0, 'pctUnder8=' + varied.pctUnder8);

const flat = analyzeText('Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti.');
ok('pituus: tasainen teksti, matala hajonta', flat.sdSentenceLength < 1.5, 'sd=' + flat.sdSentenceLength);

/* ── Rekisteri ── */
const nom = analyzeText('Kirjoittaminen ja lukeminen ovat taitoja. Mahdollisuus vaikuttaa on tärkeä.');
ok('nominalisaatio: tiheys > 0', nom.nominalisationDensity > 0, 'd=' + nom.nominalisationDensity);
const noNom = analyzeText('Kissa istui matolla. Koira juoksi pihalla.');
eq('nominalisaatio: ei osumia', noNom.nominalisationDensity, 0);

const pass = analyzeText('Asiasta puhutaan paljon. Päätös tehtiin eilen.');
ok('passiivi: osumia', pass.passiveHits >= 2, 'hits=' + pass.passiveHits);
ok('passiivi: suhde välillä 0-1', pass.passiveRatio >= 0 && pass.passiveRatio <= 1, 'r=' + pass.passiveRatio);

/* ── Sanasto ── */
ok('mtld: lyhyt teksti palauttaa null', mtld(tokenizeWords('Yksi kaksi kolme.')) === null);
const shortText = analyzeText('Kissa istui matolla. Koira nukkui sohvalla. Lintu lauloi puussa.');
ok('mtld: lyhyestä tekstistä null + varoitus',
   shortText.mtld === null && shortText.warnings.some(w => /mtld/.test(w)),
   JSON.stringify(shortText.warnings));
const longWords = [];
for (let i = 0; i < 40; i++) longWords.push('kaupunki kasvaa nopeasti ja muuttuu jatkuvasti');
const longText = analyzeText(longWords.join('. ') + '.');
ok('mtld: pitkästä tekstistä luku', typeof longText.mtld === 'number' && longText.mtld > 0, 'mtld=' + longText.mtld);
// Molemmat yli 100 sanaa, jotta MTLD ylipäätään lasketaan ja vertailu on reilu.
const richText = [
 'Kaupunki kasvaa nopeasti ja muuttuu jatkuvasti.',
 'Asukkaat kohtaavat uudenlaisia haasteita päivittäin.',
 'Liikenne ruuhkautuu, palvelut kuormittuvat, asuminen kallistuu.',
 'Päättäjien on tehtävä valintoja, jotka kestävät tarkastelua myös tulevaisuudessa.',
 'Kaavoitus ohjaa rakentamista pitkälle eteenpäin.',
 'Viheralueet kaventuvat huomaamatta vuosikymmenten kuluessa.',
 'Joukkoliikenne tarvitsee investointeja toimiakseen luotettavasti.',
 'Segregaatio uhkaa jakaa kaupunginosat eriarvoisiin lohkoihin.',
 'Asuntopolitiikka vaikuttaa siihen, kuka voi jäädä keskustaan.',
 'Ilmastotavoitteet edellyttävät tiiviimpää yhdyskuntarakennetta.',
 'Tutkijat korostavat osallisuuden merkitystä suunnittelussa.',
 'Ratkaisut löytyvät harvoin yhdestä näkökulmasta.',
 'Kestävä kehitys vaatii pitkäjänteisyyttä poliittiselta järjestelmältä.',
 'Historia osoittaa, että hätiköidyt päätökset kostautuvat myöhemmin.',
 'Naapurustojen elinvoima riippuu palveluiden saavutettavuudesta.',
 'Vuokrataso karkaa monen nuoren ulottumattomiin.',
 'Täydennysrakentaminen herättää vastustusta vakiintuneilla alueilla.',
 'Kaupunkisuunnittelu on aina myös arvovalintojen tekemistä.',
 'Yhdenvertaisuus toteutuu vasta konkreettisissa ratkaisuissa.',
].join(' ');
const poorText = Array.from({length: 32}, (_, i) =>
  i % 2 === 0 ? 'Asia on hyvä asia.' : 'Asia on tärkeä asia.').join(' ');
const rich = analyzeText(richText);
const poor = analyzeText(poorText);
ok('mtld: molemmat lasketaan', typeof rich.mtld === 'number' && typeof poor.mtld === 'number',
   `rich=${rich.mtld} (${rich.wordCount} sanaa), poor=${poor.mtld} (${poor.wordCount} sanaa)`);
ok('mtld: rikas > köyhä', rich.mtld > poor.mtld, rich.mtld + ' vs ' + poor.mtld);
ok('ttr: rikas > köyhä', rich.typeTokenRatio > poor.typeTokenRatio, rich.typeTokenRatio + ' vs ' + poor.typeTokenRatio);

/* ── Stemmeri: TTR nojaa tähän ── */
// Snowball tuottaa vartaloita, ei perusmuotoja: "kissalle" → "kis" on oikea tulos.
// TTR:n kannalta ratkaisevaa on että taivutusmuodot osuvat samaan vartaloon.
const conflationGroups = [
  ['talo','talossa','taloon','taloja','talot','talolle'],
  ['kirja','kirjaa','kirjoja','kirjassa','kirjat'],
  ['auto','autoni','autolla','autot'],
  ['yhteiskunta','yhteiskunnassa','yhteiskunnan'],
];
for (const g of conflationGroups) {
  const stems = new Set(g.map(stemFi));
  ok(`stem: ${g[0]} -ryhmä yhdistyy`, stems.size === 1, [...stems].join(','));
}
ok('stem: eri sanat pysyvät erillään',
   new Set(['talo','kirja','auto','kissa'].map(stemFi)).size === 4);
ok('stem: palauttaa aina merkkijonon',
   ['talo','x','äöå','pitkäsanahirviö'].every(w => typeof stemFi(w) === 'string'));

/* ── Rakenne ── */
const paras = analyzeText('Ensimmäinen kappale tässä.\n\nToinen kappale on selvästi pidempi kuin ensimmäinen kappale oli.\n\nKolmas.');
eq('kappaleet: kolme', paras.paragraphCount, 3);
ok('kappaleet: hajonta > 0', paras.sdParagraphLength > 0, 'sd=' + paras.sdParagraphLength);

/* ── Reunatapaukset ── */
const empty = analyzeText('');
eq('tyhjä: sanoja 0', empty.wordCount, 0);
eq('tyhjä: virkkeitä 0', empty.sentenceCount, 0);
ok('tyhjä: ei NaN-arvoja',
   Object.entries(empty).every(([, v]) => typeof v !== 'number' || Number.isFinite(v)),
   JSON.stringify(empty));
ok('null-syöte ei kaadu', (() => { try { analyzeText(null); return true; } catch { return false; } })());

/* ── Determinismi ── */
const t = 'Vaikka sää oli huono, lähdimme ulos. Hän tuli kotiin nähdäkseen meidät.';
ok('determinismi: sama syöte, sama tulos',
   JSON.stringify(analyzeText(t)) === JSON.stringify(analyzeText(t)));

export default results;
