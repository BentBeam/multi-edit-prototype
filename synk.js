/* All realtidssynk. Resten av appen pratar bara med det som returneras här. */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { SYNKSERVER, RUMSPREFIX } from './config.js';

/* Hur länge efter senaste tangenttryck någon räknas som skrivande. Kort nog att
   ett bortglömt fönster inte blockerar andra, långt nog att en tankepaus inte
   släpper stycket mitt i en mening. */
const TYSTNAD_MS = 8000;

export function anslut(dokumentId, profil) {
  const rum = RUMSPREFIX + dokumentId;
  const doc = new Y.Doc();

  /* Sparar en kopia i webbläsaren så innehållet finns kvar när ingen annan är inne. */
  const lokal = new IndexeddbPersistence(rum, doc);

  /* disableBc stänger av genvägen mellan flikar i samma webbläsare. Utan den
     kan två flikar synka lokalt även när servern är nere, vilket får det att se
     ut som att delning fungerar när den inte gör det. */
  const provider = SYNKSERVER
    ? new WebsocketProvider(SYNKSERVER, rum, doc, { disableBc: true })
    : null;

  /* Utan server finns ingen att vara närvarande inför, men resten av appen
     räknar med att det finns en awareness, så vi skapar en tom. */
  const awareness = provider ? provider.awareness : new Awareness(doc);

  /* name är vad som står på markören i texten, och där ryms bara initialer.
     Fullständiga namnet följer med separat, till avatarer och listor. */
  awareness.setLocalStateField('user', {
    name: profil.initialer || profil.namn,
    fulltNamn: profil.namn,
    color: profil.farg,
    skriver: false
  });

  /* Talar om för de andra att jag skriver just nu, och tystnar av sig själv.
     Flaggan är ett ja eller nej satt av min egen webbläsare – inga klockor
     jämförs mellan datorer, som annars går isär. */
  let tystnadstimer = null;

  function jagSkriver() {
    const nu = awareness.getLocalState()?.user;
    if (!nu) return;
    if (!nu.skriver) awareness.setLocalStateField('user', { ...nu, skriver: true });

    clearTimeout(tystnadstimer);
    tystnadstimer = setTimeout(() => {
      const senare = awareness.getLocalState()?.user;
      if (senare) awareness.setLocalStateField('user', { ...senare, skriver: false });
    }, TYSTNAD_MS);
  }

  /* Vid en radbrytning har ett och samma textindex två visuella platser: slutet
     av raden ovan och början av raden under. Vilken av dem min markör står på
     vet bara min egen webbläsare. Därför skickar jag med svaret, i stället för
     att de andra ska gissa. */
  function sattSammaRadSomFore(varde) {
    const nu = awareness.getLocalState()?.markor;
    if (nu && nu.sammaRadSomFore === varde) return;
    awareness.setLocalStateField('markor', { sammaRadSomFore: varde });
  }

  return {
    doc,
    provider,
    awareness,

    /* Kallas vid varje tangenttryck, så andra ser vem som är i farten. */
    jagSkriver,

    /* Står min markör på samma rad som tecknet före den? Se ovan. */
    sattSammaRadSomFore,

    /* Sant när det inte finns någon server att dela med alls. */
    get saknarServer() {
      return provider === null;
    },

    /* Titel, datum och status – fält där sista ändringen vinner. */
    meta: doc.getMap('meta'),

    /* En delad text per sektion. */
    text(nyckel) {
      return doc.getText('sektion:' + nyckel);
    },

    /* Körs när den lokala kopian är inläst, så vi inte visar tomt i onödan. */
    narLokaltKlar(fn) {
      lokal.once('synced', fn);
    },

    get ansluten() {
      return provider ? provider.wsconnected : false;
    },

    kopplaNed() {
      if (provider) provider.destroy();
      doc.destroy();
    }
  };
}

/* Vilka som är inne just nu, mig själv inräknad. */
export function deltagare(awareness) {
  const lista = [];
  awareness.getStates().forEach((state, clientId) => {
    if (state.user) lista.push({ clientId, ...state.user });
  });
  return lista;
}
