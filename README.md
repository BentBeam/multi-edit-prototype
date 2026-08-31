# Delat dokument

Prototyp för samredigering: flera personer skriver i samma dokument samtidigt,
via en delad länk. Statiska filer, ingen byggkedja – öppna dem i valfri
textredigerare.

## Filer

| Fil | Innehåll |
|---|---|
| `config.js` | Sektionernas rubriker och teckengränser, samt synkserverns adress. Börja här. |
| `styles.css` | Färger och form. Temat ligger som variabler högst upp. |
| `synk.js` | Realtidssynken. Yjs över websocket, plus lokal kopia i webbläsaren. |
| `kommentarer.js` | Kommentarsformatet i texten och trådarna som hör till. |
| `forfattare.js` | Läser ut vem som skrev vad, ur Yjs egen struktur. |
| `historik.js` | Hämtar sparade lägen och utför återställning. |
| `server/versioner.js` | Sparar och gallrar versionerna. |
| `lagring.js` | Vilka dokument du öppnat, och vem du är. Inte innehållet. |
| `app.js` | Vyer, validering och logik. |
| `server/` | Synkservern. Egen kod. |
| `server/lagring.js` | Beständig lagring i Netlify Blobs. Avstängd utan token. |

## Status

Klart: startsida, dokumentvy med tre oberoende textsektioner, tidsperiod,
statuspanel som listar vad som saknas, markera som klar, realtidssynk med
namngivna markörer, kommentarer med svar och lös-funktion, samt färgning
efter vem som skrivit vad, samt historik med återställning.

Prototypen är därmed komplett mot beställningen.

## Om historiken

Yjs egna snapshots går inte att använda: de kräver att skräpsamlingen är
avstängd, vilket skulle få dokumenten att växa i all oändlighet. I stället
sparas hela dokumentets tillstånd, vilket fungerar oavsett och kostar ungefär
tio kilobyte per version. Yjs sparar heller ingen tid alls, så tidsstämplarna
sätts av servern.

Servern sparar en version så snart ett dokument får innehåll, sedan varannan
minut medan någon redigerar, och alltid när sista deltagaren lämnar. Intervallet
styrs av `VERSION_MS`. Den första sparningen finns för att historiken annars står
tom de första minuterna, vilket ser ut som att funktionen inte fungerar.

Har ingenting ändrats sedan senaste versionen skapas ingen ny – i stället flyttas
den befintligas tidsstämpel fram. En rad oförändrade sparpunkter blir därmed en
enda post, märkt med den senaste tidpunkt den fortfarande gällde. Jämförelsen
görs med en kontrollsumma som ligger i indexet, så den kostar ingen inläsning. De tjugo senaste
automatiska versionerna behålls; manuellt sparade gallras aldrig.

Listan visar vilka versioner som skiljer sig från nuläget. Versioner märkta
"Samma som nu" går inte att återställa till – det skulle inte ändra något.

Bara den som skapade dokumentet kan återställa. Ägarskapet är en hemlig sträng i
skaparens webbläsare som dokumentet minns. Det är en spärr i gränssnittet, inte
säkerhet – den som läser koden kan gå runt den, och den som rensar sin
webbläsardata tappar sitt ägarskap.

Dokument som skapades innan ägarskap fanns har ingen ägare, och kunde därför
aldrig återställas. Historikpanelen erbjuder då "Gör mig till ägare".

Historiken raderas när dokumentet markeras som klart – då är innehållet
påskrivet, och äldre lägen ska inte finnas kvar. Ett läge behålls dock: det som
markerades klart, sparat under etiketten "Läget vid klarmarkering". Utan det kan
dokumentet återöppnas och ändras utan att något spår finns av vad som en gång
godkändes.

Att återställa är inte att rulla tillbaka. Återställningen läggs på som en ny
ändring, syns själv i historiken, och går att ångra genom att återställa till
något senare. Den utförs genom Quill, inte direkt i Yjs – skriver man i Yjs
bakom editorns rygg uppdaterar den inte alltid vad som visas.

## Om deltagarfärgerna

De sexton färgerna i `config.js` är uträknade, inte valda för hand. Varje färg
klarar kontrastkravet för vit text, och nyanserna är fördelade så att den minsta
synliga skillnaden mellan två av dem blir så stor som möjligt – jämnt fördelade
nyanser räcker inte, eftersom ögat skiljer sämre mellan grönt än mellan blått.
Byt dem inte styckvis; ändrar du en försvinner avvägningen mot de övriga.

Deltagarens initialer står vid markören i texten, och etiketten hålls synlig med
påtvingade css-regler. Biblioteket döljer den annars efter tre sekunder.

Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
textruta, men flyttar den bara i rutan där personen faktiskt står. I de övriga
blir en markör kvar på position noll. Det märktes inte så länge etiketterna
gömdes efter några sekunder. `markorer.js` tar bort dem.

## Om författarfärgningen

Ingenting märks upp i texten. Yjs vet redan vilken deltagare som satte in varje
tecken, och `forfattare.js` läser ut den kunskapen. Därför fungerar färgningen
även på text som skrevs innan funktionen fanns.

Priset är att filen läser Yjs interna struktur, som inte är ett utlovat
gränssnitt. Slutar färgningen fungera efter en uppdatering av Yjs är det den
filen att titta i.

Färgningen är en läsvy: texten byts ut mot en skrivskyddad rendering medan den
är påslagen, så färgläggningen aldrig kan råka ändra dokumentet.

## Köra lokalt

Synkservern måste vara igång för att två fönster ska hitta varandra:

    cd server
    npm install
    npm start

Servern lyssnar på port 1234. Öppna sedan sidan och dela länken mellan två
fönster – det ena gärna ett inkognitofönster, så får ni två olika namn.

## Synkservern i drift

Servern ligger i `server/`, och `render.yaml` i repots rot beskriver hur den ska
köras. Efter driftsättning: sätt `PUBLIK_SYNKSERVER` i `config.js` till
`wss://<tjänstens-namn>.onrender.com/ws`.

Gratisnivån somnar vid inaktivitet. Första besökaren väcker den och får vänta
upp till en minut; statusraden säger till under tiden.

## Lagring

Servern sparar dokumenten i Netlify Blobs om `NETLIFY_TOKEN` är satt, annars som
filer i `server/lagring/`. Det senare används lokalt och fungerar på vilken
maskin som helst med en riktig disk.

Skrivningen samlas ihop under åtta sekunder i stället för att ske vid varje
tangenttryck, och sker direkt när sista deltagaren lämnar. Läsningen begär stark
konsistens – standardinställningen kan ge upp till en minut gammal text.

## Att veta

Utan lagring ligger innehållet bara i Yjs och i varje deltagares webbläsare.
Servern håller då en arbetskopia i minnet, och stänger alla sina flikar samtidigt
som servern startar om kan innehållet vara borta.

Det finns ingen inloggning. Den som har länken kan redigera.

Servern skickar livstecken var 25:e sekund. Det håller anslutningen vid liv genom
brandväggar och tidsgränser, och gör att tysta sessioner inte ser övergivna ut.
Ett tomt rum sparas i två minuter innan det slängs, så en omladdning inte tappar
serverns kopia.

Genvägen mellan flikar i samma webbläsare är avstängd med avsikt (`disableBc`
i `synk.js`). Med den påslagen kan två flikar synka lokalt även när servern är
nere, vilket får delning att se ut att fungera när den inte gör det.
