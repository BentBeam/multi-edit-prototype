/* Ser till att en deltagares markör bara syns i den textruta hen står i.
 *
 * Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
 * textruta, men flyttar den bara i rutan där personen faktiskt står. I de
 * övriga blir en markör kvar på position noll.
 *
 * Att ta bort dem i efterhand räcker inte – de hinner ritas ut och blinka till
 * på fel ställe. I stället är markörer dolda som standard, och får en klass
 * först när vi kontrollerat att de hör hemma. Då kan en felplacerad markör
 * aldrig synas, ens ett ögonblick.
 */

import * as Y from 'yjs';
import { SEKTIONER } from './config.js';

const HOR_HEMMA = 'hor-hemma';

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

    const behallare = quill.container.querySelector('.ql-cursors');
    if (!behallare) return;

    const ytext = synk.text(sektion.key);

    behallare.querySelectorAll('.ql-cursor').forEach(element => {
      const klientId = Number(element.id.replace('ql-cursor-', ''));
      if (!Number.isFinite(klientId)) return;

      const hor = horHemma(synk, tillstand.get(klientId), ytext);
      element.classList.toggle(HOR_HEMMA, hor);

      /* Håll även markörlistan ren, så dolda element inte samlas på hög. */
      if (!hor) {
        const markorer = quill.getModule('cursors');
        if (markorer) markorer.removeCursor(String(klientId));
      }
    });
  });
}
