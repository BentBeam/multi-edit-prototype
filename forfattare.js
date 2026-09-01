/* Vem skrev vad.
 *
 * Ingenting märks upp i texten. Yjs vet redan vilken deltagare som satte in
 * varje tecken, och det här läser ut den kunskapen. Fördelen är att det
 * fungerar bakåt, på text som skrevs innan funktionen fanns, och att texten
 * inte belastas med extra formatering.
 *
 * Priset är att vi läser Yjs interna struktur, som inte är ett utlovat
 * gränssnitt. Slutar det fungera efter en uppdatering av Yjs är det här filen
 * att titta i.
 */

/* Deltagarnas id är slumpade per session, så de måste översättas till namn.
   Kartan ligger i dokumentet och överlever därför omstarter. */
function karta(synk) {
  return synk.doc.getMap('deltagare');
}

export function registreraMig(synk, profil) {
  karta(synk).set(String(synk.doc.clientID), {
    namn: profil.namn,
    farg: profil.farg
  });
}

export function hittaDeltagare(synk, klientId) {
  return karta(synk).get(String(klientId)) || null;
}

/* Vilka som har skrivit något i dokumentet, i den ordning de dyker upp.
 *
 * Räknas per person, inte per deltagarnummer. Numret är slumpat per session, så
 * samma person som laddat om sidan tre gånger har tre nummer – och dök därför
 * upp tre gånger i teckenförklaringen.
 */
export function forfattare(synk) {
  const ut = [];
  const seddaPersoner = new Set();

  synk.doc.share.forEach((_, nyckel) => {
    if (!nyckel.startsWith('sektion:')) return;

    forfattarrader(synk.doc.getText(nyckel)).forEach(rad => {
      const person = hittaDeltagare(synk, rad.klient);
      const namn = person?.namn || 'Okänd';
      const farg = person?.farg || '#a5a5a0';

      const nyckelPerson = namn + '|' + farg;
      if (seddaPersoner.has(nyckelPerson)) return;
      seddaPersoner.add(nyckelPerson);

      ut.push({ namn, farg });
    });
  });

  return ut;
}

/* Delar upp en text i sammanhängande stycken per författare.
   Formatposter hoppas över – de bär ingen text och skulle förskjuta indexen. */
export function forfattarrader(ytext) {
  const ut = [];
  let index = 0;
  let post = ytext._start;

  while (post !== null) {
    const barText = typeof post.content.str === 'string';
    if (!post.deleted && barText) {
      const klient = post.id.client;
      const langd = post.content.str.length;
      const sista = ut[ut.length - 1];
      if (sista && sista.klient === klient) sista.langd += langd;
      else ut.push({ klient, index, langd });
      index += langd;
    }
    post = post.right;
  }

  return ut;
}
