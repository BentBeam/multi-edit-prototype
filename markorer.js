/* Ser till att en deltagares markör bara syns i den textruta hen står i.
 *
 * Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
 * textruta, men flyttar den bara i rutan där personen faktiskt står. I de
 * övriga blir en markör kvar på position noll.
 *
 * Städningen måste ske i samma arbetspass som kopplingens egen uppdatering,
 * innan webbläsaren hinner rita om. Med fördröjning hinner den felplacerade
 * markören blinka till.
 *
 * Att i stället dölja markörer med css fungerade sämre: biblioteket mäter
 * elementet när det placerar markören, och ett dolt element saknar mått, så
 * markören hamnade på fel rad.
 */

import * as Y from 'yjs';
import { allaRutor } from './rutor.js';

/* Hör deltagarens markör hemma i den här texten? */
function horHemma(synk, tillstand, ytext) {
  if (!tillstand || !tillstand.cursor) return false;
  try {
    const plats = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(tillstand.cursor.anchor),
      synk.doc
    );
    return Boolean(plats) && plats.type === ytext;
  } catch {
    return false;
  }
}

export function stadaMarkorer(synk, redigerare) {
  const tillstand = synk.awareness.getStates();

  /* Varje ruta, inte varje sektion: en sektion kan ha tillhörande rutor, och
     glömmer man dem städas deras markörer aldrig. */
  allaRutor(synk).forEach(({ id }) => {
    const quill = redigerare[id];
    if (!quill) return;

    const behallare = quill.container.querySelector('.ql-cursors');
    if (!behallare) return;

    const ytext = synk.text(id);

    behallare.querySelectorAll('.ql-cursor').forEach(element => {
      const klientId = Number(element.id.replace('ql-cursor-', ''));
      if (!Number.isFinite(klientId)) return;

      if (!horHemma(synk, tillstand.get(klientId), ytext)) {
        const markorer = quill.getModule('cursors');
        if (markorer) markorer.removeCursor(String(klientId));
      }
    });
  });
}
