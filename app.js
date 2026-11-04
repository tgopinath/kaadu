import { PLANTS, GROUPS } from './data.js';
import { TA_NAMES } from './data-ta.js';
import { STR, TA_GROUPS, GROUP_BLURB } from './i18n.js';

const INAT = 'https://api.inaturalist.org/v1';
const INDIA = 6681; // iNaturalist place ID for India
const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const icon = (n, cls = 'k-icon') => `<svg class="${cls}" aria-hidden="true"><use href="#${n.includes('-') ? n : 'i-' + n}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const byKey = Object.fromEntries(PLANTS.map(p => [p.key, p]));
const byId = Object.fromEntries(PLANTS.filter(p => p.id).map(p => [p.id, p]));
const groupByKey = Object.fromEntries(GROUPS.map(g => [g.key, g]));

// ---------------------------------------------------------------- language
let lang = store.get('kd.lang', 'en');
const isTa = () => lang === 'ta';
const tr = (k, v = {}) => (STR[lang]?.[k] ?? STR.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const gLabel = g => (isTa() && TA_GROUPS[g.key]) || g.label;
const nm = p => (isTa() && TA_NAMES[p.key]) || p.name;
const langAttr = () => isTa() ? ' lang="ta"' : '';
function syncLang() {
  document.documentElement.lang = isTa() ? 'ta' : 'en';
  const b = $('#langBtn'); b.setAttribute('aria-checked', isTa()); b.setAttribute('aria-label', tr('lang_label'));
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = tr(el.dataset.t); });
  document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = tr(el.dataset.tPh); });
  document.querySelectorAll('[data-t-label]').forEach(el => { el.setAttribute('aria-label', tr(el.dataset.tLabel)); });
}
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

// ---------------------------------------------------------------- data access
const memo = new Map();
function api(path) {
  if (memo.has(path)) return memo.get(path);
  const p = fetch(INAT + path).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  memo.set(path, p); p.catch(() => memo.delete(path));
  return p;
}
const big = u => u?.replace(/\/(square|small|medium|thumb)\./, '/large.');
const med = u => u?.replace(/\/(square|small|thumb|large|original)\./, '/medium.');

// Library photos and ancestry come from iNaturalist in batches of 30, cached on the device for a day.
let lib = store.get('kd.lib.v1', null);
async function loadLibrary() {
  if (lib && Date.now() - lib.t < 864e5) return lib.map;
  const ids = PLANTS.map(p => p.id).filter(Boolean), map = {};
  for (let i = 0; i < ids.length; i += 30) {
    const r = await api(`/taxa/${ids.slice(i, i + 30).join(',')}`);
    for (const t of r.results) map[t.id] = { url: t.default_photo?.medium_url, by: t.default_photo?.attribution, obs: t.observations_count };
  }
  lib = { t: Date.now(), map }; store.set('kd.lib.v1', lib);
  return map;
}
const photoOf = p => lib?.map?.[p?.id]?.url;
const inGroup = (p, g) => g.key === 'all' || p.forms.includes(g.key);

// Tamil names for live species, from Wikidata (P3151 = iNaturalist taxon ID); cached per device.
const taCache = store.get('kd.ta.v1', {});
async function taNames(ids) {
  const want = ids.filter(id => !(id in taCache));
  if (want.length) {
    const q = `SELECT ?id ?label WHERE { VALUES ?id { ${want.map(id => `"${+id}"`).join(' ')} } ?item wdt:P3151 ?id . ?item rdfs:label ?label FILTER(lang(?label) = "ta") }`;
    try {
      const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q)).then(r => r.json());
      want.forEach(id => { taCache[id] = null; });
      for (const x of r.results.bindings) taCache[x.id.value] = x.label.value;
      store.set('kd.ta.v1', taCache);
    } catch {} // offline or busy: English this time
  }
  return Object.fromEntries(ids.filter(id => taCache[id]).map(id => [id, taCache[id]]));
}
function sentences(html, n = 3) {
  const d = document.createElement('div'); d.innerHTML = html || '';
  const text = d.textContent.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return (text.match(/[^.!?।]+[.!?।]+/g) || [text]).slice(0, n).join(' ').trim();
}
async function wikiSummary(title, host = 'en') {
  try {
    const r = await fetch(`https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.type === 'disambiguation' || !j.extract ? null : { text: sentences(j.extract_html || j.extract, 3), url: j.content_urls?.desktop?.page };
  } catch { return null; }
}
async function tamilWiki(enTitle) {
  try {
    const ll = await fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ action: 'query', prop: 'langlinks', lllang: 'ta', titles: enTitle, redirects: 1, format: 'json', origin: '*' })).then(r => r.json());
    const ta = Object.values(ll.query?.pages || {})[0]?.langlinks?.[0]?.['*'];
    return ta ? { ...(await wikiSummary(ta, 'ta')), title: ta } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- saved
const saved = () => store.get('kd.saved', []);
const isSaved = h => saved().some(s => s.h === h);
function toggleSave(item) {
  const l = saved(), i = l.findIndex(s => s.h === item.h);
  if (i >= 0) l.splice(i, 1); else l.unshift(item);
  store.set('kd.saved', l); return i < 0;
}

// ---------------------------------------------------------------- cards
const img = (url, alt, lazy = true) => url ? `<img src="${url}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ''} decoding="async" onload="this.classList.add('loaded')" onerror="this.remove()">` : '';
const FORM_KEYS = ['tree', 'shrub', 'vine', 'herb', 'grass', 'fern', 'succulent', 'aquatic', 'moss', 'palm', 'conifer'];
const formBadges = forms => `<div class="card-forms" aria-hidden="true">${forms.filter(f => FORM_KEYS.includes(f)).slice(0, 2).map(f => `<span>${icon('f-' + f)}</span>`).join('')}</div>`;
function plantCard(p) {
  return `<a class="card" href="#/p/${p.key}" data-n="${esc(nm(p))}">
    <div class="card-img">${img(photoOf(p), nm(p))}${formBadges(p.forms)}</div>
    <div class="card-meta"><h3 class="card-name"${langAttr()}>${esc(nm(p))}</h3><div class="card-sub">${esc(p.sci)}</div></div></a>`;
}
// Growth forms a live species belongs to, by its ancestry.
const formsOfAnc = anc => GROUPS.filter(g => !['all', 'flower'].includes(g.key) && g.ids.some(id => anc?.includes(id))).map(g => g.key);
function taxonCard(t, ta) {
  if (byId[t.id]) return plantCard(byId[t.id]);
  const en = cap(t.preferred_common_name || t.name), name = (isTa() && ta) || en;
  return `<a class="card" href="#/t/${t.id}" data-n="${esc(name)}">
    <div class="card-img">${img(t.default_photo?.medium_url, name)}${formBadges(formsOfAnc(t.ancestor_ids))}</div>
    <div class="card-meta"><h3 class="card-name"${isTa() && ta ? ' lang="ta"' : ''}>${esc(name)}</h3><div class="card-sub">${esc(t.name)}</div></div></a>`;
}
const skeleton = n => `<div class="grid" aria-hidden="true">${Array.from({ length: n }, () => '<div class="card"><div class="card-img skeleton"></div><div class="skeleton sk-line"></div></div>').join('')}</div>`;

// Group chips carry plant photos, so the type reads at a glance.
const chipPics = g => `<span class="pics">${g.pic.map(k => { const u = photoOf(byKey[k]); return u ? `<img src="${u.replace('/medium.', '/square.')}" alt="">` : '<span class="ph"></span>'; }).join('')}</span>`;
const chips = cur => `<nav class="chips" aria-label="${tr('groups_label')}">${GROUPS.map(g => `<a class="chip" href="${g.key === 'all' ? '#/' : '#/g/' + g.key}" aria-current="${g.key === cur}">${chipPics(g)}<span${langAttr()}>${esc(gLabel(g))}</span></a>`).join('')}</nav>`;

// ---------------------------------------------------------------- infinite list (no "Load more")
let io = null;
let scope = store.get('kd.scope', 'india');
function infinite(listEl, moreEl, { ids, skip }) {
  let page = 1, grid = null, busy = false, end = false;
  const q = `taxon_id=${ids.join(',')}&quality_grade=research&per_page=30&photos=true${scope === 'india' ? `&place_id=${INDIA}` : ''}`;
  async function load() {
    if (busy || end || !moreEl.isConnected) return;
    busy = true;
    if (grid) moreEl.innerHTML = `<div class="spinner" role="status" aria-label="${tr('loading_more')}"></div>`;
    try {
      const r = await api(`/observations/species_counts?${q}&page=${page}`);
      if (!moreEl.isConnected) return;
      if (!grid) { listEl.innerHTML = '<div class="grid"></div>'; grid = listEl.firstChild; }
      const items = r.results.map(x => x.taxon).filter(t => t.default_photo && !skip.has(t.id));
      const ta = isTa() ? await taNames(items.map(t => t.id)) : {};
      if (!moreEl.isConnected) return;
      grid.insertAdjacentHTML('beforeend', items.map(t => taxonCard(t, ta[t.id])).join(''));
      end = r.results.length < 30; page++;
      moreEl.innerHTML = end ? `<p>${tr('seen_all')}</p>` : '';
      busy = false;
      if (!end && moreEl.getBoundingClientRect().top < innerHeight + 600) load();
    } catch {
      busy = false;
      if (!moreEl.isConnected) return;
      const retry = `<button class="k-btn k-btn-outline" type="button">${tr('try_again')}</button>`;
      if (grid) { moreEl.innerHTML = retry; moreEl.firstChild.onclick = load; }
      else { listEl.innerHTML = `<div class="empty"><b>${tr('no_connect')}</b>${tr('check_net')}<div style="margin-top:16px">${retry}</div></div>`; listEl.querySelector('button').onclick = () => { listEl.innerHTML = skeleton(8); load(); }; }
    }
  }
  io?.disconnect();
  io = new IntersectionObserver(es => { if (es[0].isIntersecting && !moreEl.querySelector('button')) load(); }, { rootMargin: '800px 0px' });
  io.observe(moreEl);
  load();
}

// ---------------------------------------------------------------- views
const SUGGEST = ['Neem', 'Lotus', 'Ficus', 'Orchid', 'Bamboo', 'Moss'];
const SUGGEST_TA = ['வேம்பு', 'தாமரை', 'மல்லிகை', 'மூங்கில்'];
function plantOfDay() { const d = Math.floor(Date.now() / 864e5); return PLANTS[d % PLANTS.length]; }

async function viewHome(gk = 'all') {
  const g = groupByKey[gk] || GROUPS[0];
  if (!lib) { app.innerHTML = skeleton(8); await loadLibrary().catch(() => {}); }
  if (route.current !== location.hash) return;
  const list = PLANTS.filter(p => inGroup(p, g)).sort((a, b) => nm(a).localeCompare(nm(b), isTa() ? 'ta' : 'en'));
  const f = plantOfDay();
  const head = g.key === 'all' ? `
    <section class="feature" aria-labelledby="ftitle">
      <a class="feature-img" href="#/p/${f.key}" tabindex="-1" aria-hidden="true">${img(big(photoOf(f)), '', false)}</a>
      <div class="feature-body">
        <span class="eyebrow">${tr('featured')}</span>
        <h1 class="h-display" id="ftitle"${langAttr()}>${esc(nm(f))}</h1>
        <div class="sci">${esc(f.sci)}</div>
        <p>${esc(f.about)}</p>
        <div><a class="k-btn k-btn-primary" href="#/p/${f.key}"${langAttr()}>${esc(tr('open_plant', { name: nm(f) }))} ${icon('arrow')}</a></div>
      </div>
    </section>
    <div class="suggest"><span class="lbl">${tr('suggest')}</span>${(isTa() ? SUGGEST_TA : SUGGEST).map(s => `<a href="#/search/${encodeURIComponent(s)}">${esc(s)}</a>`).join('')}</div>
    <div class="section-head"><div><span class="eyebrow">${tr('library')}</span><h2 class="h-section">${tr('lib_title')}</h2><p class="note">${tr('lib_note')}</p></div></div>`
    : `<div class="page-head"><span class="eyebrow">${tr('group')}</span><h1 class="h-display"${langAttr()}>${esc(gLabel(g))}</h1><p class="lede"${langAttr()}>${esc(GROUP_BLURB[lang][g.key])}</p></div>`;
  app.innerHTML = `${head}
    ${chips(g.key)}
    ${list.length ? `<div class="grid" id="libGrid">${list.map(plantCard).join('')}</div>` : ''}
    <div class="section-head">
      <div><span class="eyebrow">${tr('every_species')}</span><h2 class="h-section"${langAttr()}>${g.key === 'all' ? tr('all_live_all') : esc(tr('all_live', { group: isTa() ? gLabel(g) : g.label.toLowerCase() }))}</h2>
      ${g.proxy ? `<p class="note"${langAttr()}>${esc(tr('proxy_note', { group: gLabel(g), group_l: isTa() ? gLabel(g) : g.label.toLowerCase() }))}</p>` : ''}</div>
      <div class="seg" role="group" aria-label="${tr('scope_label')}">
        <button type="button" data-scope="india" aria-pressed="${scope === 'india'}">${tr('scope_india')}</button>
        <button type="button" data-scope="world" aria-pressed="${scope === 'world'}">${tr('scope_world')}</button>
      </div>
    </div>
    <div id="list">${skeleton(8)}</div>
    <div class="more" id="more" aria-live="polite"></div>
    ${footer()}`;
  app.querySelectorAll('[data-scope]').forEach(b => b.onclick = () => {
    if (scope === b.dataset.scope) return;
    scope = b.dataset.scope; store.set('kd.scope', scope);
    app.querySelectorAll('[data-scope]').forEach(x => x.setAttribute('aria-pressed', x.dataset.scope === scope));
    $('#list').innerHTML = skeleton(8); $('#more').innerHTML = '';
    infinite($('#list'), $('#more'), { ids: g.ids, skip: new Set(list.map(p => p.id)) });
  });
  const cur = $('.chip[aria-current="true"]'), row = $('.chips');
  if (cur && row) row.scrollLeft = cur.offsetLeft - row.offsetLeft - (row.clientWidth - cur.offsetWidth) / 2;
  infinite($('#list'), $('#more'), { ids: g.ids, skip: new Set(list.map(p => p.id)) });
}
const footer = () => `<footer class="foot"><b>${tr('about_app')}.</b> ${esc(tr('about_body'))} <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a> · <a href="https://www.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a> · <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a></footer>`;

async function viewTypes() {
  if (!lib) await loadLibrary().catch(() => {});
  if (route.current !== location.hash) return;
  app.innerHTML = `<div class="page-head"><h1 class="h-display">${tr('groups_title')}</h1><p class="lede">${tr('groups_lede')}</p></div>
    <div class="types">${GROUPS.filter(g => g.key !== 'all').map(g => {
      const n = PLANTS.filter(p => inGroup(p, g)).length, p = byKey[g.pic[0]];
      return `<a class="type" href="#/g/${g.key}"><div class="type-img">${img(photoOf(p), '')}</div>
        <div><h2${langAttr()}>${icon('f-' + g.key)}${esc(gLabel(g))}</h2><p${langAttr()}>${esc(GROUP_BLURB[lang][g.key])}</p><div class="count">${tr('n_lib', { n })}</div></div></a>`;
    }).join('')}</div>${footer()}`;
}

async function viewSearch(q) {
  q = q.trim(); const input = $('#searchInput'); if (input.value !== q) input.value = q;
  if (!lib) await loadLibrary().catch(() => {});
  const ql = q.toLowerCase();
  const local = PLANTS.filter(p => [p.name, p.sci, p.fam, p.key].some(s => s.toLowerCase().includes(ql)) || TA_NAMES[p.key]?.includes(q) ||
    GROUPS.some(g => p.forms.includes(g.key) && (g.label.toLowerCase().includes(ql) || TA_GROUPS[g.key]?.includes(q))));
  app.innerHTML = `<div class="page-head"><span class="eyebrow" id="sub" aria-live="polite">${tr('searching')}</span><h1 class="h-display">“${esc(q)}”</h1></div>
    ${local.length ? `<div class="section-head" style="margin-top:0"><h2 class="h-section">${tr('in_library')}</h2></div><div class="grid">${local.map(plantCard).join('')}</div>
      <div class="section-head"><h2 class="h-section">${tr('more_matches')}</h2></div>` : ''}
    <div id="remote">${skeleton(4)}</div>`;
  try {
    const r = await api(`/taxa/autocomplete?q=${encodeURIComponent(q)}&taxon_id=47126&per_page=30&is_active=true${isTa() ? '&locale=ta' : ''}`);
    if ($('#searchInput').value.trim() !== q || !$('#remote')) return;
    const seen = new Set(local.map(p => p.id));
    const res = r.results.filter(t => t.default_photo && !seen.has(t.id));
    const ta = isTa() ? await taNames(res.map(t => t.id)) : {};
    if (!$('#remote')) return;
    $('#remote').innerHTML = res.length ? `<div class="grid">${res.map(t => taxonCard(t, ta[t.id])).join('')}</div>`
      : local.length ? '' : `<div class="empty"><b>${tr('no_matches')}</b>${tr('no_matches_hint')}</div>`;
    $('#sub').textContent = tr('results', { n: local.length + res.length });
  } catch {
    if (!$('#remote')) return;
    $('#remote').innerHTML = local.length ? '' : `<div class="empty"><b>${tr('offline')}</b>${tr('offline_hint')}</div>`;
    $('#sub').textContent = tr('results', { n: local.length });
  }
}

function viewSaved() {
  const l = saved();
  app.innerHTML = `<div class="page-head"><h1 class="h-display">${tr('saved_title')}</h1></div>
    ${l.length ? `<div class="grid">${l.map(s => `<a class="card" href="${s.h}" data-n="${esc(s.n)}"><div class="card-img">${img(s.img, s.n)}</div><div class="card-meta"><h3 class="card-name">${esc(s.n)}</h3><div class="card-sub">${esc(s.sci)}</div></div></a>`).join('')}</div>`
      : `<div class="empty"><b>${tr('saved_empty')}</b>${tr('saved_hint')}</div>`}`;
}

// The list a card was opened from, so a plant page can step to the previous / next plant (swipe, arrows).
let navList = (() => { try { return JSON.parse(sessionStorage.getItem('kd.nav') || '[]'); } catch { return []; } })();
document.addEventListener('click', e => {
  const a = e.target.closest('a.card'); if (!a) return;
  const items = [...app.querySelectorAll('a.card')].map(c => ({ h: c.getAttribute('href'), n: c.dataset.n }));
  navList = items.filter((x, i) => items.findIndex(y => y.h === x.h) === i);
  try { sessionStorage.setItem('kd.nav', JSON.stringify(navList)); } catch {}
}, true);
function neighbours(h) {
  let l = navList;
  if (!l.some(x => x.h === h)) l = PLANTS.map(p => ({ h: `#/p/${p.key}`, n: nm(p) }));
  const i = l.findIndex(x => x.h === h);
  return i < 0 ? {} : { prev: l[i - 1], next: l[i + 1] };
}
let lastList = '#/';
function detailBar(h) {
  const { prev, next } = neighbours(h);
  const pn = (x, dir) => x ? `<a href="${x.h}" data-pn="${dir}" aria-label="${esc(tr(dir) + ': ' + x.n)}" title="${esc(x.n)}">${icon(dir === 'prev' ? 'back' : 'next')}</a>` : `<span aria-hidden="true">${icon(dir === 'prev' ? 'back' : 'next')}</span>`;
  return `<div class="dbar"><a class="crumb" href="${lastList}" data-back>${icon('back')} ${tr('back')}</a><div class="pn">${pn(prev, 'prev')}${pn(next, 'next')}</div></div>`;
}

const fact = (ic, k, v, wide) => v ? `<div class="fact${wide ? ' wide' : ''}"><span class="ic">${icon(ic)}</span><dl style="margin:0"><dt>${tr(k)}</dt><dd>${esc(v)}</dd></dl></div>` : '';
async function viewDetail({ plant: p, id }) {
  const h = p ? `#/p/${p.key}` : `#/t/${id}`;
  id = p?.id ?? id;
  app.innerHTML = `${detailBar(h)}<div class="detail"><div class="gallery"><div class="slides skeleton"></div></div><div>${p ? `<h1 class="h-display"${langAttr()}>${esc(nm(p))}</h1>` : '<div class="skeleton" style="height:48px;border-radius:12px;width:70%"></div>'}</div></div>`;
  let t = null;
  if (id) try { t = (await api(`/taxa/${id}${isTa() ? '?locale=ta' : ''}`)).results[0]; } catch {}
  if (location.hash !== h) return;
  if (!t && !p) { app.innerHTML = `${detailBar(h)}<div class="empty"><b>${tr('no_load')}</b>${tr('check_net')}</div>`; return; }

  const en = p?.name || cap(t?.english_common_name || t?.preferred_common_name || t?.name);
  const ta = p ? TA_NAMES[p.key] : (await taNames([id]))[id];
  const name = (isTa() && ta) || en;
  const sci = p?.sci || t?.name;
  const forms = p ? p.forms : formsOfAnc(t?.ancestor_ids);
  const fam = p?.fam || t?.ancestors?.find(a => a.rank === 'family')?.name;
  const pics = (t?.taxon_photos || []).slice(0, 8).map(x => ({ url: big(x.photo.medium_url || x.photo.url), by: x.photo.attribution }));
  if (!pics.length && photoOf(p)) pics.push({ url: big(photoOf(p)), by: lib.map[p.id].by });
  const wikiTitle = t?.wikipedia_url ? decodeURIComponent(t.wikipedia_url.split('/wiki/')[1] || '') : sci;
  const formLinks = forms.map(f => `<a href="#/g/${f}"${langAttr()}>${icon('f-' + f)}${esc(gLabel(groupByKey[f]))}</a>`).join('');
  const sv = isSaved(h);

  app.innerHTML = `${detailBar(h)}
    <article class="detail">
      <div class="gallery">
        <div class="slides" id="slides" tabindex="0" aria-label="${esc(name)}">${pics.map((x, i) => `<figure class="slide"><img src="${x.url}" alt="${esc(tr('photo_n', { i: i + 1, n: pics.length }) + ': ' + name)}"${i ? ' loading="lazy"' : ''}><figcaption>${esc(x.by || '')}</figcaption></figure>`).join('')}</div>
        ${pics.length > 1 ? `<div class="dots" role="group">${pics.map((_, i) => `<button type="button" aria-label="${esc(tr('photo_n', { i: i + 1, n: pics.length }))}" aria-current="${i === 0}" data-i="${i}"></button>`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="title-row">
          <div><h1 class="h-display"${isTa() && ta ? ' lang="ta"' : ''}>${esc(name)}</h1>
          <p class="alt-names">${isTa() && ta ? esc(en) + ' · ' : (!isTa() && ta ? `<span lang="ta">${esc(ta)}</span> · ` : '')}<span class="sci">${esc(sci)}</span></p></div>
          <button class="k-btn k-btn-outline k-btn-sm save" id="saveBtn" type="button" aria-pressed="${sv}">${icon(sv ? 'bookmark-on' : 'bookmark')}<span>${tr(sv ? 'saved' : 'save')}</span></button>
        </div>
        ${formLinks ? `<div class="forms" aria-label="${tr('f_form')}">${formLinks}</div>` : ''}
        <div class="facts">
          ${fact('family', 'f_family', fam)}
          ${fact('ruler', 'f_height', p?.h)}
          ${fact('pin', 'f_habitat', p?.hab)}
          ${fact('globe', 'f_native', p?.nat)}
          ${fact('hand', 'f_uses', p?.uses, true)}
          ${t?.observations_count ? `<div class="fact wide"><span class="ic">${icon('eye')}</span><dl style="margin:0"><dt>iNaturalist</dt><dd>${tr('observations', { n: t.observations_count.toLocaleString(isTa() ? 'ta-IN' : 'en-IN') })}</dd></dl></div>` : ''}
        </div>
        <section class="prose" aria-labelledby="abt">
          <h2 id="abt">${tr('about')}</h2>
          ${p && !isTa() ? `<p>${esc(p.about)}</p>` : ''}
          <div id="wiki">${p && !isTa() ? '' : '<div class="skeleton sk-line" style="width:90%"></div><div class="skeleton sk-line"></div>'}</div>
        </section>
        <details class="sources" id="sources"><summary>${icon('book')}${tr('sources')}${icon('chev')}</summary><ol id="srcList"></ol></details>
      </div>
    </article>`;

  // Gallery dots follow the scroll position.
  const slides = $('#slides'), dots = app.querySelectorAll('.dots button');
  dots.forEach(d => d.onclick = () => slides.scrollTo({ left: slides.clientWidth * +d.dataset.i, behavior: 'smooth' }));
  slides?.addEventListener('scroll', () => { const i = Math.round(slides.scrollLeft / slides.clientWidth); dots.forEach((d, j) => d.setAttribute('aria-current', i === j)); }, { passive: true });
  $('#saveBtn').onclick = () => {
    const on = toggleSave({ h, n: name, sci, img: pics[0]?.url ? med(pics[0].url) : '' });
    const b = $('#saveBtn'); b.setAttribute('aria-pressed', on); b.innerHTML = `${icon(on ? 'bookmark-on' : 'bookmark')}<span>${tr(on ? 'saved' : 'save')}</span>`;
    toast(tr(on ? 'saved_toast' : 'unsaved_toast'));
  };

  // Wikipedia: English summary, or Tamil Wikipedia's when Tamil is on (falls back to English).
  const src = [];
  if (t) src.push(`${tr('src_inat')}: <a href="https://www.inaturalist.org/taxa/${t.id}" target="_blank" rel="noopener">iNaturalist · ${esc(t.name)}</a>`);
  if (p) src.push(`${tr('about')}: Kaadu library (hand-written)`);
  if (ta && !p) src.push(`${tr('src_wd')}: <a href="https://www.wikidata.org/w/index.php?search=haswbstatement%3AP3151%3D${id}" target="_blank" rel="noopener">Wikidata</a>`);
  let w = null, wTa = false;
  if (isTa()) { w = await tamilWiki(wikiTitle); wTa = !!w?.text; if (!wTa) w = null; }
  if (!w) w = await wikiSummary(wikiTitle);
  if (location.hash !== h) return;
  const wikiEl = $('#wiki');
  if (w?.text) {
    wikiEl.innerHTML = `<div class="from">${icon('book')}${tr(wTa ? 'wiki_ta' : 'from_wiki')}</div><p class="wiki"${wTa ? ' lang="ta"' : ''}>${esc(w.text)}</p>
      ${w.url ? `<a class="ext" href="${w.url}" target="_blank" rel="noopener">${tr('read_more')}${icon('external')}</a>` : ''}`;
    src.push(`${tr('src_wiki')}: <a href="${w.url}" target="_blank" rel="noopener">${wTa ? 'Tamil ' : ''}Wikipedia</a>`);
  } else wikiEl.innerHTML = p && isTa() ? `<p>${esc(p.about)}</p>` : '';
  $('#srcList').innerHTML = src.map(s => `<li><span>${s}</span></li>`).join('');
  document.title = `${name} · Kaadu`;

  if (!store.get('kd.swipeHint', false) && matchMedia('(pointer: coarse)').matches) { store.set('kd.swipeHint', true); setTimeout(() => toast(tr('swipe_hint')), 900); }
}

// ---------------------------------------------------------------- swipe and keys for previous / next
let sx = 0, sy = 0, st = 0;
app.addEventListener('touchstart', e => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; st = Date.now(); }, { passive: true });
app.addEventListener('touchend', e => {
  if (!/^#\/(p|t)\//.test(location.hash) || e.target.closest?.('.slides, .chips')) return;
  const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
  if (sx < 24 || Date.now() - st > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * .6) return;
  step(dx < 0 ? 'next' : 'prev', dx);
}, { passive: true });
document.addEventListener('keydown', e => {
  if (!/^#\/(p|t)\//.test(location.hash) || e.target.closest?.('input, textarea, .slides') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight') step('next', -1); else if (e.key === 'ArrowLeft') step('prev', 1);
});
function step(dir, dx) {
  const a = $(`[data-pn=${dir}]`); if (!a) return;
  let done = false;
  const go = () => { if (done) return; done = true; location.replace(a.getAttribute('href')); };
  // The page slides out the way the finger went; a timer makes sure it moves on even if animations are paused.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) app.animate?.([{ transform: 'none', opacity: 1 }, { transform: `translateX(${dx < 0 ? -48 : 48}px)`, opacity: 0 }], { duration: 160, easing: 'ease-in' });
  setTimeout(go, 170);
}

// ---------------------------------------------------------------- routing
function setTab(tab) { document.querySelectorAll('[data-tab]').forEach(a => a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')); }
function route({ keep = false } = {}) {
  route.current = location.hash || '';
  io?.disconnect(); io = null;
  let h = location.hash.slice(1) || '/';
  try { h = decodeURIComponent(h); } catch {}
  const [, a, b] = h.split('/');
  if (!keep) window.scrollTo(0, 0);
  const input = $('#searchInput');
  if (a !== 'search' && input.value && document.activeElement !== input) input.value = '';
  if (!['p', 't'].includes(a)) { lastList = location.hash || '#/'; document.title = 'Kaadu · every kind of plant'; }
  if (!a) { setTab('home'); return viewHome(); }
  if (a === 'g' && groupByKey[b]) { setTab('home'); return viewHome(b); }
  if (a === 'types') { setTab('types'); return viewTypes(); }
  if (a === 'saved') { setTab('saved'); return viewSaved(); }
  if (a === 'search' && b) { setTab(''); return viewSearch(h.slice(8)); }
  if (a === 'p' && byKey[b]) { setTab(''); return viewDetail({ plant: byKey[b] }); }
  if (a === 't' && +b) { setTab(''); return byId[+b] ? location.replace(`#/p/${byId[+b].key}`) : viewDetail({ id: +b }); }
  location.replace('#/');
}
let moved = false;
addEventListener('hashchange', () => { moved = true; route(); });
document.addEventListener('click', e => { const a = e.target.closest('[data-back]'); if (a && moved && history.length > 1) { e.preventDefault(); history.back(); } });
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); const q = $('#searchInput').value.trim(); if (q) { location.hash = '#/search/' + encodeURIComponent(q); $('#searchInput').blur(); } });
let typing;
$('#searchInput').addEventListener('input', e => { clearTimeout(typing); const q = e.target.value.trim(); if (q.length >= 3) typing = setTimeout(() => { location.replace('#/search/' + encodeURIComponent(q)); }, 450); });
$('#langBtn').onclick = () => { lang = isTa() ? 'en' : 'ta'; store.set('kd.lang', lang); syncLang(); toast(tr('lang_toast')); route({ keep: true }); };
const setTop = () => document.documentElement.style.setProperty('--top-h', `${$('.top').offsetHeight}px`);
setTop(); addEventListener('resize', setTop);
syncLang();
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {});
