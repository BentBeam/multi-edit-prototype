/* Ser till att en deltagares markör bara syns i den textruta hen står i.
 *
 * Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
 * textruta, men flyttar den bara i rutan där personen faktiskt står. I de
 * övriga blir en markör kvar på position noll.
 *
 * Filen rättar också markörens placering vid mjuka radbrytningar. Där har ett
 * och samma textindex två visuella platser – slutet av raden ovan och början av
 * raden under – och Quill svarar alltid med den senare. Skriver någon förbi
 * radbrytningen hamnar deras markör därför i början av nästa rad i stället för
 * där de står.
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

/* Var i texten står deltagarens markör? Null om den inte hör hit. */
function indexFor(synk, tillstand, ytext) {
  if (!tillstand || !tillstand.cursor) return null;
  try {
    const plats = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(tillstand.cursor.anchor),
      synk.doc
    );
    return plats && plats.type === ytext ? plats.index : null;
  } catch {
    return null;
  }
}

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

/* Vad koden tror om varje markörelement, per ruta. Används av diagnostiken. */
export function markorlage(synk, redigerare) {
  const tillstand = synk.awareness.getStates();

  return allaRutor(synk).map(({ id }) => {
    const quill = redigerare[id];
    if (!quill) return { ruta: id, fel: 'ingen redigerare' };

    const behallare = quill.container.querySelector('.ql-cursors');
    if (!behallare) return { ruta: id, fel: 'ingen markörbehållare' };

    const ytext = synk.text(id);

    return {
      ruta: id,
      markorer: [...behallare.querySelectorAll('.ql-cursor')].map(element => {
        const klientId = Number(element.id.replace('ql-cursor-', ''));
        const deltagartillstand = tillstand.get(klientId);

        /* Var säger närvarodatan att markören är, och var ritas den? Skiljer de
           sig är det placeringen som är fel, inte städningen. */
        let index = null;
        try {
          const plats = Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(deltagartillstand.cursor.anchor),
            synk.doc
          );
          if (plats && plats.type === ytext) index = plats.index;
        } catch { /* ingen position att läsa */ }

        const caret = element.querySelector('.ql-cursor-caret');
        const ritad = caret ? caret.getBoundingClientRect() : null;
        const behallarruta = quill.container.getBoundingClientRect();
        const forvantad = index === null ? null : quill.getBounds(index);

        return {
          element: element.id,
          klientId,
          finnsINarvaro: Boolean(deltagartillstand),
          harMarkorfalt: Boolean(deltagartillstand?.cursor),
          horHemma: horHemma(synk, deltagartillstand, ytext),
          synlig: getComputedStyle(element).display !== 'none',
          index,
          textlangd: ytext.length,
          ritadTopp: ritad ? Math.round(ritad.top - behallarruta.top) : null,
          forvantadTopp: forvantad ? Math.round(forvantad.top) : null,
          ritadVanster: ritad ? Math.round(ritad.left - behallarruta.left) : null,
          forvantadVanster: forvantad ? Math.round(forvantad.left) : null
        };
      })
    };
  });
}

/* Var ska markören stå, om Quills svar behöver rättas?
 *
 * Returnerar null när det inte finns något att rätta: vid en hård radbrytning är
 * platsen entydig, och ligger index på samma rad som tecknet före är allt bra.
 *
 * Vid en mjuk radbrytning är index tvetydigt och vi väljer slutet av raden
 * ovanför. Det är fallet när någon skriver förbi radbrytningen, vilket är det
 * vanliga. Priset är att den som medvetet ställer sig först på en radbruten rad
 * visas i slutet av raden över. */
function rattadPlats(quill, ytext, index) {
  if (index === null || index <= 0) return null;

  const text = ytext.toString();
  if (text[index - 1] === '\n') return null;

  const har = quill.getBounds(index, 0);
  const fore = quill.getBounds(index - 1, 1);
  if (!har || !fore) return null;
  if (Math.abs(fore.top - har.top) < 1) return null;

  return { top: fore.top, left: fore.left + fore.width, height: fore.height };
}

/* Skriver den rättade platsen på de element biblioteket placerar. */
function flyttaMarkor(element, plats) {
  const behallare = element.querySelector('.ql-cursor-caret-container');
  const flagga = element.querySelector('.ql-cursor-flag');

  if (behallare) {
    behallare.style.top = plats.top + 'px';
    behallare.style.left = plats.left + 'px';
    behallare.style.height = plats.height + 'px';
  }
  if (flagga) {
    flagga.style.top = plats.top + 'px';
    flagga.style.left = plats.left + 'px';
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

      const deltagartillstand = tillstand.get(klientId);

      if (!horHemma(synk, deltagartillstand, ytext)) {
        const markorer = quill.getModule('cursors');
        if (markorer) markorer.removeCursor(String(klientId));
        return;
      }

      /* Markören hör hemma här – rätta placeringen om den hamnat i början av
         nästa rad i stället för i slutet av den här. */
      const plats = rattadPlats(quill, ytext, indexFor(synk, deltagartillstand, ytext));
      if (plats) flyttaMarkor(element, plats);
    });
  });
}
