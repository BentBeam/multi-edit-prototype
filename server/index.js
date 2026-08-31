/* Synkserver för prototypen.
 *
 * Håller ett dokument per rum i minnet, tar emot ändringar från alla som är
 * inne, och skickar dem vidare till de andra. Servern förstår Yjs protokoll, så
 * den som ansluter senare får hela innehållet – även om den som skrev är borta.
 *
 * Kör med:  npm install && npm start
 */

import http from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { las, skriv, lagringFinns, lagringsSlag } from './lagring.js';
import * as versioner from './versioner.js';

const PORT = Number(process.env.PORT || 1234);

/* Hur ofta servern hör efter om anslutningarna lever. Håller också trafiken
   igång, så att varken Render eller mellanliggande brandväggar tror att en
   tyst anslutning är övergiven. */
const HJARTSLAG_MS = 25000;

/* Hur länge ett tomt rum sparas innan det slängs. Utan fördröjning tappar
   servern sin kopia så fort någon laddar om sidan. */
const NADATID_MS = 120000;

/* Hur länge servern väntar efter en ändring innan den skriver till lagringen.
   Lagringen är byggd för många läsningar och få skrivningar, så vi samlar ihop
   en stunds redigering i stället för att skriva vid varje tangenttryck. */
const SPARA_MS = 8000;

/* Hur ofta en version sparas medan någon redigerar. */
const VERSION_MS = Number(process.env.VERSION_MS || 120000);

const MEDDELANDE_SYNK = 0;
const MEDDELANDE_NARVARO = 1;

/* rumsnamn -> { doc, awareness, anslutna, stadtimer, sparatimer, versionstimer } */
const rum = new Map();

function hamtaRum(namn) {
  let post = rum.get(namn);
  if (post) {
    /* Någon kom tillbaka innan rummet hann städas bort. */
    clearTimeout(post.stadtimer);
    post.stadtimer = null;
    return post;
  }

  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null);
  post = {
    doc, awareness,
    anslutna: new Set(),
    stadtimer: null, sparatimer: null, versionstimer: null,
    namnPerAnslutning: new Map(),
    baslinjeSparad: false,
    historikRensad: false
  };

  doc.on('update', (uppdatering, ursprung) => {
    const kodare = encoding.createEncoder();
    encoding.writeVarUint(kodare, MEDDELANDE_SYNK);
    syncProtocol.writeUpdate(kodare, uppdatering);
    sandTillAlla(post, encoding.toUint8Array(kodare), ursprung);

    /* Ändringen kom från lagringen själv – då finns den redan sparad. */
    if (ursprung !== 'lagring') schemalaggSparning(namn, post);
  });

  awareness.on('update', ({ added, updated, removed }, ursprung) => {
    const andrade = added.concat(updated, removed);
    const kodare = encoding.createEncoder();
    encoding.writeVarUint(kodare, MEDDELANDE_NARVARO);
    encoding.writeVarUint8Array(
      kodare,
      awarenessProtocol.encodeAwarenessUpdate(awareness, andrade)
    );
    sandTillAlla(post, encoding.toUint8Array(kodare), ursprung);
  });

  /* När dokumentet markeras klart raderas historiken. Då har man skrivit under
     på innehållet, och äldre lägen ska inte finnas kvar. */
  /* Reagerar bara när statusen faktiskt växlar. Observern körs vid varje
     metaändring, så utan den kontrollen skulle varje titeltryck räknas som en
     växling och skapa nya versioner. */
  let foregaendeStatus = null;

  doc.getMap('meta').observe(() => {
    const status = doc.getMap('meta').get('status') || 'utkast';
    if (status === foregaendeStatus) return;
    const forsta = foregaendeStatus === null;
    foregaendeStatus = status;

    if (status === 'klar') {
      post.historikRensad = true;
      post.baslinjeSparad = true;
      clearTimeout(post.versionstimer);
      post.versionstimer = null;
      versioner.nollstall(namn);
      return;
    }

    /* Återöppnat dokument får börja samla historik igen. */
    if (!forsta) {
      post.historikRensad = false;
      post.baslinjeSparad = false;
      startaVersionsklocka(namn, post);
    }
  });

  rum.set(namn, post);
  console.log('rum skapat:', namn);

  /* Läser in det som sparades sist. Kommer svaret efter att någon redan hunnit
     ansluta är det ingen fara – Yjs slår ihop, och de anslutna får ändringen
     skickad till sig som vilken annan ändring som helst. */
  versioner.harVersioner(namn).then(finns => { post.baslinjeSparad = finns; });

  las(namn).then(sparat => {
    if (sparat) {
      Y.applyUpdate(doc, sparat, 'lagring');
      console.log('läste in sparat innehåll:', namn);
    }
  });

  return post;
}

/* Vilka som är inne, till versionens uppgifter om vem som var med.
 *
 * Namnen läses inte ur närvarodatan vid sparningen. Den rensas av en tidsgräns
 * när en deltagare varit tyst en stund, vilket gav versioner märkta "ingen
 * inne" fast någon satt där. I stället minns vi namnet per anslutning så länge
 * anslutningen lever. */
function deltagarnamn(post) {
  const namn = [];
  post.namnPerAnslutning.forEach(n => {
    if (n && !namn.includes(n)) namn.push(n);
  });
  return namn;
}

function startaVersionsklocka(namn, post) {
  if (post.versionstimer || post.historikRensad) return;
  post.versionstimer = setTimeout(async () => {
    post.versionstimer = null;
    if (post.anslutna.size > 0 && !post.historikRensad) {
      await versioner.spara(namn, post.doc, { deltagare: deltagarnamn(post) });
      startaVersionsklocka(namn, post);
    }
  }, VERSION_MS);
}

function schemalaggSparning(namn, post) {
  if (post.sparatimer) return;
  post.sparatimer = setTimeout(async () => {
    post.sparatimer = null;
    await skriv(namn, Y.encodeStateAsUpdate(post.doc));

    /* Första gången ett dokument får innehåll sparas en version direkt, i
       stället för att vänta ut hela intervallet. Annars står historiken tom
       de första minuterna, och det ser ut som att funktionen inte finns. */
    if (!post.baslinjeSparad && !post.historikRensad) {
      post.baslinjeSparad = true;
      await versioner.spara(namn, post.doc, {
        etikett: null,
        deltagare: deltagarnamn(post)
      });
    }
  }, SPARA_MS);
}

/* Skriver med en gång, utan att vänta in fördröjningen. */
function sparaNu(namn, post) {
  clearTimeout(post.sparatimer);
  post.sparatimer = null;
  return skriv(namn, Y.encodeStateAsUpdate(post.doc));
}

function sandTillAlla(post, data, utom) {
  post.anslutna.forEach(anslutning => {
    if (anslutning === utom) return;
    if (anslutning.readyState === 1) anslutning.send(data);
  });
}

function skicka(anslutning, data) {
  if (anslutning.readyState === 1) anslutning.send(data);
}

/* Ändpunkterna nedan nås från sidan, som ligger på en annan adress.
   Ingen behörighetskontroll finns – den som når servern når allt, precis som
   för synken. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function svaraJson(res, data, kod = 200) {
  res.writeHead(kod, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function lasKropp(req) {
  const delar = [];
  for await (const bit of req) delar.push(bit);
  if (delar.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(delar).toString());
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const vag = decodeURIComponent((req.url || '/').split('?')[0]);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  /* Lista versioner: GET /api/versioner/<rum> */
  let traff = vag.match(/^\/api\/versioner\/(.+)$/);
  if (traff && req.method === 'GET') {
    const oppet = rum.get(traff[1]);
    svaraJson(res, {
      versioner: await versioner.listaMedSkillnad(traff[1], oppet?.doc || null)
    });
    return;
  }

  /* Hämta en version: GET /api/version/<rum>/<id> */
  traff = vag.match(/^\/api\/version\/(.+)\/([0-9]+)$/);
  if (traff && req.method === 'GET') {
    const data = await versioner.hamta(traff[1], traff[2]);
    if (!data) {
      svaraJson(res, { fel: 'versionen finns inte' }, 404);
      return;
    }
    res.writeHead(200, { ...CORS, 'content-type': 'application/octet-stream' });
    res.end(Buffer.from(data));
    return;
  }

  /* Spara en version för hand: POST /api/version/<rum> */
  traff = vag.match(/^\/api\/version\/(.+)$/);
  if (traff && req.method === 'POST') {
    const namn = traff[1];
    const post = rum.get(namn);
    if (!post) {
      svaraJson(res, { fel: 'dokumentet är inte öppet' }, 409);
      return;
    }
    const kropp = await lasKropp(req);
    const etikett = (kropp.etikett || 'Sparad version').toString().slice(0, 80);
    const sparad = await versioner.spara(namn, post.doc, {
      etikett,
      deltagare: deltagarnamn(post)
    });
    svaraJson(res, { version: sparad });
    return;
  }

  res.writeHead(200, { ...CORS, 'content-type': 'text/html; charset=utf-8' });
  res.end(
    '<meta charset="utf-8"><title>Synkservern kör</title>' +
    '<body style="font: 15px system-ui; padding: 40px; color: #1f1f1d">' +
    '<h1 style="font-weight: 500">Synkservern kör</h1>' +
    '<p>Öppna dokumenten i appen. Antal rum just nu: <b>' + rum.size + '</b></p>' +
    '<p>Beständig lagring: <b>' + lagringsSlag() + '</b></p>' +
    '<p>Node: <b>' + process.version + '</b></p>' +
    '<p>Tjänst: <b>' + (process.env.RENDER_SERVICE_NAME || 'lokalt') + '</b></p>'
  );
});

const wss = new WebSocketServer({ server });

wss.on('connection', (anslutning, request) => {
  /* Adressen ser ut som /ws/<rumsnamn> */
  const namn = decodeURIComponent((request.url || '/').split('/').filter(Boolean).slice(1).join('/'))
    || 'standard';

  const post = hamtaRum(namn);
  post.anslutna.add(anslutning);
  anslutning.binaryType = 'arraybuffer';
  anslutning.lever = true;
  anslutning.on('pong', () => { anslutning.lever = true; });

  /* Vilka närvaro-id den här anslutningen äger, så vi kan städa vid frånkoppling. */
  startaVersionsklocka(namn, post);

  const egnaIdn = new Set();
  const foljNarvaro = ({ added, updated, removed }, ursprung) => {
    if (ursprung !== anslutning) return;
    added.concat(updated).forEach(id => egnaIdn.add(id));
    removed.forEach(id => egnaIdn.delete(id));
  };
  post.awareness.on('update', foljNarvaro);

  /* Be motparten om dess ändringar, och skicka våra. */
  const start = encoding.createEncoder();
  encoding.writeVarUint(start, MEDDELANDE_SYNK);
  syncProtocol.writeSyncStep1(start, post.doc);
  skicka(anslutning, encoding.toUint8Array(start));

  const narvarande = Array.from(post.awareness.getStates().keys());
  if (narvarande.length > 0) {
    const kodare = encoding.createEncoder();
    encoding.writeVarUint(kodare, MEDDELANDE_NARVARO);
    encoding.writeVarUint8Array(
      kodare,
      awarenessProtocol.encodeAwarenessUpdate(post.awareness, narvarande)
    );
    skicka(anslutning, encoding.toUint8Array(kodare));
  }

  anslutning.on('message', data => {
    const avkodare = decoding.createDecoder(new Uint8Array(data));
    const typ = decoding.readVarUint(avkodare);

    if (typ === MEDDELANDE_SYNK) {
      const kodare = encoding.createEncoder();
      encoding.writeVarUint(kodare, MEDDELANDE_SYNK);
      syncProtocol.readSyncMessage(avkodare, kodare, post.doc, anslutning);
      if (encoding.length(kodare) > 1) skicka(anslutning, encoding.toUint8Array(kodare));
      return;
    }

    if (typ === MEDDELANDE_NARVARO) {
      awarenessProtocol.applyAwarenessUpdate(
        post.awareness,
        decoding.readVarUint8Array(avkodare),
        anslutning
      );

      /* Kom det ett namn med, minns det för den här anslutningen. */
      egnaIdn.forEach(id => {
        const namn = post.awareness.getStates().get(id)?.user?.name;
        if (namn) post.namnPerAnslutning.set(anslutning, namn);
      });
    }
  });

  anslutning.on('close', () => {
    /* Läses innan namnet tas bort, annars märks avslutningsversionen
       felaktigt som att ingen var inne. */
    const vilkaVarInne = deltagarnamn(post);

    post.anslutna.delete(anslutning);
    post.namnPerAnslutning.delete(anslutning);
    post.awareness.off('update', foljNarvaro);

    /* Ta bort just den här deltagarens närvaro, så de andra ser att hen gått. */
    awarenessProtocol.removeAwarenessStates(post.awareness, Array.from(egnaIdn), null);

    if (post.anslutna.size === 0) {
      /* Sista personen gick – skriv ner allt nu, vänta inte. */
      clearTimeout(post.versionstimer);
      post.versionstimer = null;
      sparaNu(namn, post);
      if (!post.historikRensad) {
        versioner.spara(namn, post.doc, { deltagare: vilkaVarInne });
      }
      console.log('rum tomt, sparas i', NADATID_MS / 1000, 'sekunder:', namn);
      post.stadtimer = setTimeout(() => {
        if (post.anslutna.size === 0) {
          rum.delete(namn);
          console.log('rum borttaget:', namn);
        }
      }, NADATID_MS);
    }
  });
});

/* Frågar varje anslutning om den lever. Svarar den inte till nästa runda är
   den död och städas bort – annars ligger spöken kvar i närvarolistan. */
setInterval(() => {
  wss.clients.forEach(anslutning => {
    if (anslutning.lever === false) {
      anslutning.terminate();
      return;
    }
    anslutning.lever = false;
    anslutning.ping();
  });
}, HJARTSLAG_MS);

server.listen(PORT, () => {
  console.log('synkservern lyssnar på http://localhost:' + PORT);
});
