/* Allt du normalt vill ändra ligger i den här filen. */

/* Bumpas vid varje driftsättning. Visas när man håller musen över pricken i
   statusraden, och skrivs ut i webbläsarens konsol vid start. Finns för att det
   ska gå att avgöra på en sekund om en webbläsare kör den senaste koden – den
   frågan har annars kostat oss mycket tid. */
export const KODVERSION = '2026-08-31 r';

export const APPNAMN = 'Delat dokument';

/* Hur många tillhörande rutor en sektion får utöver huvudrutan. */
export const MAX_TILLAGG = 2;

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

/* Sexton färger, en slumpas när en deltagare ansluter.
 *
 * Framtagna med hänsyn till två saker samtidigt: varje färg klarar
 * kontrastkravet för vit text (lägst 4,60 mot kravet 4,5), och nyanserna är
 * fördelade så att den minsta synliga skillnaden mellan två av dem blir så stor
 * som möjligt. Jämnt fördelade nyanser räcker inte – ögat skiljer dåligt mellan
 * grönt, så där ligger färgerna längre isär än i blått och violett.
 *
 * Byt dem inte styckvis. Ändrar du en försvinner avvägningen mot de övriga.
 */
export const DELTAGARFARGER = [
  '#D73B23', '#AA641C', '#827615', '#637E15',
  '#478315', '#168717', '#168641', '#16846A',
  '#188091', '#2276CE', '#5061E2', '#7650E2',
  '#A744E1', '#CA21C8', '#D72392', '#DD2B56'
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
