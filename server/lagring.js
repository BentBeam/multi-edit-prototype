/* Beständig lagring av dokument och versioner.
 *
 * Två alternativ, valt automatiskt:
 *
 *   Netlify Blobs   om NETLIFY_TOKEN är satt. Används i drift.
 *   Filer på disk   annars. Används lokalt, och fungerar på vilken maskin
 *                   som helst med en riktig disk.
 *
 * Token sätts som miljövariabel – aldrig i koden.
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

const PROJEKT_ID = process.env.NETLIFY_SITE_ID || '981a31ec-6047-45b2-8a16-091f7670a9cc';
const TOKEN = process.env.NETLIFY_TOKEN;
/* Räknas från serverns egen mapp, inte från processens arbetskatalog – annars
   hamnar filerna där servern råkade startas ifrån. */
const MAPP = process.env.LAGRINGSMAPP
  || join(dirname(fileURLToPath(import.meta.url)), 'lagring');

let lager = null;

if (TOKEN) {
  lager = getStore('dokument', { siteID: PROJEKT_ID, token: TOKEN });
  console.log('lagring: Netlify Blobs');
} else {
  await mkdir(MAPP, { recursive: true });
  console.log('lagring: filer i', MAPP);
}

export const lagringFinns = () => true;
export const lagringsSlag = () => (lager ? 'Netlify Blobs' : 'filer på disk');

/* Nycklar innehåller snedstreck. På disk blir de en del av filnamnet. */
const filnamn = nyckel => join(MAPP, nyckel.replace(/[^\w.-]/g, '_'));

export async function las(nyckel) {
  try {
    if (lager) {
      /* Stark konsistens krävs. Med standardinställningen kan en läsning ge en
         minut gammal text, och då tappar någon sitt arbete. */
      const rå = await lager.get(nyckel, { type: 'arrayBuffer', consistency: 'strong' });
      return rå ? new Uint8Array(rå) : null;
    }
    return new Uint8Array(await readFile(filnamn(nyckel)));
  } catch (fel) {
    if (fel.code !== 'ENOENT') console.error('kunde inte läsa', nyckel + ':', fel.message);
    return null;
  }
}

export async function skriv(nyckel, data) {
  try {
    if (lager) await lager.set(nyckel, Buffer.from(data));
    else await writeFile(filnamn(nyckel), Buffer.from(data));
  } catch (fel) {
    console.error('kunde inte skriva', nyckel + ':', fel.message);
  }
}

export async function radera(nyckel) {
  try {
    if (lager) await lager.delete(nyckel);
    else await rm(filnamn(nyckel), { force: true });
  } catch (fel) {
    console.error('kunde inte radera', nyckel + ':', fel.message);
  }
}
