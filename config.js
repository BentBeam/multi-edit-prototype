/* Allt du normalt vill ändra ligger i den här filen. */

export const APPNAMN = 'Delat dokument';

/* Lägg till, ta bort eller döp om sektioner här. Nyckeln (key) måste vara unik
   och bör inte ändras efter att någon börjat skriva – den är det som kopplar
   texten till rätt ruta. */
export const SEKTIONER = [
  {
    key: 'sammanfattning',
    rubrik: 'Sammanfattning',
    hjalptext: 'Kort översikt.',
    maxTecken: 1500
  },
  {
    key: 'syfte',
    rubrik: 'Syfte och mål',
    hjalptext: 'Vad ska projektet uppnå?',
    maxTecken: 2000
  },
  {
    key: 'resultat',
    rubrik: 'Förväntade resultat',
    hjalptext: 'Vilken effekt förväntar ni er, och för vem?',
    maxTecken: 2000
  }
];

/* Färger som delas ut till deltagare, i tur och ordning. */
export const DELTAGARFARGER = [
  '#378ADD', '#BA7517', '#1D9E75', '#D4537E', '#7F77DD', '#D85A30'
];

/* Servern som skickar ändringar mellan deltagarna.

   Lokalt körs vår egen server i mappen server/. Starta den med:
       cd server && npm install && npm start

   Den publicerade sidan använder samma server, driftsatt hos Render under
   namnet multi-edit-sync. Den somnar efter en stunds inaktivitet och tar upp
   till en minut att vakna – statusraden säger till under tiden.

   Töms PUBLIK_SYNKSERVER fungerar sidan men utan delning: du kan skriva, och
   texten sparas i din egen webbläsare, men ingen annan ser den. */
const PUBLIK_SYNKSERVER = 'wss://multi-edit-sync.onrender.com/ws';

const korsLokalt = ['localhost', '127.0.0.1'].includes(location.hostname);

export const SYNKSERVER = korsLokalt
  ? 'ws://' + location.hostname + ':1234/ws'
  : PUBLIK_SYNKSERVER;

export const RUMSPREFIX = 'multi-edit-';
