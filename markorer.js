/* Håller de andras markörer på rätt plats.
 *
 * Grundregeln: positionen läses om ur Yjs varje gång. quill-cursors håller ett
 * eget index som det räknar om vid varje textändring, och med y-quill blir det
 * fel – y-quill har redan satt rätt position ur Yjs för samma ändring, så
 * flytten sker två gånger. Markören kryper då framåt ett steg per tangenttryck
 * tills indexet passerar texten, och biblioteket klämmer det till sista
 * giltiga position: början av det tomma sista stycket. Därför är
 * transformOnTextChange av i app.js, och därför sätts positionen om här.
 *
 * Felet syns BARA medan någon skriver. Ett test som slutar med ett klick eller
 * en satt markering ger en ny position utan efterföljande textändring, och då
 * ser allt rätt ut. Testa alltid under pågående skrivande.
 *
 * Ser också till att en deltagares markör bara syns i den textruta hen står i.
 *
 * Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
 * textruta, men flyttar den bara i rutan där personen faktiskt står. I de
 * övriga blir en markör kvar på position noll.
 *
 * Filen rättar också markörens placering vid radbrytningar. Där har ett och
 * samma textindex två visuella platser – slutet av raden ovan och början av
 * raden under – och Quill svarar alltid med den senare. Skriver någon förbi
 * radbrytningen hamnar deras markör därför i början av nästa rad i stället för
 * där de står.
 *
 * Vilken av de två platserna som är den rätta går inte att räkna ut från
 * indexet. Bara den skrivandes egen webbläsare vet det, och den får svara:
 * sammaRadSomFore mäts lokalt och skickas med i närvarodatan.
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

/* Står min egen markör på samma rad som tecknet före den?
 *
 * Webbläsaren har redan svarat på frågan när den ritade min markör – vi behöver
 * bara läsa av var den hamnade och jämföra med tecknet före. Svaret skickas
 * vidare i närvarodatan, för de andra kan inte räkna ut det själva.
 *
 * Falskt är det försiktiga svaret: då lämnas Quills egen placering orörd. */
export function sammaRadSomFore(quill) {
  const markering = window.getSelection();
  if (!markering || markering.rangeCount === 0) return false;

  const min = markering.getRangeAt(0);
  if (!min.collapsed) return false;
  if (!quill.root.contains(min.startContainer)) return false;

  const nod = min.startContainer;
  if (nod.nodeType !== Node.TEXT_NODE) return false;
  if (min.startOffset === 0) return false;

  const fore = document.createRange();
  fore.setStart(nod, min.startOffset - 1);
  fore.setEnd(nod, min.startOffset);

  const harJag = min.getBoundingClientRect();
  const harFore = fore.getBoundingClientRect();
  if (!harJag.height || !harFore.height) return false;

  return Math.abs(harJag.top - harFore.top) < 1;
}

/* Vilket intervall står deltagaren på? Null om det inte hör hit.
 *
 * Yjs relativa positioner är den enda källan vi litar på. De pekar på ett
 * tecken, inte på ett tal, och överlever därför att andra skriver samtidigt.
 * Ett index som räknats om av någon annan än Yjs är alltid en gissning. */
function intervallFor(synk, tillstand, ytext) {
  if (!tillstand || !tillstand.cursor) return null;
  try {
    const borjan = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(tillstand.cursor.anchor),
      synk.doc
    );
    const slutet = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(tillstand.cursor.head),
      synk.doc
    );
    if (!borjan || borjan.type !== ytext) return null;
    if (!slutet || slutet.type !== ytext) return { index: borjan.index, length: 0 };
    return { index: borjan.index, length: slutet.index - borjan.index };
  } catch {
    return null;
  }
}

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
          radbesked: deltagartillstand?.markor?.sammaRadSomFore ?? 'inget',
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
 * platsen entydig, ligger index redan på samma rad som tecknet före är allt bra,
 * och har deltagaren svarat att de står först på den nya raden är Quills svar
 * det rätta.
 *
 * Saknas svaret rättar vi ändå. En deltagare med äldre kod skickar inget, och då
 * är slutet av raden ovan den bättre gissningen: att skriva framåt är det
 * vanliga. */
function rattadPlats(quill, ytext, index, radbesked) {
  if (index === null || index <= 0) return null;
  if (radbesked === false) return null;

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

      /* Sätt om positionen ur Yjs varje gång. Biblioteket håller ett eget index
         som det räknar om vid textändringar, och det driver isär från sanningen;
         det här skriver över gissningen med det som faktiskt gäller. */
      const intervall = intervallFor(synk, deltagartillstand, ytext);
      if (intervall) {
        const markorer = quill.getModule('cursors');
        if (markorer) markorer.moveCursor(String(klientId), intervall);
      }

      /* Markören hör hemma här – rätta placeringen om den hamnat i början av
         nästa rad i stället för i slutet av den här. */
      const plats = rattadPlats(
        quill,
        ytext,
        indexFor(synk, deltagartillstand, ytext),
        deltagartillstand?.markor?.sammaRadSomFore
      );
      if (plats) flyttaMarkor(element, plats);
    });
  });
}
