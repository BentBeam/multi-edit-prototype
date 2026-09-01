/* Textrutor per sektion.
 *
 * En sektion har en huvudruta och upp till två tillhörande rutor. Poängen är
 * att en upptagen huvudruta inte ska stänga ut någon: man lägger till en egen
 * ruta, skriver där, och slår ihop den uppåt när det passar.
 *
 * Rutans id är sektionsnyckeln för huvudrutan, och nyckeln med ett nummer för
 * de tillhörande – "syfte", "syfte:1", "syfte:2". Huvudrutan behåller därmed
 * samma namn som förut, så dokument skapade innan den här funktionen fungerar
 * oförändrat.
 *
 * Antalet rutor ligger i dokumentets metafält, så alla ser samma struktur.
 */

import { SEKTIONER, MAX_TILLAGG } from './config.js';

export const rutaId = (nyckel, nummer) => (nummer === 0 ? nyckel : nyckel + ':' + nummer);
export const sektionsnyckelFor = rutaid => rutaid.split(':')[0];
export const tillaggsnummer = rutaid => {
  const delar = rutaid.split(':');
  return delar.length > 1 ? Number(delar[1]) : 0;
};

export function antalRutor(synk, nyckel) {
  const n = Number(synk.meta.get('rutor:' + nyckel));
  return Number.isFinite(n) && n >= 1 && n <= 1 + MAX_TILLAGG ? n : 1;
}

export function rutorFor(synk, nyckel) {
  return Array.from({ length: antalRutor(synk, nyckel) }, (_, i) => rutaId(nyckel, i));
}

/* Alla rutor i dokumentet, i ordning. */
export function allaRutor(synk) {
  return SEKTIONER.flatMap(sektion =>
    rutorFor(synk, sektion.key).map(id => ({ sektion, id }))
  );
}

export function kanLaggaTill(synk, nyckel) {
  return antalRutor(synk, nyckel) < 1 + MAX_TILLAGG;
}

export function laggTill(synk, nyckel) {
  if (!kanLaggaTill(synk, nyckel)) return false;
  synk.meta.set('rutor:' + nyckel, antalRutor(synk, nyckel) + 1);
  return true;
}

/* Slår ihop en tillhörande ruta med rutan ovanför.
 *
 * Allt görs på datanivå, och sektionens redigerare byggs om efteråt. Att skriva
 * direkt i den delade texten bakom en redigerares rygg uppdaterar den inte –
 * bygger vi om läser de nya redigerarna helt enkelt rätt innehåll från början.
 */
export function slaIhop(synk, nyckel, nummer) {
  if (nummer < 1) return false;

  const antal = antalRutor(synk, nyckel);
  if (nummer > antal - 1) return false;

  synk.doc.transact(() => {
    const mal = synk.text(rutaId(nyckel, nummer - 1));
    const kalla = synk.text(rutaId(nyckel, nummer));
    const innehall = kalla.toDelta();

    if (innehall.length > 0) {
      const skarv = mal.length > 0 ? [{ insert: '\n' }] : [];
      mal.applyDelta([{ retain: mal.length }, ...skarv, ...innehall]);
    }

    /* Flytta ned de rutor som låg efter, så numreringen inte får hål. */
    for (let i = nummer; i < antal - 1; i++) {
      const hit = synk.text(rutaId(nyckel, i));
      const fran = synk.text(rutaId(nyckel, i + 1));
      if (hit.length > 0) hit.delete(0, hit.length);
      const delta = fran.toDelta();
      if (delta.length > 0) hit.applyDelta(delta);
    }

    /* Töm den sista och minska antalet. */
    const sista = synk.text(rutaId(nyckel, antal - 1));
    if (sista.length > 0) sista.delete(0, sista.length);

    synk.meta.set('rutor:' + nyckel, antal - 1);
  });

  return true;
}

/* Sektionens sammanlagda teckenantal – gränsen gäller sektionen, inte rutan. */
export function teckenISektion(synk, redigerare, nyckel) {
  return rutorFor(synk, nyckel).reduce((summa, id) => {
    const quill = redigerare[id];
    if (quill) return summa + quill.getText().replace(/\n+$/, '').length;
    return summa + synk.text(id).toString().replace(/\n+$/, '').length;
  }, 0);
}
