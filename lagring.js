/* Håller reda på VILKA dokument du har öppnat, och vem du är.
   Själva innehållet i ett dokument ligger inte här – det ligger i Yjs, se synk.js. */

const NYCKEL_INDEX = 'dokumentindex';
const NYCKEL_PROFIL = 'profil';

function lasIndex() {
  try {
    return JSON.parse(localStorage.getItem(NYCKEL_INDEX)) || {};
  } catch {
    return {};
  }
}

function skrivIndex(index) {
  localStorage.setItem(NYCKEL_INDEX, JSON.stringify(index));
}

export const Lagring = {
  lista() {
    return Object.values(lasIndex()).sort((a, b) => b.andrad - a.andrad);
  },

  finns(id) {
    return Boolean(lasIndex()[id]);
  },

  /* Långt och slumpat: länken är den enda spärren, och rumsnamnet ligger på
     en delad server. Det ska inte gå att gissa sig till någon annans dokument. */
  nyttId() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  },

  /* Kallas när du öppnar ett dokument och när dess titel eller status ändras. */
  notera(id, uppgifter = {}) {
    const index = lasIndex();
    index[id] = Object.assign({ id, titel: '', status: 'utkast' }, index[id], uppgifter, {
      andrad: Date.now()
    });
    skrivIndex(index);
  },

  glom(id) {
    const index = lasIndex();
    delete index[id];
    skrivIndex(index);
  },

  /* Ägarnyckeln. Den som skapar ett dokument får en hemlig sträng här, och
     dokumentet minns vilken nyckel som är ägarens. Det är en spärr i
     gränssnittet, inte säkerhet – den som läser koden kan gå runt den. */
  sattAgarnyckel(id) {
    const nyckel = crypto.randomUUID();
    localStorage.setItem('agare:' + id, nyckel);
    return nyckel;
  },

  agarnyckel(id) {
    return localStorage.getItem('agare:' + id);
  },

  lasProfil() {
    try {
      return JSON.parse(localStorage.getItem(NYCKEL_PROFIL));
    } catch {
      return null;
    }
  },

  sparaProfil(profil) {
    localStorage.setItem(NYCKEL_PROFIL, JSON.stringify(profil));
  }
};
