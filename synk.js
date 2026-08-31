/* All realtidssynk. Resten av appen pratar bara med det som returneras här. */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import { SYNKSERVER, RUMSPREFIX } from './config.js';

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
    color: profil.farg
  });

  return {
    doc,
    provider,
    awareness,

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
