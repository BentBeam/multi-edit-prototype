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
import { allaRutor, rutorFor, sektionsnyckelFor } from './rutor.js';

/* Hur länge en ruta hålls kvar efter att personens markör försvunnit.
 *
 * Markören försvinner ur närvarodatan så fort fönstret tappar fokus, alltså
 * varje gång någon växlar program för att kolla något. Utan frist blir rutan
 * fri i samma sekund, och någon annan kan hoppa in mitt i en mening. Lämnar
 * personen dokumentet helt släpps rutan direkt – då finns hen inte kvar i
 * närvarodatan.
 *
 * Fristen gäller BARA fönsterväxling. Klickar någon ut ur fältet med flit
 * släpps rutan direkt, och det skiljs på med hjälp av närvarodatans fokusfält
 * – se villkoret i agarePerRuta. */
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
    if (!tillstand?.user) return;

    /* Ingen markering. Klickade personen ut ur fältet med flit släpps rutan
       direkt – då har deras fönster fortfarande fokus. Tappade hela fönstret
       fokus är de kvar där de var, och fristen nedan gäller. Saknas beskedet
       kör deltagaren äldre kod, och då behåller vi fristen. */
    if (!tillstand.cursor) {
      if (tillstand.fokus?.fonster === true) senastKanda.delete(klientId);
      return;
    }

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

/* Har sektionen som rutan hör till någon låsning alls?
 *
 * En sektion med delatFalt i config.js låser aldrig. Den finns för att kunna
 * visa att flera kan skriva i samma ruta samtidigt. */
function harLas(rutaid) {
  const nyckel = sektionsnyckelFor(rutaid);
  const sektion = SEKTIONER.find(post => post.key === nyckel);
  return !sektion?.delatFalt;
}

/* Märker upp rutor där någon annan står, och returnerar vilka som är låsta.
 *
 * Två fall skiljs åt. I en vanlig sektion är rutan LÅST: ram, tonad botten och
 * spärr mot inmatning. I en delad sektion visas bara att någon är där – man får
 * skriva ändå. Därför räcker det inte att släppa spärren; en ruta som ser låst
 * ut men går att skriva i är värre än båda alternativen.
 *
 * Returnerar både de låsta rutorna och alla rutor någon annan står i. Det andra
 * behövs för sammanslagning, som fortfarande vägras när någon är inne: att slå
 * ihop två fält rycker text ur händerna på någon, och det är inte samma sak som
 * att skriva tillsammans. */
export function uppdateraLas(synk, redigerare) {
  const agare = agarePerRuta(synk);
  const narvarande = new Map();
  const last = new Map();

  /* Äger jag rutan står jag inte i vägen för mig själv. */
  agare.forEach((vem, rutaid) => {
    if (vem.klientId === synk.doc.clientID) return;
    narvarande.set(rutaid, vem);
    if (harLas(rutaid)) last.set(rutaid, vem);
  });

  allaRutor(synk).forEach(({ id }) => {
    const ruta = document.getElementById('ruta-' + id);
    if (!ruta) return;

    const vem = narvarande.get(id) || null;
    const last_ = Boolean(vem) && harLas(id);

    ruta.classList.toggle('ruta-upptagen', last_);
    ruta.classList.toggle('ruta-delad', Boolean(vem) && !last_);

    if (vem) {
      ruta.style.setProperty('--upptagenfarg', vem.farg);
    } else {
      ruta.style.removeProperty('--upptagenfarg');
    }

    /* Beskedet i rutans huvud: vem, och om hen skriver just nu. "också" i den
       delade sektionen, eftersom man får vara där samtidigt. */
    const huvud = ruta.querySelector('.ruta-huvud');
    let marke = ruta.querySelector('.upptagen-marke');

    if (vem && !marke && huvud) {
      marke = document.createElement('span');
      marke.className = 'upptagen-marke';
      huvud.append(marke);
    }
    if (vem && marke) {
      /* "också" hör efter verbet, inte före: "är också här", inte "också är
         här". Ordningen på delarna är därför namn, verb, också, här. */
      marke.textContent = vem.namn
        + (vem.skriver ? ' skriver' : ' är')
        + (last_ ? '' : ' också')
        + ' här';
    } else if (marke) {
      marke.remove();
    }
  });

  return { last, narvarande };
}

/* Är rutan upptagen av någon annan? */
export function arLast(last, rutaid) {
  return last?.get(rutaid) || null;
}

/* Glömmer allt när man lämnar ett dokument, så inget hänger med till nästa. */
export function glomLas() {
  senastKanda.clear();
}
