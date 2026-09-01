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
| `rutor.js` | Sektionens rutor: lägga till, slå ihop, räkna tecken. |
| `rutlas.js` | Hindrar två personer från att skriva i samma textruta. |
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

## Om rutorna

En sektion har en huvudruta och upp till två tillhörande rutor. Poängen är att en
upptagen huvudruta inte ska stänga ut någon: man lägger till en egen ruta,
skriver där, och slår ihop den uppåt när det passar. Vem som helst får lägga till
och slå ihop, men inte medan någon av de två rutorna är upptagen.

Rutans id är sektionsnyckeln för huvudrutan och nyckeln med ett nummer för
tilläggen – `syfte`, `syfte:1`, `syfte:2`. Huvudrutan behåller därmed sitt gamla
namn, så dokument skapade innan funktionen fungerar oförändrat. Antalet rutor
ligger i dokumentets metafält, så alla ser samma struktur.

Teckengränsen gäller sektionen som helhet. Räknaren visar summan av dess rutor,
och du får skriva över gränsen – men "Markera som klar" är blockerad tills du
kortat.

Sammanslagning görs på datanivå, varefter sektionens redigerare byggs om. Att
skriva i den delade texten bakom en redigerares rygg uppdaterar den inte; bygger
man om läser de nya redigerarna rätt innehåll från början.

## Om rutlåset

En textruta någon annan har markören i går inte att redigera. Spärren ligger i
`beforeinput`, alltså innan tangenttrycket ändrat något.

Låset ligger på hela rutan, inte på stycket. Stycken flyttar sig, delas och slås
ihop, och en markör vid en styckesgräns hör tvetydigt till båda – det gav
gränsfall som inte gick att få rätt, och felplacerade markörer på skärmen.

En ruta räknas som upptagen så länge någon annan har markören där, oavsett om
hen skriver just nu.

Hamnar två personer i samma ruta måste en av dem få den, annars låser de ut
varandra och ingen kan skriva. Den med lägst deltagarnummer vinner. Numret är
slumpat, men båda webbläsarna ser samma siffror och kommer därför fram till
samma svar utan att fråga varandra. Den som förlorar får beskedet och kan flytta
sig eller lägga till ett eget fält – det är själva poängen med tilläggen. Märket i sektionsrubriken skiljer på "är här" och "skriver
här".

Markören försvinner ur närvarodatan så fort fönstret tappar fokus, alltså varje
gång någon växlar program. Därför hålls rutan kvar i tjugo sekunder efter att
markören försvunnit (`FRIST_MS`). Byter personen ruta släpps den gamla direkt,
och lämnar personen dokumentet släpps den omedelbart.

Det här är en artighetsspärr, inte ett lås: den sitter i webbläsaren och kan
kringgås, och två personer kan hamna i samma tomma ruta samtidigt. Synkmotorn
klarar det ändå.

## Felsökning

`KODVERSION` i `config.js` visas när man håller musen över pricken i statusraden,
och skrivs ut i webbläsarens konsol vid start. Bumpa den vid varje driftsättning
– annars går det inte att avgöra om en webbläsare kör den senaste koden.

`delatDokument.tillstand()` i konsolen visar version, deltagare, vem som skriver,
vilka rutor som är upptagna, och för varje markörelement om koden anser att det
hör hemma där det ligger. Den läser bara, och ändrar ingenting.

Fältet `markorer` är det som avgör spökmarkörsfrågor: står `horHemma: false` på
ett synligt element är städningen inte gjord, och då är det ordningen mellan
lyssnarna som ska kontrolleras först.

## Om deltagarfärgerna

De sexton färgerna i `config.js` är uträknade, inte valda för hand. Varje färg
klarar kontrastkravet för vit text, och nyanserna är fördelade så att den minsta
synliga skillnaden mellan två av dem blir så stor som möjligt – jämnt fördelade
nyanser räcker inte, eftersom ögat skiljer sämre mellan grönt än mellan blått.
Byt dem inte styckvis; ändrar du en försvinner avvägningen mot de övriga.

Deltagarens initialer står vid markören i texten, och etiketten hålls synlig med
påtvingade css-regler. Biblioteket döljer den annars efter tre sekunder.

Flaggans form kommer från Figma: 10 px fet vit text, 2 px och 4 px indrag, och
4 px hörnradie utom det hörn som vilar mot markörstrecket, som är rakt.
Biblioteket speglar flaggan när den inte får plats till höger om markören, och då
byter det raka hörnet sida – därför finns en regel för `.flag-flipped` också.
Radien måste påtvingas eftersom biblioteket sätter en egen.

Flaggan står vid sidan av markören, inte ovanför den. Biblioteket lyfter den en
hel flagghöjd uppåt, men radhöjden är 24 px och markören 17,5 px – det ger 6,5 px
luft mellan raderna medan flaggan är 15,5 px hög. Ovanför täcker den alltså
alltid en bit av raden över, vilket ser ut som att markören står på fel rad.
Vill du ha den ovanför igen krävs en radhöjd runt 34 px.

`markorer.js` rättar också placeringen vid mjuka radbrytningar. Där har ett och
samma textindex två visuella platser – slutet av raden ovan och början av raden
under – och Quill svarar alltid med den senare. Skriver någon förbi
radbrytningen hamnade deras markör därför längst till vänster på nästa rad.

Rättningen väljer slutet av raden ovanför, eftersom det är fallet när någon
skriver framåt. Priset är att den som medvetet ställer sig först på en radbruten
rad visas i slutet av raden över. Vid en hård radbrytning är platsen entydig och
då rättas ingenting.

Kopplingen mellan Quill och Yjs skapar en markör för varje deltagare i varje
textruta, men flyttar den bara i rutan där personen faktiskt står. I de övriga
blir en markör kvar på position noll. Det märktes inte så länge etiketterna
gömdes efter några sekunder.

`markorer.js` tar bort dem, och det måste ske i samma arbetspass som kopplingens
egen uppdatering – lyssnarna registreras därför efter kopplingarnas. Med
fördröjning hinner den felplacerade markören blinka till.

Vår närvarolyssnare måste köra sist, efter kopplingarnas egna – annars skapar de
spökmarkören efter att vi städat. Vid uppstart stämmer ordningen, men varje
ombyggd sektion registrerar nya kopplingar som hamnar efter oss. Därför flyttas
lyssnaren sist i kön igen vid varje ombyggnad, se `flyttaLyssnareSist`.

Städningen går igenom varje ruta, inte varje sektion. Missar man tilläggsrutorna
städas deras markörer aldrig – det felet gjorde jag när rutorna infördes.

Städningen körs också direkt när dokumentet öppnats. Kopplingen skapar nämligen
markörer för alla som redan är inne redan i sin konstruktor, alltså innan våra
lyssnare finns – utan den körningen låg felplacerade markörer kvar ända tills
någon rörde sig. Dessutom finns ett skyddsnät som sveper varannan sekund, ifall
kopplingen skapar markörer i något läge vi inte lyssnar på.

Att i stället dölja markörer med css fungerade sämre: biblioteket mäter
elementet när det placerar markören, och ett element med `display: none` saknar
mått, vilket gjorde att markören hamnade på fel rad.

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
