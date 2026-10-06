/* Simulerat nätbortfall, för att kunna se vad som händer utan att sitta på ett tåg.
 *
 * Gäller bara fönstret där reglaget slås om. Servern och de andra märker inget
 * annat än vad de skulle märka av ett riktigt avbrott.
 *
 * Tre lägen:
 *
 *   på        Allt går som vanligt.
 *
 *   tyst      Tågtunneln. Anslutningen ser ut att leva men ingenting går fram,
 *             åt något håll. Webbläsaren tror att den är ansluten tills det har
 *             gått 30 sekunder utan ett enda meddelande från servern; då ger den
 *             upp och försöker koppla upp sig igen, vilket misslyckas så länge
 *             läget står kvar. Det är exakt den fördröjningen som är intressant
 *             att se.
 *
 *   brutet    Datorn vet att nätet är borta, som när wifi slås av. Anslutningen
 *             stängs direkt och nya försök misslyckas.
 *
 * Tillbaka till "på" stängs en tyst anslutning ändå, i stället för att låta den
 * fortsätta. Meddelanden som slängts under avbrottet kommer aldrig fram, och en
 * riktig anslutning som legat död en längre stund överlever inte heller. Den nya
 * anslutningen gör en fullständig synk, precis som efter ett riktigt avbrott.
 *
 * Fungerar genom att y-websocket får en egen variant av WebSocket att använda.
 * Allt annat i synken är orört. */

let lage = 'pa';
let sedan = null;
const lyssnare = new Set();
const oppna = new Set();

export class StrypbarWebSocket extends WebSocket {
  constructor(url, protokoll) {
    super(url, protokoll);
    this.tyst = false;
    oppna.add(this);
    this.addEventListener('close', () => oppna.delete(this));

    /* Ett nytt försök medan nätet är borta ska misslyckas, som ett riktigt. */
    if (lage !== 'pa') this.close();
  }

  send(data) {
    if (this.tyst) return;
    super.send(data);
  }

  /* y-websocket tar emot via onmessage. Det som kommer medan anslutningen är
     tyst kastas, som om det aldrig skickats. */
  set onmessage(fn) {
    super.onmessage = fn
      ? handelse => { if (!this.tyst) fn(handelse); }
      : null;
  }
  get onmessage() {
    return super.onmessage;
  }
}

export function natverkslage() {
  return { lage, sedan };
}

export function sattNatverkslage(nytt) {
  if (!['pa', 'tyst', 'brutet'].includes(nytt) || nytt === lage) return;
  const forra = lage;
  lage = nytt;
  sedan = nytt === 'pa' ? null : Date.now();

  oppna.forEach(socket => {
    if (nytt === 'tyst') socket.tyst = true;
    if (nytt === 'brutet') socket.close();
    if (nytt === 'pa' && forra === 'tyst') socket.close();
  });

  console.info('[nättest] läge:', nytt);
  lyssnare.forEach(fn => fn());
}

export function omNatverkslage(fn) {
  lyssnare.add(fn);
}
