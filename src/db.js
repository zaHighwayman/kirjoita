/* IndexedDB-säilö. localStorage vuotaa yli, kun korpus ja suorityshistoria kasvavat.
 *
 * Skeema §1:n mukaan: essays, skills, exercises, attempts.
 * Lisäksi kaksi käytännön säilöä: meta (käyttäjä ja asetukset) ja journal
 * (virhepäiväkirja, joka on jo käytössä käyttöliittymässä).
 */

export const DB_NAME = 'kirjoita';
export const DB_VERSION = 1;
export const STORES = ['essays', 'skills', 'exercises', 'attempts', 'journal', 'meta'];

let _dbPromise = null;

export function openDb(name = DB_NAME) {
  if (_dbPromise && name === DB_NAME) return _dbPromise;
  const p = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('essays')) {
        const s = db.createObjectStore('essays', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('genre', 'genre');
        s.createIndex('source', 'source');
      }
      if (!db.objectStoreNames.contains('skills')) {
        const s = db.createObjectStore('skills', { keyPath: 'id' });
        s.createIndex('dueAt', 'dueAt');
        s.createIndex('elo', 'elo');
      }
      if (!db.objectStoreNames.contains('exercises')) {
        const s = db.createObjectStore('exercises', { keyPath: 'id' });
        s.createIndex('skillId', 'skillId');
        s.createIndex('renderer', 'renderer');
        s.createIndex('difficulty', 'difficulty');
      }
      if (!db.objectStoreNames.contains('attempts')) {
        const s = db.createObjectStore('attempts', { keyPath: 'id' });
        s.createIndex('skillId', 'skillId');
        s.createIndex('exerciseId', 'exerciseId');
        s.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('journal')) {
        const s = db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
        s.createIndex('skillId', 'skillId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (name === DB_NAME) _dbPromise = p;
  return p;
}

function tx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export async function put(store, value, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readwrite').put(value));
}
export async function putAll(store, values, dbName) {
  const db = await openDb(dbName);
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  values.forEach(v => os.put(v));
  return new Promise((res, rej) => { t.oncomplete = () => res(values.length); t.onerror = () => rej(t.error); });
}
export async function get(store, key, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readonly').get(key));
}
export async function getAll(store, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readonly').getAll());
}
export async function byIndex(store, index, value, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readonly').index(index).getAll(value));
}
export async function del(store, key, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readwrite').delete(key));
}
export async function clearStore(store, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readwrite').clear());
}
export async function count(store, dbName) {
  return wrap(tx(await openDb(dbName), store, 'readonly').count());
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Siirtymä localStoragesta ────────────────────────────────────────────── */
import { START_ELO } from './elo.js';

/**
 * Vanha tili (kirjoita2_<koodi>) → IndexedDB. Ei tuhoa localStoragea:
 * jos jokin menee pieleen, alkuperäinen data on yhä tallella.
 *
 * mastery.strength (0..1) → lähtö-Elo. Konservatiivinen kartoitus: ±300 pistettä
 * 1200:n ympärillä, koska portaikko tekee varsinaisen kalibroinnin.
 */
export function strengthToElo(strength) {
  return Math.round(START_ELO + (Math.max(0, Math.min(1, strength)) - 0.5) * 600);
}

export async function migrateFromLocalStorage(code, taxonomy, dbName) {
  const raw = localStorage.getItem('kirjoita2_' + String(code).toUpperCase().trim());
  if (!raw) return { migrated: false, reason: 'tiliä ei löydy' };
  let u;
  try { u = JSON.parse(raw); } catch { return { migrated: false, reason: 'tili on korruptoitunut' }; }

  const already = await get('meta', 'migrated:' + code, dbName);
  if (already) return { migrated: false, reason: 'jo siirretty', at: already.value };

  const validIds = new Set((taxonomy || []).map(t => t.id));
  const mastery = u.mastery || {};
  const skills = (taxonomy || []).map(t => {
    const m = mastery[t.id];
    return {
      id: t.id, label: t.name, crit: t.crit,
      elo: m ? strengthToElo(m.strength) : START_ELO,
      srStep: 0,
      lastPractised: m && m.lastSeen ? new Date(m.lastSeen).toISOString() : null,
      dueAt: null,
      sourceEvidence: [],
      legacy: m ? { errorCount: m.errorCount || 0, cleanUses: m.cleanUses || 0 } : null,
    };
  });

  const journal = (u.errorJournal || [])
    .filter(e => validIds.has(e.skillId))
    .map(e => ({ skillId: e.skillId, quote: e.quote, correction: e.correction,
                 note: e.note, date: e.date, type: e.type }));

  // Vanha historia ei ole suorituksia Elon mielessä (ei harjoitus-id:tä eikä
  // 0..1-tulosta samalla asteikolla), joten se säilytetään metassa sellaisenaan.
  await putAll('skills', skills, dbName);
  if (journal.length) await putAll('journal', journal, dbName);
  await put('meta', { key: 'user:' + code, value: {
    code: u.code, name: u.name, model: u.model, xp: u.xp, level: u.level,
    streak: u.streak, lastActiveDay: u.lastActiveDay,
  }}, dbName);
  await put('meta', { key: 'legacyHistory:' + code, value: u.history || [] }, dbName);
  await put('meta', { key: 'migrated:' + code, value: new Date().toISOString() }, dbName);

  return { migrated: true, skills: skills.length, journal: journal.length,
           history: (u.history || []).length,
           seeded: Object.keys(mastery).filter(id => validIds.has(id)).length };
}
