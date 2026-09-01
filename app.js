import Quill from 'quill';
const QuillDelta = Quill.import('delta');
import QuillCursors from 'quill-cursors';
import { QuillBinding } from 'y-quill';

import { APPNAMN, KODVERSION, SEKTIONER, DELTAGARFARGER, RUMSPREFIX } from './config.js';
import { Lagring } from './lagring.js';
import { anslut, deltagare } from './synk.js';
import {
  registreraFormat, nyttTradId, skapaTrad, laggTillSvar, markeraLost,
  tradar, lyssna, taBortMarkering
} from './kommentarer.js';
import { registreraMig, forfattare, forfattarrader, hittaDeltagare } from './forfattare.js';
import * as historik from './historik.js';
import { stadaMarkorer } from './markorer.js';
import { uppdateraLas, arLast, glomLas } from './rutlas.js';
import {
  rutaId, rutorFor, allaRutor, antalRutor, kanLaggaTill, laggTill, slaIhop,
  tillaggsnummer, teckenISektion, sektionsnyckelFor
} from './rutor.js';

Quill.register('modules/cursors', QuillCursors);
registreraFormat();

const app = document.getElementById('app');
const modalLager = document.getElementById('modal-lager');

/* Det dokument som är öppet just nu. null på startsidan. */
let session = null;

/* En påbörjad kommentar som ännu inte skickats. */
let pastKommentar = null;
/* Tråden som är markerad i panelen. */
let aktivTrad = null;
let visaLosta = false;
/* Om texten visas färgad efter vem som skrivit den. */
let visaForfattare = false;
/* Halvskrivna svar, så de inte försvinner när panelen ritas om. */
const svarsutkast = {};

/* ---------- Småhjälpare ---------- */

/* Ett namn ger en bokstav, två eller fler ger första och sista. */
function initialer(namn) {
  const delar = namn.trim().split(/\s+/).filter(Boolean);
  if (delar.length === 0) return '?';
  const forsta = delar[0][0];
  const sista = delar.length > 1 ? delar[delar.length - 1][0] : '';
  return (forsta + sista).toUpperCase();
}

function formateraDatum(tid) {
  const dygn = Math.floor((Date.now() - tid) / 86400000);
  if (dygn === 0) return 'idag';
  if (dygn === 1) return 'igår';
  return dygn + ' dagar sedan';
}

function antalTecken(quill) {
  return quill.getText().replace(/\n+$/, '').length;
}

/* ---------- Validering ---------- */

function vadSomSaknas() {
  const saknas = [];
  const meta = session.synk.meta;
  const start = meta.get('start') || '';
  const slut = meta.get('slut') || '';

  if (!(meta.get('titel') || '').trim()) saknas.push('Titel');
  if (!start) saknas.push('Startdatum');
  if (!slut) saknas.push('Slutdatum');
  if (start && slut && slut < start) saknas.push('Slutdatum ligger före startdatum');

  SEKTIONER.forEach(sektion => {
    /* Gränsen gäller sektionen som helhet, alltså huvudrutan plus tilläggen. */
    const tecken = teckenISektion(session.synk, session.redigerare, sektion.key);
    if (tecken === 0) saknas.push(sektion.rubrik);
    else if (tecken > sektion.maxTecken) saknas.push(sektion.rubrik + ' är för lång');
  });

  return saknas;
}

/* ---------- Fråga innan något oåterkalleligt ---------- */

/* Egen dialog i stället för webbläsarens confirm, som låser hela sidan och
   inte går att formulera begripligt. */
function bekrafta({ rubrik, text, jaText = 'Ja', neText = 'Avbryt' }) {
  return new Promise(klar => {
    const foregaende = modalLager.innerHTML;
    const varDold = modalLager.hidden;

    modalLager.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bek-rubrik">
        <h2 id="bek-rubrik"></h2>
        <p id="bek-text"></p>
        <div class="kommentar-knappar">
          <button id="bek-nej"></button>
          <button class="primar" id="bek-ja"></button>
        </div>
      </div>`;
    modalLager.hidden = false;

    modalLager.querySelector('#bek-rubrik').textContent = rubrik;
    modalLager.querySelector('#bek-text').textContent = text;
    modalLager.querySelector('#bek-ja').textContent = jaText;
    modalLager.querySelector('#bek-nej').textContent = neText;

    function stang(svar) {
      modalLager.innerHTML = foregaende;
      modalLager.hidden = varDold;
      klar(svar);
    }

    modalLager.querySelector('#bek-ja').addEventListener('click', () => stang(true));
    modalLager.querySelector('#bek-nej').addEventListener('click', () => stang(false));
    modalLager.querySelector('#bek-ja').focus();
  });
}

/* ---------- Namnfrågan ---------- */

function fragaEfterNamn(nar) {
  const farg = DELTAGARFARGER[Math.floor(Math.random() * DELTAGARFARGER.length)];

  modalLager.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-rubrik">
      <h2 id="modal-rubrik">Vad heter du?</h2>
      <p>Namnet visas för andra som är inne i dokumentet.</p>
      <input type="text" id="namnfalt" placeholder="Ditt namn" autocomplete="name">
      <p class="fel" id="namnfel" hidden>Skriv ett namn först.</p>
      <div class="fargrad">
        <span class="fargprick" style="background: ${farg}"></span>
        <span>Din färg</span>
        <button class="primar" id="namnklar">Kör</button>
      </div>
    </div>`;
  modalLager.hidden = false;

  const falt = document.getElementById('namnfalt');
  const fel = document.getElementById('namnfel');
  falt.focus();

  function klar() {
    const namn = falt.value.trim();
    if (!namn) {
      fel.hidden = false;
      falt.focus();
      return;
    }
    Lagring.sparaProfil({ namn, farg });
    modalLager.hidden = true;
    nar();
  }

  document.getElementById('namnklar').addEventListener('click', klar);
  falt.addEventListener('input', () => { fel.hidden = true; });
  falt.addEventListener('keydown', e => { if (e.key === 'Enter') klar(); });
}

/* ---------- Startsidan ---------- */

function vyStart() {
  lamnaSession();

  const dokument = Lagring.lista();

  app.innerHTML = `
    <div class="start">
      <h1>Delat dokument</h1>
      <p class="ingress">Skriv tillsammans, i realtid. Dela länken med den som ska vara med.</p>
      <p><button class="primar" id="skapa">Skapa nytt dokument</button></p>
      <div class="lista" style="margin-top: 28px;">
        <h2>Dina dokument</h2>
        <div id="radlista"></div>
      </div>
      <p style="color: var(--text-svag); font-size: 13px; margin-top: 14px;">
        Listan sparas i den här webbläsaren. Länken är den enda vägen in för andra.
      </p>
    </div>`;

  const radlista = document.getElementById('radlista');

  if (dokument.length === 0) {
    radlista.innerHTML = '<p class="tom">Inga ännu.</p>';
  } else {
    dokument.forEach(post => {
      const rad = document.createElement('div');
      rad.className = 'rad';

      const oppna = document.createElement('button');
      oppna.className = 'radknapp';
      oppna.addEventListener('click', () => { location.hash = 'dok=' + post.id; });

      const namn = document.createElement('span');
      namn.className = 'namn';
      namn.textContent = post.titel.trim() || 'Namnlöst dokument';

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = (post.status === 'klar' ? 'klar · ' : '') +
        formateraDatum(post.andrad);

      oppna.append(namn, meta);

      const tabort = document.createElement('button');
      tabort.className = 'tabort';
      tabort.textContent = 'Ta bort';
      tabort.title = 'Tar bara bort det ur din lista';
      tabort.addEventListener('click', () => {
        Lagring.glom(post.id);
        vyStart();
      });

      rad.append(oppna, tabort);
      radlista.append(rad);
    });
  }

  document.getElementById('skapa').addEventListener('click', () => {
    const id = Lagring.nyttId();
    Lagring.sattAgarnyckel(id);
    Lagring.notera(id);
    location.hash = 'dok=' + id;
  });
}

/* ---------- Dokumentvyn ---------- */

function lamnaSession() {
  pastKommentar = null;
  aktivTrad = null;
  glomLas();
  if (!session) return;
  clearInterval(session.stadklocka);
  Object.values(session.bindningar).forEach(b => b.destroy());
  session.synk.kopplaNed();
  session = null;
}

function vyDokument(id) {
  lamnaSession();

  const profil = Lagring.lasProfil();
  if (!profil) {
    fragaEfterNamn(() => vyDokument(id));
    return;
  }

  Lagring.notera(id);
  const synk = anslut(id, { ...profil, initialer: initialer(profil.namn) });
  session = { id, synk, redigerare: {}, bindningar: {}, harVaritAnsluten: false, las: new Map() };

  app.innerHTML = `
    <header class="topprad">
      <div class="topprad-inner">
        <button class="tillbaka" id="tillbaka" aria-label="Till startsidan">←</button>
        <div class="rubrik" id="apprubrik"></div>
        <div class="narvaro" id="narvaro"></div>
        <button id="historikknapp">Historik</button>
        <button id="forfattarknapp">Visa författare</button>
        <button id="kopiera">Kopiera länk</button>
      </div>
    </header>
    <div class="sidinnehall">
      <div class="kort" id="formular"></div>
      <aside class="hogerkolumn">
        <div class="kort panel" id="panel"></div>
        <div id="kommentarer"></div>
      </aside>
    </div>
    <footer class="statusrad"><span class="prick" id="prick"></span><span id="statustext">Ansluter…</span></footer>`;

  document.getElementById('apprubrik').textContent = APPNAMN;
  document.getElementById('tillbaka').addEventListener('click', () => { location.hash = ''; });

  document.getElementById('historikknapp')
    .addEventListener('click', () => visaHistorik());

  const forfattarknapp = document.getElementById('forfattarknapp');
  forfattarknapp.addEventListener('click', () => {
    visaForfattare = !visaForfattare;
    forfattarknapp.textContent = visaForfattare ? 'Dölj författare' : 'Visa författare';
    forfattarknapp.classList.toggle('aktiv', visaForfattare);
    ritaForfattarvy();
  });

  const kopiera = document.getElementById('kopiera');
  kopiera.addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.href);
    kopiera.textContent = 'Länken är kopierad';
    setTimeout(() => { kopiera.textContent = 'Kopiera länk'; }, 2000);
  });

  byggFormular();

  /* Ändringar som kommer från någon annan. */
  synk.meta.observe(() => {
    synkaStruktur();
    speglaMeta();
    ritaPanel();
    Lagring.notera(id, {
      titel: synk.meta.get('titel') || '',
      status: synk.meta.get('status') || 'utkast'
    });
  });

  synk.awareness.on('change', () => {
    ritaNarvaro();
    schemalaggMarkorstadning();
  });
  if (synk.provider) {
    synk.provider.on('status', handelse => {
      if (handelse.status === 'connected') session.harVaritAnsluten = true;
      ritaStatusrad();
    });
    synk.provider.on('sync', ritaStatusrad);
  }

  registreraMig(synk, profil);
  synk.narLokaltKlar(() => gorAnspraakPaAgarskap(id, profil));
  if (synk.provider) synk.provider.once('sync', () => gorAnspraakPaAgarskap(id, profil));
  setTimeout(() => gorAnspraakPaAgarskap(id, profil), 3000);
  lyssna(synk, ritaKommentarer);

  speglaMeta();
  ritaNarvaro();
  ritaPanel();
  ritaStatusrad();
  ritaKommentarer();
  ritaForfattarvy();

  /* Kopplingen skapar markörer för alla som redan är inne redan i sin
     konstruktor, innan våra lyssnare finns. Utan den här städningen ligger
     felplacerade markörer kvar ända till någon rör sig. */
  schemalaggMarkorstadning();

  /* Skyddsnät. Skulle kopplingen skapa markörer i något läge vi inte lyssnar
     på, försvinner de inom några sekunder i stället för att ligga kvar. */
  session.stadklocka = setInterval(schemalaggMarkorstadning, 2000);
}

function byggFormular() {
  const formular = document.getElementById('formular');
  const meta = session.synk.meta;

  formular.innerHTML = `
    <div class="faltgrupp">
      <label class="etikett" for="titel">Titel</label>
      <input type="text" id="titel" placeholder="Titel på dokumentet">
    </div>
    <div class="faltgrupp">
      <h2>Tidsperiod</h2>
      <div class="datumrad">
        <div>
          <label class="etikett" for="start">Startdatum</label>
          <input type="date" id="start">
        </div>
        <div>
          <label class="etikett" for="slut">Slutdatum</label>
          <input type="date" id="slut">
        </div>
      </div>
    </div>
    <div id="forfattarlegend" hidden></div>
    <div id="sektioner"></div>`;

  ['titel', 'start', 'slut'].forEach(falt => {
    const input = document.getElementById(falt);
    const handelse = falt === 'titel' ? 'input' : 'change';
    input.addEventListener(handelse, () => {
      meta.set(falt, input.value);
      ritaPanel();
    });
  });

  const behallare = document.getElementById('sektioner');
  SEKTIONER.forEach(sektion => byggSektion(behallare, sektion));
}

/* En sektion: rubrik, dess rutor, teckenräknare och knappen som lägger till. */
function byggSektion(behallare, sektion) {
  const block = document.createElement('div');
  block.className = 'sektion';
  block.id = 'sektion-' + sektion.key;
  block.innerHTML = `
    <div class="sektion-huvud">
      <h2></h2>
      <span class="hjalptext"></span>
    </div>
    <div class="rutor"></div>
    <div class="sektion-fot">
      <span class="raknare"></span>
      <button class="laggtill" type="button"></button>
    </div>`;

  block.querySelector('h2').textContent = sektion.rubrik;
  block.querySelector('.hjalptext').textContent = sektion.hjalptext;
  behallare.append(block);

  const knapp = block.querySelector('.laggtill');
  knapp.textContent = '+ Lägg till fält';
  knapp.title = 'Ett eget fält att skriva i, som senare kan slås ihop uppåt';
  knapp.addEventListener('click', () => {
    if (laggTill(session.synk, sektion.key)) byggOmSektion(sektion);
  });

  ritaRutor(sektion);
}

/* Bygger sektionens rutor från grunden. */
function ritaRutor(sektion) {
  const block = document.getElementById('sektion-' + sektion.key);
  if (!block) return;

  const behallare = block.querySelector('.rutor');
  behallare.innerHTML = '';

  rutorFor(session.synk, sektion.key).forEach(rutaid => byggRuta(behallare, sektion, rutaid));

  block.querySelector('.laggtill').hidden = !kanLaggaTill(session.synk, sektion.key);
  block.dataset.antalRutor = String(antalRutor(session.synk, sektion.key));

  uppdateraRaknare(sektion);
  satLast(session.synk.meta.get('status') === 'klar');
}

function byggRuta(behallare, sektion, rutaid) {
  const nummer = tillaggsnummer(rutaid);

  const ruta = document.createElement('div');
  ruta.className = 'ruta';
  ruta.id = 'ruta-' + rutaid;
  ruta.innerHTML = `
    <div class="ruta-huvud">
      <span class="ruta-etikett"></span>
      <span class="ruta-knappar"></span>
    </div>
    <div class="redigerare"></div>`;

  if (nummer > 0) {
    ruta.querySelector('.ruta-etikett').textContent = 'Tillägg ' + nummer;

    const ihop = document.createElement('button');
    ihop.type = 'button';
    ihop.className = 'slaihop';
    ihop.textContent = '↥ Slå ihop uppåt';
    ihop.addEventListener('click', () => forsokSlaIhop(sektion, nummer));
    ruta.querySelector('.ruta-knappar').append(ihop);
  }

  behallare.append(ruta);

  const quill = new Quill(ruta.querySelector('.redigerare'), {
    theme: 'snow',
    placeholder: nummer > 0 ? 'Ditt tillägg' : 'Skriv här',
    modules: {
      toolbar: false,
      /* Att etiketten alltid syns styrs i stilmallen, inte här – biblioteket
         döljer den med css, inte med fördröjningen. */
      cursors: { transformOnTextChange: true }
    }
  });

  const bindning = new QuillBinding(session.synk.text(rutaid), quill, session.synk.awareness);

  quill.on('text-change', (delta, gammal, kalla) => {
    if (kalla === 'user') session.synk.jagSkriver();
    uppdateraRaknare(sektion);
    ritaPanel();
    if (visaForfattare) ritaForfattarvy();
    schemalaggMarkorstadning();
  });

  /* Hindrar inmatning i en ruta någon annan har markören i. beforeinput fångar
     tangenttryck, inklistring och radering innan något ändrats. */
  ['beforeinput', 'paste', 'drop'].forEach(handelse => {
    quill.root.addEventListener(handelse, e => {
      const vem = arLast(session?.las, rutaid);
      if (!vem) return;
      e.preventDefault();
      visaLasbesked(vem);
    });
  });

  kopplaMarkering(quill, rutaid);

  quill.root.addEventListener('click', e => {
    const traff = e.target.closest('[data-trad]');
    aktivTrad = traff ? traff.getAttribute('data-trad') : null;
    ritaKommentarer();
    if (traff) {
      document.getElementById('trad-' + aktivTrad)?.scrollIntoView({ block: 'nearest' });
    }
  });

  session.redigerare[rutaid] = quill;
  session.bindningar[rutaid] = bindning;
}

/* Bygger om en sektion när antalet rutor ändrats, av mig eller någon annan.
 *
 * Kopplingarna kastas och skapas på nytt. Det gör att de nya redigerarna läser
 * rätt innehåll från början – att skriva i den delade texten bakom en
 * redigerares rygg uppdaterar den nämligen inte. */
function byggOmSektion(sektion) {
  if (!session) return;

  rutorFor(session.synk, sektion.key).concat(
    [1, 2].map(n => rutaId(sektion.key, n))
  ).forEach(rutaid => {
    session.bindningar[rutaid]?.destroy();
    delete session.bindningar[rutaid];
    delete session.redigerare[rutaid];
  });

  ritaRutor(sektion);
  ritaPanel();
  if (visaForfattare) ritaForfattarvy();
  schemalaggMarkorstadning();
}

/* Bygger om de sektioner vars antal rutor ändrats. Kallas när metafälten
   ändras, så en ruta någon annan lagt till dyker upp här också. */
function synkaStruktur() {
  if (!session) return;
  SEKTIONER.forEach(sektion => {
    const block = document.getElementById('sektion-' + sektion.key);
    if (!block) return;
    const visat = Number(block.dataset.antalRutor || 1);
    if (visat !== antalRutor(session.synk, sektion.key)) byggOmSektion(sektion);
  });
}

async function forsokSlaIhop(sektion, nummer) {
  const ovan = arLast(session.las, rutaId(sektion.key, nummer - 1));
  const denna = arLast(session.las, rutaId(sektion.key, nummer));
  const upptagen = ovan || denna;

  if (upptagen) {
    visaLasbesked(upptagen);
    return;
  }

  const ja = await bekrafta({
    rubrik: 'Slå ihop tillägg ' + nummer + ' med fältet ovanför?',
    text: 'Texten läggs sist i fältet ovanför och tilläggsfältet försvinner. '
        + 'Det går att ångra genom historiken.',
    jaText: 'Slå ihop'
  });
  if (!ja) return;

  /* Kontrollera igen – någon kan ha hunnit ställa sig i rutan. */
  const nu = arLast(session.las, rutaId(sektion.key, nummer - 1))
          || arLast(session.las, rutaId(sektion.key, nummer));
  if (nu) {
    visaLasbesked(nu);
    return;
  }

  if (slaIhop(session.synk, sektion.key, nummer)) byggOmSektion(sektion);
}

function speglaMeta() {
  const meta = session.synk.meta;
  ['titel', 'start', 'slut'].forEach(falt => {
    const input = document.getElementById(falt);
    if (!input || document.activeElement === input) return;
    const varde = meta.get(falt) || '';
    if (input.value !== varde) input.value = varde;
  });
  satLast(meta.get('status') === 'klar');
}

/* Räknaren visar sektionens summa mot dess gräns, inte den enskilda rutans. */
function uppdateraRaknare(sektion) {
  const block = document.getElementById('sektion-' + sektion.key);
  if (!block) return;

  const raknare = block.querySelector('.raknare');
  const kvar = sektion.maxTecken - teckenISektion(session.synk, session.redigerare, sektion.key);

  raknare.textContent = kvar >= 0
    ? kvar.toLocaleString('sv-SE') + ' tecken kvar'
    : Math.abs(kvar).toLocaleString('sv-SE') + ' tecken för mycket';
  raknare.classList.toggle('over', kvar < 0);
}

function satLast(last) {
  ['titel', 'start', 'slut'].forEach(falt => {
    const input = document.getElementById(falt);
    if (input) input.disabled = last;
  });
  Object.entries(session.redigerare).forEach(([rutaid, quill]) => {
    quill.enable(!last);
    document.getElementById('ruta-' + rutaid)?.classList.toggle('last', last);
  });

  SEKTIONER.forEach(sektion => {
    const block = document.getElementById('sektion-' + sektion.key);
    if (block) block.querySelector('.laggtill').disabled = last;
  });
}

/* Städar markörerna direkt, utan fördröjning.
 *
 * Lyssnarna registreras efter kopplingarnas egna, så den här körs i samma
 * arbetspass men efter dem – innan webbläsaren hinner rita om. Med fördröjning
 * hinner en felplacerad markör synas. */
function schemalaggMarkorstadning() {
  if (!session) return;
  stadaMarkorer(session.synk, session.redigerare);
  session.las = uppdateraLas(session.synk, session.redigerare);
}

/* Kort besked när någon försöker skriva i ett upptaget stycke. */
let lasbeskedTimer = null;

function visaLasbesked(vem) {
  let ruta = document.getElementById('lasbesked');
  if (!ruta) {
    ruta = document.createElement('div');
    ruta.id = 'lasbesked';
    ruta.className = 'lasbesked';
    document.body.append(ruta);
  }
  ruta.textContent = vem.namn + ' är i den rutan just nu';
  ruta.style.setProperty('--lasfarg', vem.farg);
  ruta.classList.add('syns');

  clearTimeout(lasbeskedTimer);
  lasbeskedTimer = setTimeout(() => ruta.classList.remove('syns'), 2600);
}

/* ---------- Närvaro och anslutning ---------- */

function ritaNarvaro() {
  const behallare = document.getElementById('narvaro');
  if (!behallare) return;
  behallare.innerHTML = '';

  deltagare(session.synk.awareness).forEach(person => {
    /* name bär initialerna, avsett för markören i texten. Här vill vi ha det
       fullständiga namnet och räkna ut initialerna själva. */
    const namn = person.fulltNamn || person.name;

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.style.background = person.color;
    avatar.textContent = initialer(namn);
    avatar.title = namn;
    avatar.setAttribute('role', 'img');
    avatar.setAttribute('aria-label', namn);
    behallare.append(avatar);
  });

  ritaStatusrad();
}

function ritaStatusrad() {
  const text = document.getElementById('statustext');
  const prick = document.getElementById('prick');
  if (!text) return;

  const antal = deltagare(session.synk.awareness).length;
  const ansluten = session.synk.ansluten;

  if (session.synk.saknarServer) {
    prick.className = 'prick gra';
    text.textContent = 'Ingen synkserver vald – du kan skriva, men ingen annan ser det';
    return;
  }

  prick.title = 'Kodversion ' + KODVERSION;

  if (ansluten) {
    prick.className = 'prick gron';
    text.textContent = antal > 1
      ? `Ansluten · ${antal} personer inne`
      : 'Ansluten · du är ensam här';
    return;
  }

  prick.className = 'prick gul';

  /* Har vi aldrig fått kontakt sover servern troligen och håller på att starta.
     Har vi haft kontakt och tappat den är det något annat. Klienten fortsätter
     försöka i båda fallen, så det här handlar bara om att säga rätt sak. */
  text.textContent = session.harVaritAnsluten
    ? 'Tappade kontakten med servern – försöker igen, det du skriver sparas så länge'
    : 'Startar servern, det kan ta upp till en minut – det du skriver sparas så länge';
}

/* ---------- Statuspanelen ---------- */

function ritaPanel() {
  const panel = document.getElementById('panel');
  if (!panel || !session) return;

  const meta = session.synk.meta;
  const saknas = vadSomSaknas();
  const arKlar = meta.get('status') === 'klar';

  panel.innerHTML = `
    <p class="status">Status: <b id="statusord"></b></p>
    <p class="beskrivning" id="beskrivning"></p>
    <div id="saknasdel"></div>
    <button id="klarknapp"></button>`;

  panel.querySelector('#statusord').textContent = arKlar ? 'klar' : 'utkast';

  const beskrivning = panel.querySelector('#beskrivning');
  const saknasdel = panel.querySelector('#saknasdel');
  const knapp = panel.querySelector('#klarknapp');

  if (arKlar) {
    beskrivning.textContent = 'Dokumentet är låst för redigering.';
    knapp.textContent = 'Återöppna dokumentet';
    knapp.addEventListener('click', () => meta.set('status', 'utkast'));
    return;
  }

  if (saknas.length === 0) {
    beskrivning.textContent = 'Allt är ifyllt.';
    saknasdel.innerHTML = '<p class="klar-besked">Dokumentet går att markera som klart.</p>';
    knapp.className = 'primar';
    knapp.textContent = 'Markera som klar';
    knapp.addEventListener('click', async () => {
      const ja = await bekrafta({
        rubrik: 'Markera dokumentet som klart?',
        text: 'Historiken raderas, eftersom innehållet då är påskrivet. Läget du '
            + 'markerar som klart sparas som en version. Dokumentet låses för '
            + 'redigering, men går att återöppna.',
        jaText: 'Markera som klar'
      });
      if (ja) meta.set('status', 'klar');
    });
    return;
  }

  beskrivning.textContent = saknas.length === 1
    ? 'En uppgift saknas innan du kan markera dokumentet som klart.'
    : saknas.length + ' uppgifter saknas innan du kan markera dokumentet som klart.';

  const lista = document.createElement('ul');
  lista.className = 'saknas-lista';
  saknas.forEach(rubrik => {
    const rad = document.createElement('li');
    rad.textContent = rubrik;
    lista.append(rad);
  });
  saknasdel.append(lista);

  knapp.textContent = 'Markera som klar';
  knapp.disabled = true;
}

/* ---------- Ägarskap ---------- */

/* Den som skapade dokumentet har en nyckel i sin webbläsare. Första gången ett
   sådant dokument öppnas skrivs nyckeln in i dokumentet. Sedan är det bara den
   webbläsaren som räknas som ägare. */
function gorAnspraakPaAgarskap(id, profil) {
  if (!session || session.id !== id) return;
  const nyckel = Lagring.agarnyckel(id);
  if (!nyckel) return;
  if (session.synk.meta.get('agare')) return;

  session.synk.meta.set('agare', nyckel);
  session.synk.meta.set('agarnamn', profil.namn);
}

function arAgare() {
  if (!session) return false;
  const nyckel = Lagring.agarnyckel(session.id);
  return Boolean(nyckel) && session.synk.meta.get('agare') === nyckel;
}

/* ---------- Historik ---------- */

function formateraTid(tid) {
  return new Date(tid).toLocaleString('sv-SE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

async function visaHistorik() {
  const rum = RUMSPREFIX + session.id;

  modalLager.innerHTML = `
    <div class="modal bred" role="dialog" aria-modal="true" aria-labelledby="hist-rubrik">
      <div class="modalhuvud">
        <h2 id="hist-rubrik">Historik</h2>
        <button id="hist-stang" aria-label="Stäng">Stäng</button>
      </div>
      <p id="hist-info"></p>
      <div class="hist-knappar" id="hist-knappar">
        <button id="hist-spara">Spara nuläget som version</button>
      </div>
      <div id="hist-lista" class="hist-lista">Hämtar…</div>
    </div>`;
  modalLager.hidden = false;

  document.getElementById('hist-stang')
    .addEventListener('click', () => { modalLager.hidden = true; });

  const info = document.getElementById('hist-info');
  const agarnamn = session.synk.meta.get('agarnamn');
  const harAgare = Boolean(session.synk.meta.get('agare'));

  if (arAgare()) {
    info.textContent = 'Du äger dokumentet och kan återställa till ett tidigare läge.';
  } else if (harAgare) {
    info.textContent = 'Bara ' + (agarnamn || 'den som skapade dokumentet') + ' kan återställa.';
  } else {
    /* Dokument skapade innan ägarskap fanns har ingen ägare. Någon måste kunna
       ta rollen, annars går de aldrig att återställa. */
    info.textContent = 'Dokumentet har ingen registrerad ägare. Bara ägaren kan återställa.';
    const ta = document.createElement('button');
    ta.id = 'hist-taagare';
    ta.textContent = 'Gör mig till ägare';
    ta.addEventListener('click', () => {
      const nyckel = Lagring.agarnyckel(session.id) || Lagring.sattAgarnyckel(session.id);
      session.synk.meta.set('agare', nyckel);
      session.synk.meta.set('agarnamn', Lagring.lasProfil()?.namn || 'Okänd');
      visaHistorik();
    });
    document.getElementById('hist-knappar').prepend(ta);
  }

  document.getElementById('hist-spara').addEventListener('click', async e => {
    e.target.disabled = true;
    e.target.textContent = 'Sparar…';
    await historik.sparaVersion(rum, 'Sparad av ' + (Lagring.lasProfil()?.namn || 'okänd'));
    visaHistorik();
  });

  ritaHistoriklista(rum);
}

async function ritaHistoriklista(rum) {
  const behallare = document.getElementById('hist-lista');
  if (!behallare) return;

  const poster = await historik.lista(rum);
  if (!document.getElementById('hist-lista')) return;

  behallare.innerHTML = '';

  if (poster.length === 0) {
    const tom = document.createElement('p');
    tom.className = 'hist-tom';
    tom.textContent = session.synk.meta.get('status') === 'klar'
      ? 'Historiken raderades när dokumentet markerades som klart.'
      : 'Inga sparade lägen än. Servern sparar så snart dokumentet har innehåll.';
    behallare.append(tom);
    return;
  }

  poster.forEach(post => {
    const rad = document.createElement('div');
    rad.className = 'hist-rad';

    const vanster = document.createElement('div');
    vanster.className = 'hist-text';

    const tid = document.createElement('span');
    tid.className = 'hist-tid';
    tid.textContent = formateraTid(post.tid);

    if (post.skiljerSig === false) {
      const marke = document.createElement('span');
      marke.className = 'hist-marke';
      marke.textContent = 'Samma som nu';
      tid.append(' ', marke);
    }

    const under = document.createElement('span');
    under.className = 'hist-under';
    const vilka = post.deltagare?.length ? post.deltagare.join(', ') : 'ingen inne';
    under.textContent = (post.manuell ? post.etikett + ' · ' : 'Automatisk · ') + vilka;

    vanster.append(tid, under);

    const knappar = document.createElement('div');
    knappar.className = 'hist-radknappar';

    const visa = document.createElement('button');
    visa.textContent = 'Visa';
    visa.addEventListener('click', () => visaVersion(rum, post));
    knappar.append(visa);

    /* Ingen mening att återställa till något som är identiskt med nuläget. */
    if (arAgare() && post.skiljerSig !== false) {
      const ater = document.createElement('button');
      ater.className = 'primar';
      ater.textContent = 'Återställ';
      ater.addEventListener('click', () => aterstallTill(rum, post));
      knappar.append(ater);
    }

    rad.append(vanster, knappar);
    behallare.append(rad);
  });
}

async function visaVersion(rum, post) {
  const tillstand = await historik.hamta(rum, post.id);
  if (!tillstand) return;

  const innehall = historik.lasTexter(tillstand);

  modalLager.innerHTML = `
    <div class="modal bred" role="dialog" aria-modal="true" aria-labelledby="ver-rubrik">
      <div class="modalhuvud">
        <h2 id="ver-rubrik">Läget ${formateraTid(post.tid)}</h2>
        <button id="ver-tillbaka">Tillbaka</button>
      </div>
      <div id="ver-innehall" class="ver-innehall"></div>
    </div>`;
  modalLager.hidden = false;

  document.getElementById('ver-tillbaka')
    .addEventListener('click', () => visaHistorik());

  const behallare = document.getElementById('ver-innehall');

  const rader = [
    ['Titel', innehall.titel],
    ['Tidsperiod', [innehall.start, innehall.slut].filter(Boolean).join(' till ')]
  ].concat(innehall.sektioner.map(s => [s.rubrik, s.text]));

  rader.forEach(([rubrik, text]) => {
    const del = document.createElement('div');
    del.className = 'ver-del';
    const r = document.createElement('span');
    r.className = 'ver-rubrik';
    r.textContent = rubrik;
    const t = document.createElement('p');
    t.className = 'ver-text' + (text ? '' : ' tom');
    t.textContent = text || 'Tomt';
    del.append(r, t);
    behallare.append(del);
  });
}

async function aterstallTill(rum, post) {
  if (!arAgare()) return;
  const ja = await bekrafta({
    rubrik: 'Återställa till ' + formateraTid(post.tid) + '?',
    text: 'Nuvarande text ersätts. Återställningen sparas som en ny ändring, så den '
        + 'går att ångra genom att återställa till något senare.',
    jaText: 'Återställ'
  });
  if (!ja) return;

  const tillstand = await historik.hamta(rum, post.id);
  if (!tillstand) return;

  /* Sätter metafälten och antalet rutor, och lämnar tillbaka texterna. */
  const texter = historik.aterstall(session.synk, tillstand);
  modalLager.hidden = true;

  /* Bygg om rutorna så antalet stämmer, och lägg sedan in texterna genom
     redigerarna – att skriva direkt i den delade texten visas inte. */
  SEKTIONER.forEach(sektion => byggOmSektion(sektion));

  Object.entries(texter).forEach(([rutaid, delta]) => {
    const quill = session.redigerare[rutaid];
    if (quill) quill.setContents(new QuillDelta(delta), 'user');
  });

  speglaMeta();
  ritaPanel();
  if (visaForfattare) ritaForfattarvy();
}

/* ---------- Vem skrev vad ---------- */

/* Färgningen är en läsvy, inte ett redigeringsläge. Texten byts ut mot en
   skrivskyddad rendering, så färgläggningen aldrig kan råka ändra dokumentet. */
function ritaForfattarvy() {
  if (!session) return;

  const legend = document.getElementById('forfattarlegend');

  allaRutor(session.synk).forEach(({ id }) => {
    const ruta = document.getElementById('ruta-' + id);
    if (!ruta) return;

    const behallare = ruta.querySelector('.ql-container');
    let vy = ruta.querySelector('.forfattarvy');

    if (!visaForfattare) {
      if (vy) vy.remove();
      if (behallare) behallare.hidden = false;
      return;
    }

    if (!vy) {
      vy = document.createElement('div');
      vy.className = 'forfattarvy';
      behallare.after(vy);
    }
    behallare.hidden = true;
    vy.innerHTML = '';

    const ytext = session.synk.text(id);
    const text = ytext.toString();

    if (!text.trim()) {
      const tom = document.createElement('span');
      tom.className = 'forfattarvy-tom';
      tom.textContent = 'Tom';
      vy.append(tom);
      return;
    }

    forfattarrader(ytext).forEach(rad => {
      const person = personFor(rad.klient);
      const del = document.createElement('span');
      del.className = 'forfattardel';
      /* Två tecken hex på slutet ger färgen låg täckning, så texten går att läsa. */
      del.style.background = person.farg + '33';
      del.style.boxShadow = 'inset 2px 0 0 ' + person.farg;
      del.title = person.namn;
      del.textContent = text.slice(rad.index, rad.index + rad.langd);
      vy.append(del);
    });
  });

  if (!legend) return;

  if (!visaForfattare) {
    legend.hidden = true;
    return;
  }

  const personer = forfattare(session.synk);
  legend.hidden = false;
  legend.innerHTML = '';

  if (personer.length === 0) {
    const tom = document.createElement('span');
    tom.className = 'legend-tom';
    tom.textContent = 'Ingen har skrivit något än.';
    legend.append(tom);
    return;
  }

  personer.forEach(person => {
    const post = document.createElement('span');
    post.className = 'legend-post';
    const prick = document.createElement('span');
    prick.className = 'legend-prick';
    prick.style.background = person.farg;
    const namn = document.createElement('span');
    namn.textContent = person.namn;
    post.append(prick, namn);
    legend.append(post);
  });
}

/* Slår upp en deltagare på nummer, med reserv för text skriven innan kartan
   fanns. Används för att färga texten – där behövs numret, till skillnad från
   teckenförklaringen som räknar personer. */
function personFor(klientId) {
  return hittaDeltagare(session.synk, klientId)
    || { namn: 'Okänd', farg: '#a5a5a0' };
}

/* ---------- Kommentarer ---------- */

function kommentarknapp() {
  let knapp = document.getElementById('kommentera-knapp');
  if (!knapp) {
    knapp = document.createElement('button');
    knapp.id = 'kommentera-knapp';
    knapp.className = 'kommentera-knapp';
    knapp.textContent = 'Kommentera';
    knapp.hidden = true;
    /* Utan detta tappar textrutan markeringen så fort man trycker ned musknappen,
       och knappen hinner försvinna innan klicket går fram. */
    knapp.addEventListener('mousedown', e => e.preventDefault());
    document.body.append(knapp);
  }
  return knapp;
}

/* Visar knappen "Kommentera" ovanför markerad text. */
function kopplaMarkering(quill, rutaid) {
  quill.on('selection-change', range => {
    const knapp = kommentarknapp();

    if (!range || range.length === 0 || !quill.isEnabled()) {
      knapp.hidden = true;
      return;
    }

    const plats = quill.getBounds(range.index, range.length);
    const ruta = quill.container.getBoundingClientRect();
    knapp.style.top = (window.scrollY + ruta.top + plats.top - 36) + 'px';
    knapp.style.left = (window.scrollX + ruta.left + plats.left) + 'px';
    knapp.hidden = false;

    knapp.onclick = () => {
      pastKommentar = {
        sektion: rutaid,
        index: range.index,
        langd: range.length,
        ledtext: quill.getText(range.index, range.length).trim().slice(0, 90),
        text: ''
      };
      knapp.hidden = true;
      ritaKommentarer();
      document.getElementById('nytt-inlagg')?.focus();
    };
  });
}

/* Färgar den valda trådens textstycke. Görs som en css-regel i stället för en
   klass på elementet, eftersom Quill bygger om texten när någon skriver och då
   skulle en klass falla bort. */
function visaAktivMarkering() {
  let stil = document.getElementById('aktiv-markering-stil');
  if (!stil) {
    stil = document.createElement('style');
    stil.id = 'aktiv-markering-stil';
    document.head.append(stil);
  }
  stil.textContent = aktivTrad
    ? '.kommenterad[data-trad="' + aktivTrad + '"]' +
      ' { background: var(--markerad-aktiv); box-shadow: var(--glod-aktiv); }'
    : '';
}

function rubrikFor(rutaid) {
  const sektion = SEKTIONER.find(s => s.key === sektionsnyckelFor(rutaid));
  if (!sektion) return '';
  const nummer = tillaggsnummer(rutaid);
  return nummer > 0 ? sektion.rubrik + ' – tillägg ' + nummer : sektion.rubrik;
}

function migSom() {
  const profil = Lagring.lasProfil() || { namn: 'Okänd', farg: '#888780' };
  return { namn: profil.namn, farg: profil.farg };
}

function byggInlagg(post) {
  const rad = document.createElement('div');
  rad.className = 'inlagg';

  const huvud = document.createElement('div');
  huvud.className = 'inlagg-huvud';

  const prick = document.createElement('span');
  prick.className = 'inlagg-prick';
  prick.style.background = post.farg;

  const namn = document.createElement('span');
  namn.textContent = post.namn;

  huvud.append(prick, namn);

  const text = document.createElement('p');
  text.className = 'inlagg-text';
  text.textContent = post.text;

  rad.append(huvud, text);
  return rad;
}

function byggNyKommentar() {
  const kort = document.createElement('div');
  kort.className = 'kommentarkort ny';

  const citat = document.createElement('p');
  citat.className = 'citat';
  citat.textContent = pastKommentar.ledtext;

  const sektion = document.createElement('p');
  sektion.className = 'kommentar-sektion';
  sektion.textContent = rubrikFor(pastKommentar.sektion);

  const falt = document.createElement('textarea');
  falt.id = 'nytt-inlagg';
  falt.rows = 3;
  falt.placeholder = 'Din kommentar';
  falt.value = pastKommentar.text;
  falt.addEventListener('input', () => { pastKommentar.text = falt.value; });

  const knappar = document.createElement('div');
  knappar.className = 'kommentar-knappar';

  const avbryt = document.createElement('button');
  avbryt.textContent = 'Avbryt';
  avbryt.addEventListener('click', () => {
    pastKommentar = null;
    ritaKommentarer();
  });

  const skicka = document.createElement('button');
  skicka.className = 'primar';
  skicka.textContent = 'Kommentera';
  skicka.addEventListener('click', () => {
    const text = falt.value.trim();
    if (!text) { falt.focus(); return; }

    const id = nyttTradId();
    const quill = session.redigerare[pastKommentar.sektion];

    quill.formatText(pastKommentar.index, pastKommentar.langd, 'kommentar', id, 'user');
    skapaTrad(session.synk, {
      id,
      sektion: pastKommentar.sektion,
      ledtext: pastKommentar.ledtext,
      forfattare: migSom(),
      text
    });

    pastKommentar = null;
    aktivTrad = id;
    ritaKommentarer();
  });

  knappar.append(avbryt, skicka);
  kort.append(sektion, citat, falt, knappar);
  return kort;
}

function byggTrad(trad) {
  const kort = document.createElement('div');
  kort.className = 'kommentarkort' + (trad.id === aktivTrad ? ' aktiv' : '') + (trad.lost ? ' lost' : '');
  kort.id = 'trad-' + trad.id;

  const sektion = document.createElement('p');
  sektion.className = 'kommentar-sektion';
  sektion.textContent = rubrikFor(trad.sektion);

  const citat = document.createElement('p');
  citat.className = 'citat';
  citat.textContent = trad.ledtext;
  citat.addEventListener('click', () => {
    aktivTrad = trad.id;
    const marke = document.querySelector('[data-trad="' + trad.id + '"]');
    if (marke) marke.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ritaKommentarer();
  });

  kort.append(sektion, citat);
  trad.inlagg.forEach(post => kort.append(byggInlagg(post)));

  const knappar = document.createElement('div');
  knappar.className = 'kommentar-knappar';

  if (trad.lost) {
    const oppna = document.createElement('button');
    oppna.textContent = 'Återöppna';
    oppna.addEventListener('click', () => markeraLost(session.synk, trad.id, false));
    knappar.append(oppna);
    kort.append(knappar);
    return kort;
  }

  const svarsfalt = document.createElement('input');
  svarsfalt.type = 'text';
  svarsfalt.placeholder = 'Svara';
  svarsfalt.value = svarsutkast[trad.id] || '';
  svarsfalt.addEventListener('input', () => { svarsutkast[trad.id] = svarsfalt.value; });

  function skickaSvar() {
    const text = svarsfalt.value.trim();
    if (!text) return;
    laggTillSvar(session.synk, trad.id, migSom(), text);
    delete svarsutkast[trad.id];
  }

  svarsfalt.addEventListener('keydown', e => { if (e.key === 'Enter') skickaSvar(); });

  const svara = document.createElement('button');
  svara.textContent = 'Svara';
  svara.addEventListener('click', skickaSvar);

  const los = document.createElement('button');
  los.textContent = 'Lös';
  los.addEventListener('click', () => {
    const quill = session.redigerare[trad.sektion];
    if (quill) taBortMarkering(quill, trad.id);
    markeraLost(session.synk, trad.id, true);
  });

  knappar.append(svara, los);
  kort.append(svarsfalt, knappar);
  return kort;
}

function ritaKommentarer() {
  const behallare = document.getElementById('kommentarer');
  if (!behallare || !session) return;

  visaAktivMarkering();

  const alla = tradar(session.synk);
  const oppna = alla.filter(t => !t.lost);
  const losta = alla.filter(t => t.lost);

  behallare.innerHTML = '';

  const rubrik = document.createElement('p');
  rubrik.className = 'kommentarrubrik';
  rubrik.textContent = oppna.length ? 'Kommentarer (' + oppna.length + ')' : 'Kommentarer';
  behallare.append(rubrik);

  if (pastKommentar) behallare.append(byggNyKommentar());

  if (!oppna.length && !pastKommentar) {
    const tom = document.createElement('p');
    tom.className = 'kommentar-tom';
    tom.textContent = 'Markera text i dokumentet för att kommentera.';
    behallare.append(tom);
  }

  oppna.forEach(trad => behallare.append(byggTrad(trad)));

  if (losta.length) {
    const vaxla = document.createElement('button');
    vaxla.className = 'visa-losta';
    vaxla.textContent = visaLosta
      ? 'Dölj lösta'
      : losta.length + (losta.length === 1 ? ' löst kommentar' : ' lösta kommentarer');
    vaxla.addEventListener('click', () => { visaLosta = !visaLosta; ritaKommentarer(); });
    behallare.append(vaxla);

    if (visaLosta) losta.forEach(trad => behallare.append(byggTrad(trad)));
  }
}

/* ---------- Vilken vy som visas styrs av adressen ---------- */

function router() {
  const traff = location.hash.match(/^#dok=([\w-]+)$/);
  if (traff) vyDokument(traff[1]);
  else vyStart();
}

console.log('Delat dokument – kodversion ' + KODVERSION);

/* Liten läsbar diagnostik, avsedd att köras i webbläsarens konsol när något
   beter sig konstigt. Skriver ingenting och ändrar ingenting. */
window.delatDokument = {
  version: KODVERSION,
  tillstand() {
    if (!session) return { vy: 'startsidan' };
    return {
      version: KODVERSION,
      dokument: session.id,
      ansluten: session.synk.ansluten,
      jag: Lagring.lasProfil(),
      deltagare: [...session.synk.awareness.getStates()].map(([id, t]) => ({
        klient: id,
        jagSjalv: id === session.synk.doc.clientID,
        namn: t?.user?.fulltNamn || t?.user?.name,
        skriver: t?.user?.skriver ?? null,
        harMarkor: Boolean(t?.cursor)
      })),
      upptagnaRutor: [...session.las].map(([sektion, vem]) => ({
        sektion,
        av: vem.namn,
        skriver: vem.skriver
      }))
    };
  }
};

window.addEventListener('hashchange', router);
router();
