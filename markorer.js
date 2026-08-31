/* Städar bort markörer som inte hör hemma.
 *
 * Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
 * textruta, men flyttar den bara i den ruta där personen faktiskt står. I de
 * övriga blir en markör kvar på position noll. Tidigare doldes den av att
 * biblioteket gömmer etiketten efter några sekunder; sedan vi håller
 * etiketterna synliga syns den, och det ser ut som att någon står på två
 * ställen samtidigt.
 */

import * as Y from 'yjs';
import { SEKTIONER } from './config.js';

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

  SEKTIONER.forEach(sektion => {
    const quill = redigerare[sektion.key];
    if (!quill) return;

    const markorer = quill.getModule('cursors');
    if (!markorer) return;

    const ytext = synk.text(sektion.key);

    tillstand.forEach((deltagartillstand, klientId) => {
      if (klientId === synk.doc.clientID) return;
      if (!horHemma(synk, deltagartillstand, ytext)) {
        markorer.removeCursor(String(klientId));
      }
    });
  });
}
