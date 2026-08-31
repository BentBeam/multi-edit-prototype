/* Kommentarer: ett eget textformat i Quill plus trådarna som hör till.
   Trådarna ligger i samma Yjs-dokument som texten, så de synkas på köpet. */

import Quill from 'quill';
import * as Y from 'yjs';

const Inline = Quill.import('blots/inline');

/* Markerar text som kommenterad. Värdet är trådens id. */
class KommentarBlot extends Inline {
  static create(tradId) {
    const nod = super.create();
    nod.setAttribute('data-trad', tradId);
    return nod;
  }

  static formats(nod) {
    return nod.getAttribute('data-trad');
  }
}

KommentarBlot.blotName = 'kommentar';
KommentarBlot.tagName = 'span';
KommentarBlot.className = 'kommenterad';

export function registreraFormat() {
  Quill.register(KommentarBlot);
}

/* ---------- Trådarna ---------- */

function trådkarta(synk) {
  return synk.doc.getMap('kommentarer');
}

export function nyttTradId() {
  return 't' + Math.random().toString(36).slice(2, 10);
}

export function skapaTrad(synk, { id, sektion, ledtext, forfattare, text }) {
  const trad = new Y.Map();
  trad.set('sektion', sektion);
  trad.set('ledtext', ledtext);
  trad.set('lost', false);
  trad.set('skapad', Date.now());

  const inlagg = new Y.Array();
  inlagg.push([{ ...forfattare, text, tid: Date.now() }]);
  trad.set('inlagg', inlagg);

  trådkarta(synk).set(id, trad);
}

export function laggTillSvar(synk, id, forfattare, text) {
  const trad = trådkarta(synk).get(id);
  if (!trad) return;
  trad.get('inlagg').push([{ ...forfattare, text, tid: Date.now() }]);
}

export function markeraLost(synk, id, lost) {
  const trad = trådkarta(synk).get(id);
  if (trad) trad.set('lost', lost);
}

export function taBortTrad(synk, id) {
  trådkarta(synk).delete(id);
}

/* Alla trådar, äldst först. */
export function tradar(synk) {
  const ut = [];
  trådkarta(synk).forEach((trad, id) => {
    ut.push({
      id,
      sektion: trad.get('sektion'),
      ledtext: trad.get('ledtext'),
      lost: trad.get('lost'),
      skapad: trad.get('skapad'),
      inlagg: trad.get('inlagg').toArray()
    });
  });
  return ut.sort((a, b) => a.skapad - b.skapad);
}

export function lyssna(synk, fn) {
  trådkarta(synk).observeDeep(fn);
}

/* ---------- Kopplingen till texten ---------- */

/* Var i en sektion en tråds markering sitter. null om markeringen är borta. */
export function hittaMarkering(quill, tradId) {
  let index = 0;
  let start = null;
  let langd = 0;

  quill.getContents().ops.forEach(op => {
    const langdPaOp = typeof op.insert === 'string' ? op.insert.length : 1;
    if (op.attributes && op.attributes.kommentar === tradId) {
      if (start === null) start = index;
      langd += langdPaOp;
    }
    index += langdPaOp;
  });

  return start === null ? null : { index: start, langd };
}

export function taBortMarkering(quill, tradId) {
  const plats = hittaMarkering(quill, tradId);
  if (plats) quill.formatText(plats.index, plats.langd, 'kommentar', false, 'user');
}
