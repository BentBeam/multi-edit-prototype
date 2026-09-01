/* Hindrar två personer från att skriva i samma stycke samtidigt.
 *
 * Det här är en artighetsspärr, inte ett lås. Den sitter i webbläsaren och kan
 * kringgås. Två personer kan också hamna i samma tomma stycke i samma
 * ögonblick – ingen kan hindra det. Synkmotorn klarar det ändå; spärren finns
 * för att undvika att folk skriver över varandras meningar av misstag.
 *
 * Ett stycke låses bara medan någon annan faktiskt skriver i det. Ett stycke
 * där någon bara lämnat markören släpps efter en stunds tystnad, annars låser
 * ett bortglömt fönster texten för alla andra.
 */

import * as Y from 'yjs';
import { SEKTIONER } from './config.js';

/* Vilket stycke ligger den här positionen i? Returnerar elementet i sidan. */
function styckeVid(quill, index) {
  const [rad] = quill.getLine(index);
  return rad ? rad.domNode : null;
}

/* Stycken som någon annan skriver i just nu, med vem det är. */
function lastaStycken(synk, quill, ytext) {
  const last = new Map();

  synk.awareness.getStates().forEach((tillstand, klientId) => {
    if (klientId === synk.doc.clientID) return;
    if (!tillstand?.user?.skriver || !tillstand.cursor) return;

    try {
      const plats = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(tillstand.cursor.anchor),
        synk.doc
      );
      if (!plats || plats.type !== ytext) return;

      const stycke = styckeVid(quill, plats.index);
      if (stycke) {
        last.set(stycke, {
          namn: tillstand.user.fulltNamn || tillstand.user.name,
          farg: tillstand.user.color
        });
      }
    } catch {
      /* Positionen gick inte att tolka – då låser vi ingenting. */
    }
  });

  return last;
}

/* Märker upp låsta stycken, och returnerar dem så inmatning kan hindras. */
export function uppdateraLas(synk, redigerare) {
  const allaLas = new Map();

  SEKTIONER.forEach(sektion => {
    const quill = redigerare[sektion.key];
    if (!quill) return;

    const last = lastaStycken(synk, quill, synk.text(sektion.key));
    allaLas.set(sektion.key, last);

    quill.root.querySelectorAll('.stycke-last').forEach(stycke => {
      if (!last.has(stycke)) {
        stycke.classList.remove('stycke-last');
        stycke.style.removeProperty('--lasfarg');
        stycke.removeAttribute('data-lastav');
      }
    });

    last.forEach((vem, stycke) => {
      stycke.classList.add('stycke-last');
      stycke.style.setProperty('--lasfarg', vem.farg);
      stycke.setAttribute('data-lastav', vem.namn + ' skriver här');
    });
  });

  return allaLas;
}

/* Vilket stycke i redigeraren ligger den här noden i? */
function styckeForNod(quill, nod) {
  let element = nod?.nodeType === Node.TEXT_NODE ? nod.parentElement : nod;
  while (element && element.parentElement !== quill.root) element = element.parentElement;
  return element && element.parentElement === quill.root ? element : null;
}

/* Är det ändringen är på väg att träffa låst?
 *
 * Vi frågar inte Quill var markören står – Quill hinner inte uppdatera sin egen
 * uppfattning innan tangenttrycket når hit. I stället läser vi vad webbläsaren
 * faktiskt är på väg att ändra, vilket alltid är aktuellt.
 */
export function arLast(quill, last, handelse) {
  if (!last || last.size === 0) return null;

  const omraden = handelse?.getTargetRanges?.().length
    ? handelse.getTargetRanges()
    : [];

  const noder = [];

  if (omraden.length > 0) {
    omraden.forEach(omrade => {
      noder.push(omrade.startContainer, omrade.endContainer);
    });
  } else {
    const markering = document.getSelection();
    if (markering && markering.rangeCount > 0) {
      const omrade = markering.getRangeAt(0);
      noder.push(omrade.startContainer, omrade.endContainer);
    }
  }

  for (const nod of noder) {
    const stycke = styckeForNod(quill, nod);
    if (stycke && last.has(stycke)) return last.get(stycke);
  }

  return null;
}
