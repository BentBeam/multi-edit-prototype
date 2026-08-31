/* Historik: sparade lägen av ett dokument.
 *
 * Yjs egna snapshots går inte att använda här – de kräver att skräpsamlingen är
 * avstängd, vilket skulle få dokumenten att växa i all oändlighet. I stället
 * sparas hela dokumentets tillstånd, vilket fungerar oavsett, och kostar
 * ungefär tio kilobyte per version.
 *
 * Yjs sparar heller ingen tid alls, så tidsstämplarna kommer härifrån.
 */

import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { las, skriv, radera, lagringFinns } from './lagring.js';

/* Hur många automatiska versioner som sparas per dokument. Manuellt sparade
   räknas inte in och gallras aldrig. */
const MAX_AUTOMATISKA = 20;

const indexnyckel = rum => rum + '/versioner';
const versionsnyckel = (rum, id) => rum + '/v/' + id;

async function lasIndex(rum) {
  const rå = await las(indexnyckel(rum));
  if (!rå) return [];
  try {
    return JSON.parse(new TextDecoder().decode(rå));
  } catch {
    return [];
  }
}

async function skrivIndex(rum, lista) {
  await skriv(indexnyckel(rum), new TextEncoder().encode(JSON.stringify(lista)));
}

/* En jämförbar sammanfattning av ett dokument: metafälten och sektionernas text.
   Sektionsnamnen läses ur dokumentet, så servern slipper känna till dem. */
function signatur(doc) {
  const meta = doc.getMap('meta');
  const delar = [
    meta.get('titel') || '',
    meta.get('start') || '',
    meta.get('slut') || ''
  ];

  const nycklar = [];
  doc.share.forEach((_, nyckel) => {
    if (nyckel.startsWith('sektion:')) nycklar.push(nyckel);
  });
  nycklar.sort();
  nycklar.forEach(nyckel => delar.push(nyckel + '=' + doc.getText(nyckel).toString()));

  return delar.join('\u0000');
}

/* Kort kontrollsumma av signaturen. Sparas i indexet, så likhet kan avgöras
   utan att läsa in själva versionen. */
function kontrollsumma(doc) {
  return createHash('sha1').update(signatur(doc)).digest('hex');
}

/* Listan, med besked om vilka versioner som skiljer sig från nuläget. Utan det
   går det inte att se vilka som är värda att återställa till. */
export async function listaMedSkillnad(rum, doc) {
  const poster = await lista(rum);
  if (!doc) return poster.map(p => ({ ...p, skiljerSig: null }));

  const summaNu = kontrollsumma(doc);

  return Promise.all(poster.map(async post => {
    /* Har posten en kontrollsumma räcker den. Äldre poster saknar den och får
       jämföras genom att läsas in. */
    if (post.sha) return { ...post, skiljerSig: post.sha !== summaNu };

    const rå = await hamta(rum, post.id);
    if (!rå) return { ...post, skiljerSig: null };
    const temp = new Y.Doc();
    Y.applyUpdate(temp, rå);
    return { ...post, skiljerSig: kontrollsumma(temp) !== summaNu };
  }));
}

export async function harVersioner(rum) {
  return (await lasIndex(rum)).length > 0;
}

export async function lista(rum) {
  return (await lasIndex(rum)).sort((a, b) => b.tid - a.tid);
}

export async function hamta(rum, id) {
  return las(versionsnyckel(rum, id));
}

/* Sparar nuläget som en version. etikett satt = manuellt sparad.
 *
 * Har ingenting ändrats sedan den senaste versionen skapas ingen ny. I stället
 * flyttas den befintligas tidsstämpel fram till nu. Följden är att en rad
 * oförändrade sparpunkter blir en enda post, märkt med den senaste tidpunkten
 * den fortfarande gällde – inte den första.
 */
export async function spara(rum, doc, { etikett = null, deltagare = [] } = {}) {
  if (!lagringFinns()) return null;

  const summa = kontrollsumma(doc);
  const lista = await lasIndex(rum);
  const senaste = lista.reduce((a, b) => (!a || b.tid > a.tid ? b : a), null);

  /* Oförändrat sedan sist: flytta fram tiden i stället för att spara om. */
  if (senaste && senaste.sha === summa) {
    senaste.tid = Date.now();
    senaste.deltagare = deltagare.length ? deltagare : senaste.deltagare;

    /* En sparning för hand bär en avsikt, så etiketten får följa med. */
    if (etikett) {
      senaste.etikett = etikett;
      senaste.manuell = true;
    }

    await skrivIndex(rum, lista);
    console.log('oförändrat, tidsstämpeln flyttad fram:', rum);
    return senaste;
  }

  const tid = Date.now();
  const id = String(tid);
  const tillstand = Y.encodeStateAsUpdate(doc);

  await skriv(versionsnyckel(rum, id), tillstand);

  const post = {
    id,
    tid,
    sha: summa,
    etikett,
    manuell: etikett !== null,
    deltagare,
    storlek: tillstand.length
  };

  lista.push(post);
  await skrivIndex(rum, await gallra(rum, lista));

  console.log('version sparad:', rum, post.manuell ? '(manuell)' : '(automatisk)');
  return post;
}

/* Tar bort de äldsta automatiska versionerna när de blivit för många. */
async function gallra(rum, lista) {
  const automatiska = lista.filter(p => !p.manuell).sort((a, b) => a.tid - b.tid);
  const overtaliga = automatiska.slice(0, Math.max(0, automatiska.length - MAX_AUTOMATISKA));

  for (const post of overtaliga) {
    await radera(versionsnyckel(rum, post.id));
  }

  const bort = new Set(overtaliga.map(p => p.id));
  return lista.filter(p => !bort.has(p.id));
}

/* Raderar hela historiken. Anropas när dokumentet markeras som klart. */
export async function nollstall(rum) {
  const lista = await lasIndex(rum);
  for (const post of lista) {
    await radera(versionsnyckel(rum, post.id));
  }
  await radera(indexnyckel(rum));
  console.log('historiken nollställd:', rum, '(' + lista.length + ' versioner)');
  return lista.length;
}
