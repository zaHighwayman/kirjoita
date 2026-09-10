/* Testit YTL:n arvostelukohteille ja pisteasteikoille. */
import { YTL_EXAMS, EXAM_IDS, examSpec, criteriaFor, allowedPoints, snapToScale,
         levelOf, pointsToResult, levelLabel, totalFromCriteria, SCALE_LEVELS,
         ytlCriterionFor, SKILL_TO_YTL, matchCriterionName, parseGradeSeen } from '../src/ytl.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

/* ── Asteikot vastaavat lautakunnan julkaisemia arvoja ── */
ok('asteikko: kirjoitustaito 0,10,...,60',
   allowedPoints(60).join(',') === '0,10,20,30,40,50,60', allowedPoints(60).join(','));
ok('asteikko: lukutaito 36 p → 0,6,...,36',
   allowedPoints(36).join(',') === '0,6,12,18,24,30,36', allowedPoints(36).join(','));
ok('asteikko: lukutaito 24 p → 0,4,...,24',
   allowedPoints(24).join(',') === '0,4,8,12,16,20,24', allowedPoints(24).join(','));
ok('asteikko: aina 7 tasoa', [24,36,60].every(m => allowedPoints(m).length === SCALE_LEVELS));
// Julkaistu yhdiste kaikista lukutaidon arvoista
ok('asteikko: lukutaidon yhdiste vastaa julkaistua',
   [...new Set([...allowedPoints(24), ...allowedPoints(36)])].sort((a,b)=>a-b).join(',')
   === '0,4,6,8,12,16,18,20,24,30,36',
   [...new Set([...allowedPoints(24), ...allowedPoints(36)])].sort((a,b)=>a-b).join(','));

ok('snap: väliarvo pyöristyy sallittuun', snapToScale(47, 60) === 50, String(snapToScale(47,60)));
ok('snap: alaraja', snapToScale(-5, 60) === 0);
ok('snap: yläraja', snapToScale(999, 60) === 60);
ok('snap: tasan puolivälissä valitsee jommankumman sallitun',
   allowedPoints(60).includes(snapToScale(45, 60)));
ok('snap: ei-numero → 0', snapToScale('abc', 60) === 0);

ok('taso: 0 p → taso 0', levelOf(0, 60) === 0);
ok('taso: max → taso 6', levelOf(60, 60) === 6);
ok('taso: 30/60 → taso 3', levelOf(30, 60) === 3);
ok('taso: sanallinen nimi', levelLabel(60, 60) === 'Erinomainen' && levelLabel(0, 60) === 'Ei vastaa tehtävään',
   levelLabel(60,60) + ' / ' + levelLabel(0,60));

ok('elo-tulos: max → 1', pointsToResult(60, 60) === 1);
ok('elo-tulos: 0 → 0', pointsToResult(0, 60) === 0);
ok('elo-tulos: puoliväli → 0.5', pointsToResult(30, 60) === 0.5);
ok('elo-tulos: aina 0..1', [0,7,33,59,60,99].every(p => { const r = pointsToResult(p,60); return r>=0 && r<=1; }));

/* ── Arvostelukohteet ── */
ok('kohteet: lukutaidolla neljä', criteriaFor('lukutaito').length === 4);
ok('kohteet: kirjoitustaidolla viisi', criteriaFor('kirjoitustaito').length === 5);
ok('kohteet: lukutaidon nimet lautakunnan mukaiset',
   criteriaFor('lukutaito').map(c => c.name).join(' | ')
   === 'Sisältö | Erittely | Päätelmät ja tulkinta | Kokonaiskuva lukutaidosta',
   criteriaFor('lukutaito').map(c => c.name).join(' | '));
ok('kohteet: kirjoitustaidon nimet lautakunnan mukaiset',
   criteriaFor('kirjoitustaito').map(c => c.name).join(' | ')
   === 'Näkökulma ja tekstin omaäänisyys | Aineistojen käyttö | Tekstin rakenne | Kieli ja ilmaisu | Kokonaiskuva kirjoitustaidosta',
   criteriaFor('kirjoitustaito').map(c => c.name).join(' | '));
ok('painotus: lukutaidossa päätelmät ja tulkinta',
   criteriaFor('lukutaito').filter(c => c.weighted).map(c => c.key).join(',') === 'paatelmat');
ok('painotus: kirjoitustaidossa rakenne ja kieli',
   criteriaFor('kirjoitustaito').filter(c => c.weighted).map(c => c.key).join(',') === 'rakenne,kieli');
ok('kokeet: molemmat 60 p, yhteensä 120',
   YTL_EXAMS.lukutaito.total === 60 && YTL_EXAMS.kirjoitustaito.total === 60);
ok('kokeet: lukutaidossa kaksi tehtävää 24 + 36',
   YTL_EXAMS.lukutaito.tasks.map(t => t.max).join('+') === '24+36');
ok('kokeet: tuntematon → kirjoitustaito', examSpec('outo').id === 'kirjoitustaito');
ok('kokeet: genetiivimuoto on kieliopillinen',
   examSpec('lukutaito').labelGen === 'Lukutaidon kokeen' &&
   examSpec('kirjoitustaito').labelGen === 'Kirjoitustaidon kokeen',
   examSpec('kirjoitustaito').labelGen);

/* ── Kokonaispisteet ── */
const full = k => criteriaFor(k).map(c => ({ key: c.key, points: 60 }));
ok('yhteispisteet: täydet → 60', totalFromCriteria(full('kirjoitustaito'), 'kirjoitustaito', 60) === 60);
ok('yhteispisteet: nollat → 0',
   totalFromCriteria(criteriaFor('kirjoitustaito').map(c => ({ key: c.key, points: 0 })), 'kirjoitustaito', 60) === 0);
// Painotus näkyy: heikkous painotetussa kohteessa maksaa enemmän
const weakWeighted = criteriaFor('kirjoitustaito').map(c => ({ key: c.key, points: c.key === 'rakenne' ? 0 : 60 }));
const weakPlain    = criteriaFor('kirjoitustaito').map(c => ({ key: c.key, points: c.key === 'aineistot' ? 0 : 60 }));
ok('yhteispisteet: painotettu kohde painaa enemmän',
   totalFromCriteria(weakWeighted, 'kirjoitustaito', 60) < totalFromCriteria(weakPlain, 'kirjoitustaito', 60),
   totalFromCriteria(weakWeighted,'kirjoitustaito',60) + ' vs ' + totalFromCriteria(weakPlain,'kirjoitustaito',60));
ok('yhteispisteet: tulos on sallittu arvo',
   allowedPoints(60).includes(totalFromCriteria(weakWeighted, 'kirjoitustaito', 60)));
ok('yhteispisteet: puuttuvat kohteet ohitetaan',
   totalFromCriteria([{ key:'rakenne', points: 60 }], 'kirjoitustaito', 60) === 60);
ok('yhteispisteet: tyhjä → 0', totalFromCriteria([], 'kirjoitustaito', 60) === 0);

/* ── Osataito → arvostelukohde ── */
ok('kytkentä: rakenne-taito → Tekstin rakenne (kirjoitustaito)',
   ytlCriterionFor('rak-kappalejako', 'rakenne', 'kirjoitustaito') === 'rakenne');
ok('kytkentä: kieliasu → Kieli ja ilmaisu', ytlCriterionFor('kie-pilkku', 'kieliasu', 'kirjoitustaito') === 'kieli');
ok('kytkentä: sanasto → Kieli ja ilmaisu', ytlCriterionFor('san-rekisteri', 'sanasto', 'kirjoitustaito') === 'kieli');
ok('kytkentä: lähdeviittaus → Aineistojen käyttö',
   ytlCriterionFor('arg-lahdeviittaus', 'argumentaatio', 'kirjoitustaito') === 'aineistot');
ok('kytkentä: sama taito eri kohteeseen eri kokeessa',
   ytlCriterionFor('arg-lahdeviittaus', 'argumentaatio', 'lukutaito') === 'erittely',
   ytlCriterionFor('arg-lahdeviittaus','argumentaatio','lukutaito'));
ok('kytkentä: aineiston tulkinta → Päätelmät ja tulkinta lukutaidossa',
   ytlCriterionFor('arg-aineiston-tulkinta', 'argumentaatio', 'lukutaito') === 'paatelmat');
ok('kytkentä: tuntematon ryhmä ei kaadu',
   !!ytlCriterionFor('outo-taito', 'outo', 'kirjoitustaito'));
ok('kytkentä: palauttaa aina olemassa olevan kohteen',
   ['rakenne','kieliasu','sanasto','argumentaatio'].every(g =>
     EXAM_IDS.every(ex => criteriaFor(ex).some(c => c.key === ytlCriterionFor('x', g, ex)))));

export default results;

/* ── Kuvasta luettujen arvojen tulkinta ── */
ok('nimitulkinta: tarkka nimi', matchCriterionName('Kieli ja ilmaisu', 'kirjoitustaito') === 'kieli');
ok('nimitulkinta: pienaakkoset', matchCriterionName('kieli ja ilmaisu', 'kirjoitustaito') === 'kieli');
ok('nimitulkinta: lyhennetty muoto', matchCriterionName('Kieli', 'kirjoitustaito') === 'kieli');
ok('nimitulkinta: tekstin rakenne', matchCriterionName('Tekstin rakenne', 'kirjoitustaito') === 'rakenne');
ok('nimitulkinta: aineistojen käyttö', matchCriterionName('Aineistojen käyttö', 'kirjoitustaito') === 'aineistot');
ok('nimitulkinta: lukutaidon kohde', matchCriterionName('Päätelmät ja tulkinta', 'lukutaito') === 'paatelmat');
ok('nimitulkinta: tunnistamaton → null', matchCriterionName('Jokin ihan muu', 'kirjoitustaito') === null);
ok('nimitulkinta: tyhjä → null', matchCriterionName('', 'kirjoitustaito') === null);
ok('nimitulkinta: palauttaa aina kelvollisen avaimen tai null', (() => {
  const k = matchCriterionName('Näkökulma ja tekstin omaäänisyys', 'kirjoitustaito');
  return k === null || criteriaFor('kirjoitustaito').some(c => c.key === k);
})());

ok('arvosana: 32/60', JSON.stringify(parseGradeSeen('32/60')) === JSON.stringify({grade:32,max:60}));
ok('arvosana: välilyönnit', JSON.stringify(parseGradeSeen('32 / 60')) === JSON.stringify({grade:32,max:60}));
ok('arvosana: pelkkä pistemäärä olettaa 60', parseGradeSeen('42 p').max === 60);
ok('arvosana: kouluarvosana ei oleta asteikkoa', parseGradeSeen('8').max === null);
ok('arvosana: desimaalipilkku', parseGradeSeen('8,5').grade === 8.5);
ok('arvosana: tyhjä → null', parseGradeSeen('') === null && parseGradeSeen('   ') === null);
ok('arvosana: ei numeroa → null', parseGradeSeen('hyvä') === null);
