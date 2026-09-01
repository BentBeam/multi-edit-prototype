/* Historik: hämta sparade lägen och återställa till ett av dem. */

import * as Y from 'yjs';
import Quill from 'quill';
import { SYNKSERVER, SEKTIONER, MAX_TILLAGG } from './config.js';
import { rutaId, tillaggsnummer } from './rutor.js';

const Delta = Quill.import('delta');

/* Ändpunkterna ligger på samma server som synken, fast över http. */
function apiBas() {
  if (!SYNKSERVER) return null;
  return SYNKSERVER.replace(/^ws/, 'http').replace(/\/ws$/, '');
}

export function historikFinns() {
  return apiBas() !== null;
}

export async function lista(rum) {
  const bas = apiBas();
  if (!bas) return [];
  try {
    const svar = await fetch(bas + '/api/versioner/' + encodeURIComponent(rum));
    if (!svar.ok) return [];
    return (await svar.json()).versioner || [];
  } catch (fel) {
    console.error('kunde inte hämta historiken:', fel.message);
    return [];
  }
}

export async function hamta(rum, id) {
  const bas = apiBas();
  if (!bas) return null;
  const svar = await fetch(bas + '/api/version/' + encodeURIComponent(rum) + '/' + id);
  if (!svar.ok) return null;
  return new Uint8Array(await svar.arrayBuffer());
}

export async function sparaVersion(rum, etikett) {
  const bas = apiBas();
  if (!bas) return null;
  const svar = await fetch(bas + '/api/version/' + encodeURIComponent(rum), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ etikett })
  });
  if (!svar.ok) return null;
  return (await svar.json()).version;
}

/* Läser ut texterna ur ett sparat tillstånd, för att kunna visa det. */
export function lasTexter(tillstand) {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, tillstand);
  const meta = temp.getMap('meta');

  return {
    titel: meta.get('titel') || '',
    start: meta.get('start') || '',
    slut: meta.get('slut') || '',
    sektioner: SEKTIONER.flatMap(sektion => {
      const antal = Number(meta.get('rutor:' + sektion.key)) || 1;
      return Array.from({ length: antal }, (_, i) => ({
        rubrik: i === 0 ? sektion.rubrik : sektion.rubrik + ' – tillägg ' + i,
        text: temp.getText('sektion:' + rutaId(sektion.key, i)).toString()
      }));
    })
  };
}

/* Återställer dokumentet till ett sparat läge.
 *
 * Det här är inte en tillbakarullning. I den här sortens dokument kan man inte
 * ta bort historia – återställningen läggs på som en ny ändring. Följden är att
 * den själv syns i historiken, och går att ångra genom att återställa till
 * något senare.
 *
 * Ändringen görs genom Quill, inte direkt i Yjs. Skriver man i Yjs bakom
 * editorns rygg uppdaterar den inte alltid vad som visas. Går man via Quill
 * skickas ändringen vidare till Yjs som vilken annan redigering som helst.
 *
 * Statusen återställs medvetet inte, så ett klart dokument inte låses igen.
 */
export function aterstall(synk, tillstand) {
  const temp = new Y.Doc();
  Y.applyUpdate(temp, tillstand);
  const gammalMeta = temp.getMap('meta');

  /* Antalet rutor sätts först, så anroparen kan bygga om och sedan fylla dem. */
  synk.doc.transact(() => {
    ['titel', 'start', 'slut'].forEach(falt => {
      synk.meta.set(falt, gammalMeta.get(falt) || '');
    });
    SEKTIONER.forEach(sektion => {
      const antal = Number(gammalMeta.get('rutor:' + sektion.key)) || 1;
      synk.meta.set('rutor:' + sektion.key, Math.min(antal, 1 + MAX_TILLAGG));
    });
  });

  /* Returnerar texterna, så anroparen kan lägga in dem via redigerarna när
     rutorna byggts om. Att skriva direkt i den delade texten uppdaterar inte
     det som visas. */
  const texter = {};
  SEKTIONER.forEach(sektion => {
    const antal = Number(gammalMeta.get('rutor:' + sektion.key)) || 1;
    for (let i = 0; i < Math.min(antal, 1 + MAX_TILLAGG); i++) {
      const id = rutaId(sektion.key, i);
      texter[id] = temp.getText('sektion:' + id).toDelta();
    }
  });
  return texter;
}
