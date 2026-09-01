/* Hindrar två personer från att skriva i samma textruta.
 *
 * En ruta räknas som upptagen så länge någon annan har sin markör där – inte
 * bara medan hen skriver. Det gör regeln lätt att förstå: står någons markör i
 * rutan är den hens. Låset släpper när personen klickar någon annanstans,
 * lämnar fönstret eller kopplar ner, eftersom markören då försvinner ur
 * närvarodatan.
 *
 * Det här är en artighetsspärr, inte ett lås. Den sitter i webbläsaren och kan
 * kringgås, och två personer kan hamna i samma tomma ruta samtidigt.
 * Synkmotorn klarar det ändå; spärren finns för att undvika oavsiktliga
 * krockar.
 *
 * Låset ligger på hela rutan, inte på stycket. Stycken flyttar sig, delas och
 * slås ihop, och en markör vid en styckesgräns hör tvetydigt till båda – det
 * gav gränsfall som inte gick att få rätt.
 */

import * as Y from 'yjs';
import { SEKTIONER } from './config.js';
import { allaRutor, rutorFor } from './rutor.js';

/* Hur länge en ruta hålls kvar efter att personens markör försvunnit.
 *
 * Markören försvinner ur närvarodatan så fort fönstret tappar fokus, alltså
 * varje gång någon växlar program för att kolla något. Utan frist blir rutan
 * fri i samma sekund, och någon annan kan hoppa in mitt i en mening. Lämnar
 * personen dokumentet helt släpps rutan direkt – då finns hen inte kvar i
 * närvarodatan. */
const FRIST_MS = 20000;

/* klientId -> { sektionsnyckel, vem, sistSedd } */
const senastKanda = new Map();

/* Var har varje annan deltagare sin markör? Kompletteras med de rutor någon
   nyligen lämnat, så en kort fönsterväxling inte frigör texten. */
function vemVar(synk) {
  const narvarande = new Set();
  const nu = Date.now();

  synk.awareness.getStates().forEach((tillstand, klientId) => {
    if (klientId === synk.doc.clientID) return;
    narvarande.add(klientId);
    if (!tillstand?.user) return;

    const vem = {
      namn: tillstand.user.fulltNamn || tillstand.user.name,
      farg: tillstand.user.color,
      skriver: Boolean(tillstand.user.skriver)
    };

    if (!tillstand.cursor) return;

    try {
      const plats = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(tillstand.cursor.anchor),
        synk.doc
      );
      if (!plats) return;

      const ruta = allaRutor(synk).find(r => synk.text(r.id) === plats.type);
      if (ruta) senastKanda.set(klientId, { rutaid: ruta.id, vem, sistSedd: nu });
    } catch {
      /* Positionen gick inte att tolka – lämna det senast kända orört. */
    }
  });

  /* Glöm dem som lämnat dokumentet, och dem vars frist gått ut. */
  senastKanda.forEach((post, klientId) => {
    if (!narvarande.has(klientId) || nu - post.sistSedd > FRIST_MS) {
      senastKanda.delete(klientId);
    }
  });

  const perRuta = new Map();
  senastKanda.forEach(post => {
    if (!perRuta.has(post.rutaid)) perRuta.set(post.rutaid, post.vem);
  });
  return perRuta;
}

/* Märker upp upptagna rutor och returnerar vilka de är. */
export function uppdateraLas(synk, redigerare) {
  const last = vemVar(synk);

  allaRutor(synk).forEach(({ id }) => {
    const ruta = document.getElementById('ruta-' + id);
    if (!ruta) return;

    const vem = last.get(id) || null;
    ruta.classList.toggle('ruta-upptagen', Boolean(vem));

    if (vem) {
      ruta.style.setProperty('--upptagenfarg', vem.farg);
    } else {
      ruta.style.removeProperty('--upptagenfarg');
    }

    /* Beskedet i rutans huvud: vem, och om hen skriver just nu. */
    const huvud = ruta.querySelector('.ruta-huvud');
    let marke = ruta.querySelector('.upptagen-marke');

    if (vem && !marke && huvud) {
      marke = document.createElement('span');
      marke.className = 'upptagen-marke';
      huvud.append(marke);
    }
    if (vem && marke) {
      marke.textContent = vem.namn + (vem.skriver ? ' skriver här' : ' är här');
    } else if (marke) {
      marke.remove();
    }
  });

  return last;
}

/* Är rutan upptagen av någon annan? */
export function arLast(last, rutaid) {
  return last?.get(rutaid) || null;
}

/* Glömmer allt när man lämnar ett dokument, så inget hänger med till nästa. */
export function glomLas() {
  senastKanda.clear();
}
