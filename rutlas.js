/* Hindrar två personer från att skriva i samma textruta.
 *
 * Hamnar två personer i samma ruta måste en av dem få den, annars låser de ut
 * varandra och ingen kan skriva. Den med lägst deltagarnummer vinner. Numret är
 * slumpat men båda webbläsarna ser samma siffror, så båda kommer fram till
 * samma svar utan att behöva fråga varandra. Den som förlorar får beskedet och
 * kan flytta sig eller lägga till ett eget fält.
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

/* Var har varje deltagare sin markör, jag själv inräknad?
 *
 * Kompletteras med de rutor någon nyligen lämnat, så en kort fönsterväxling
 * inte frigör texten. Returnerar för varje ruta den deltagare som äger den:
 * lägst deltagarnummer vinner om flera står i samma ruta.
 */
function agarePerRuta(synk) {
  const narvarande = new Set();
  const nu = Date.now();

  synk.awareness.getStates().forEach((tillstand, klientId) => {
    narvarande.add(klientId);
    if (!tillstand?.user || !tillstand.cursor) return;

    const vem = {
      klientId,
      namn: tillstand.user.fulltNamn || tillstand.user.name,
      farg: tillstand.user.color,
      skriver: Boolean(tillstand.user.skriver)
    };

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
    const nuvarande = perRuta.get(post.rutaid);
    if (!nuvarande || post.vem.klientId < nuvarande.klientId) {
      perRuta.set(post.rutaid, post.vem);
    }
  });
  return perRuta;
}

/* Märker upp upptagna rutor och returnerar vilka de är. */
export function uppdateraLas(synk, redigerare) {
  const agare = agarePerRuta(synk);
  const last = new Map();

  /* Äger jag rutan är den inte låst för mig, även om någon annan står där. */
  agare.forEach((vem, rutaid) => {
    if (vem.klientId !== synk.doc.clientID) last.set(rutaid, vem);
  });

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
