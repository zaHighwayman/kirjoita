/* Testit IndexedDB-säilölle ja localStorage-siirtymälle.
   Jokainen ajo käyttää omaa tietokantaansa, jotta testit eivät vuoda toisiinsa. */
import { openDb, put, putAll, get, getAll, byIndex, del, clearStore, count,
         newId, strengthToElo, migrateFromLocalStorage, STORES } from '../src/db.js';
import { START_ELO } from '../src/elo.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

const TAX = [
  { id:'kie-kongruenssi', name:'Kongruenssi', crit:'kieliasu' },
  { id:'rak-aloitusvirke', name:'Aloitusvirke', crit:'rakenne' },
  { id:'san-tasmallisyys', name:'Täsmällisyys', crit:'sanasto' },
];

export async function run() {
  const DB = 'kirjoita_test_' + Date.now();

  /* ── Skeema ── */
  const db = await openDb(DB);
  ok('db: kaikki säilöt luotu', STORES.every(s => db.objectStoreNames.contains(s)),
     [...db.objectStoreNames].join(','));
  ok('db: attempts-indeksit', (() => {
    const t = db.transaction('attempts','readonly').objectStore('attempts');
    return ['skillId','exerciseId','timestamp'].every(i => t.indexNames.contains(i));
  })());
  ok('db: skills-indeksit', (() => {
    const t = db.transaction('skills','readonly').objectStore('skills');
    return ['dueAt','elo'].every(i => t.indexNames.contains(i));
  })());

  /* ── CRUD ── */
  await put('skills', { id:'kie-pilkku', label:'Pilkkusäännöt', elo: 1150 }, DB);
  const got = await get('skills','kie-pilkku', DB);
  ok('crud: put + get', got && got.elo === 1150, JSON.stringify(got));
  await put('skills', { id:'kie-pilkku', label:'Pilkkusäännöt', elo: 1250 }, DB);
  ok('crud: put korvaa', (await get('skills','kie-pilkku', DB)).elo === 1250);

  await putAll('attempts', [
    { id:'a1', skillId:'kie-pilkku', exerciseId:'e1', result:1, timestamp: 1 },
    { id:'a2', skillId:'kie-pilkku', exerciseId:'e2', result:0, timestamp: 2 },
    { id:'a3', skillId:'rak-aloitusvirke', exerciseId:'e3', result:1, timestamp: 3 },
  ], DB);
  ok('crud: putAll', (await count('attempts', DB)) === 3);
  ok('crud: byIndex suodattaa', (await byIndex('attempts','skillId','kie-pilkku', DB)).length === 2);
  ok('crud: getAll palauttaa kaikki', (await getAll('attempts', DB)).length === 3);
  await del('attempts','a1', DB);
  ok('crud: delete', (await count('attempts', DB)) === 2);
  await clearStore('attempts', DB);
  ok('crud: clear', (await count('attempts', DB)) === 0);
  ok('crud: puuttuva avain → undefined', (await get('skills','ei-ole', DB)) === undefined);

  const ids = new Set(Array.from({length: 200}, () => newId('ex')));
  ok('newId: uniikki', ids.size === 200);
  ok('newId: etuliite', [...ids][0].startsWith('ex_'));

  /* ── strength → Elo ── */
  ok('elo-kartoitus: 0.5 → 1200', strengthToElo(0.5) === START_ELO);
  ok('elo-kartoitus: heikko alle 1200', strengthToElo(0.05) < START_ELO, String(strengthToElo(0.05)));
  ok('elo-kartoitus: vahva yli 1200', strengthToElo(0.95) > START_ELO, String(strengthToElo(0.95)));
  ok('elo-kartoitus: konservatiivinen ±300',
     strengthToElo(0) === 900 && strengthToElo(1) === 1500,
     strengthToElo(0)+'..'+strengthToElo(1));
  ok('elo-kartoitus: rajaa ylivuodon', strengthToElo(5) === 1500 && strengthToElo(-5) === 900);

  /* ── Siirtymä ── */
  const CODE = 'TEST-9999';
  localStorage.setItem('kirjoita2_' + CODE, JSON.stringify({
    code: CODE, name:'Axel', model:'openai/gpt-oss-120b', xp: 820, level: 5, streak: 9,
    lastActiveDay: null,
    history: [{ type:'kirjoita', prompt:'p', score: 7.2, xp: 30, date: 1 }],
    mastery: {
      'kie-kongruenssi': { skillId:'kie-kongruenssi', strength: 0.15, lastSeen: 1000, errorCount: 9, cleanUses: 1 },
      'poistettu-taito': { skillId:'poistettu-taito', strength: 0.9, lastSeen: 2000 },
    },
    errorJournal: [
      { skillId:'kie-kongruenssi', quote:'Monet ajattelee', correction:'ajattelevat', note:'', date: 1, type:'kirjoita' },
      { skillId:'poistettu-taito', quote:'x', correction:'y', note:'', date: 2, type:'kirjoita' },
    ],
  }));

  const m = await migrateFromLocalStorage(CODE, TAX, DB);
  ok('siirtymä: onnistui', m.migrated === true, JSON.stringify(m));
  ok('siirtymä: taidot luotu koko taksonomialle', m.skills === TAX.length, 'n=' + m.skills);
  const kk = await get('skills','kie-kongruenssi', DB);
  ok('siirtymä: heikko taito sai matalan Elon', kk.elo === strengthToElo(0.15), 'elo=' + kk.elo);
  ok('siirtymä: kohtaamaton taito sai 1200', (await get('skills','san-tasmallisyys', DB)).elo === START_ELO);
  ok('siirtymä: vanhat laskurit säilyivät', kk.legacy && kk.legacy.errorCount === 9);
  ok('siirtymä: lastPractised siirtyi', !!kk.lastPractised);
  ok('siirtymä: tuntematon taito ei tullut mukaan', (await get('skills','poistettu-taito', DB)) === undefined);
  const jr = await getAll('journal', DB);
  ok('siirtymä: päiväkirja siirtyi', jr.length === 1, 'n=' + jr.length);
  ok('siirtymä: päiväkirjasta karsittiin tuntematon taito', jr.every(e => e.skillId === 'kie-kongruenssi'));
  const user = await get('meta','user:' + CODE, DB);
  ok('siirtymä: xp ja streak säilyivät', user.value.xp === 820 && user.value.streak === 9);
  ok('siirtymä: vanha historia talletettiin', (await get('meta','legacyHistory:' + CODE, DB)).value.length === 1);
  ok('siirtymä: localStorage jätettiin koskematta', !!localStorage.getItem('kirjoita2_' + CODE));

  const again = await migrateFromLocalStorage(CODE, TAX, DB);
  ok('siirtymä: ei aja kahdesti', again.migrated === false && /jo siirretty/.test(again.reason), JSON.stringify(again));
  const missing = await migrateFromLocalStorage('EI-OLE', TAX, DB);
  ok('siirtymä: tuntematon koodi ei kaadu', missing.migrated === false);
  localStorage.setItem('kirjoita2_RIKKI', '{ ei json');
  const broken = await migrateFromLocalStorage('RIKKI', TAX, DB);
  ok('siirtymä: korruptoitunut tili ei kaadu', broken.migrated === false && /korruptoitunut/.test(broken.reason));

  localStorage.removeItem('kirjoita2_' + CODE);
  localStorage.removeItem('kirjoita2_RIKKI');
  indexedDB.deleteDatabase(DB);
  return results;
}
