const DATA = window.DATA || [];

/* ============================================================
   ЧАСТЬ 2/2 — Логика приложения
   Здесь уже начинается JS. Ниже — все функции и инициализация.
   ============================================================ */

const FLAT = [];
const FLAT_INDEX = {};
DATA.forEach(lv => lv.lessons.forEach((ls,i) => {
  const item = {id: lv.id+':'+i, levelId: lv.id, li:i};
  FLAT_INDEX[item.id] = FLAT.length;
  FLAT.push(item);
}));
const LS_KEY = 'kkz_learn_v6';
let store = { xp:0, done:{}, streak:0, last:null, interleaving:true, darkMode:false, weakWords:{} };
try { const raw = localStorage.getItem(LS_KEY); if (raw) store = Object.assign(store, JSON.parse(raw)); } catch(e){}
if (store.interleaving === undefined) store.interleaving = true;
if (store.darkMode === undefined) store.darkMode = false;
if (!store.weakWords) store.weakWords = {};
if (store.darkMode) document.body.classList.add('dark');
function save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(store)); }catch(e){} }

let session = null, lastResult = null, currentView = 'home', menuOpen = false;
let wordsSearch = '', wordsSort = 'lesson';
let translateFromLang = 'kz', translateInput = '';
const app = document.getElementById('app');

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

async function speak(text) {
  if (!text) return;
  
  try {
    // Динамически загружаем библиотеку Edge TTS
    const { Communicate } = await import('https://esm.sh/@twn39/edgetts-js');
    
    // Используем казахский нейроголос Aigul (женский)
    const communicate = new Communicate(text, { 
      voice: 'kk-KZ-AigulNeural',
      rate: '+0%',
      pitch: '+0Hz'
    });
    
    const chunks = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === 'audio') {
        chunks.push(chunk.data);
      }
    }
    
    if (chunks.length === 0) throw new Error('No audio');
    
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    
    // Очищаем память после проигрывания
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    
    await audio.play();
  } catch (e) {
    console.warn('Edge TTS failed, fallback to system voice', e);
    fallbackSpeak(text);
  }
}

// Резервный вариант (если Edge TTS заблокирован)
function fallbackSpeak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const vs = window.speechSynthesis.getVoices() || [];
    const v = vs.find(x => x.lang.toLowerCase().includes('kk'))
           || vs.find(x => x.lang.toLowerCase().startsWith('ru'));
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'kk-KZ'; }
    u.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch(e) {}
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => {};

const KK_ALPHABET = 'аәбвгғдеёжзийкқлмнңоөпрстуұүфхһцчшщъыіьэюя';
function kkCompare(a, b){
  a = a.toLowerCase(); b = b.toLowerCase();
  const n = Math.min(a.length, b.length);
  for (let i=0; i<n; i++){
    const ca = a[i], cb = b[i];
    if (ca === cb) continue;
    const ia = KK_ALPHABET.indexOf(ca);
    const ib = KK_ALPHABET.indexOf(cb);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia === -1 && ib !== -1) return 1;
    if (ia !== -1 && ib === -1) return -1;
    return ca < cb ? -1 : 1;
  }
  return a.length - b.length;
}

function parseEmojis(el){
  if (!window.twemoji || typeof twemoji.parse !== 'function') return;
  try {
    twemoji.parse(el, { className:'emoji-img', ext:'.svg', folder:'svg',
      base:'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/' });
    el.querySelectorAll('img.emoji-img').forEach(img => {
      img.onerror = function(){
        const alt = this.alt || '';
        if (alt){ const span = document.createElement('span'); span.textContent = alt; this.replaceWith(span); }
        else this.remove();
      };
    });
  } catch(e){}
}
function setEl(el, html){ el.innerHTML = html; parseEmojis(el); }
function setApp(html){ setEl(app, html); }

function showConfirm(opts){
  const old = document.querySelector('.confirm-overlay'); if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box" role="dialog" aria-modal="true">
      <div class="confirm-title">${esc(opts.title || 'Подтверждение')}</div>
      <div class="confirm-message">${esc(opts.message || '')}</div>
      <div class="confirm-actions">
        <button type="button" class="btn secondary" id="confirmNo">${esc(opts.noText || 'Отмена')}</button>
        <button type="button" class="btn ${opts.danger ? 'danger' : 'primary'}" id="confirmYes">${esc(opts.yesText || 'OK')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#confirmYes').onclick = () => { close(); if (opts.onYes) opts.onYes(); };
  overlay.querySelector('#confirmNo').onclick  = () => { close(); if (opts.onNo) opts.onNo(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

function getWeakWordsList(){
  const weak = store.weakWords || {};
  const allWords = getAllWords();
  return Object.entries(weak)
    .filter(([k,v]) => v > 0)
    .sort((a,b) => b[1] - a[1])
    .map(([k,v]) => {
      const found = allWords.find(w => w.kz === k);
      return found ? { word: found, score: v } : null;
    })
    .filter(Boolean);
}
let _allWordsCache = null;
function getAllWords(){
  if (_allWordsCache) return _allWordsCache;
  const seen = new Set(), list = [];
  DATA.forEach(lv => lv.lessons.forEach(ls => {
    if (ls.words) ls.words.forEach(w => {
      if (!seen.has(w.kz)) { seen.add(w.kz); list.push({kz:w.kz, ru:w.ru, emoji:w.emoji}); }
    });
  }));
  _allWordsCache = list;
  return list;
}
function getLearnedWords(){
  const seen = new Set(), list = [];
  DATA.forEach(lv => lv.lessons.forEach((ls,i) => {
    if (store.done[lv.id + ':' + i] && ls.words){
      ls.words.forEach(w => { if (!seen.has(w.kz)){ seen.add(w.kz); list.push({kz:w.kz, ru:w.ru, emoji:w.emoji}); } });
    }
  }));
  return list;
}
function getOldWords(currentId){
  const seen = new Set(), words = [];
  DATA.forEach(lv => lv.lessons.forEach((ls,i) => {
    const id = lv.id + ':' + i;
    if (id === currentId) return;
    if (store.done[id] && ls.words){
      ls.words.forEach(w => { if (!seen.has(w.kz)){ seen.add(w.kz); words.push(w); } });
    }
  }));
  return words;
}
function getProgress(){
  const total = FLAT.length;
  const done = Object.keys(store.done).filter(k => store.done[k]).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  return { total, done, pct };
}

function grammarHint(ex){
  if (!ex || !ex.prompt || !ex.answer) return '';
  const caseMatch = ex.prompt.match(/«([^»]+)»\s*\+\s*(.+)/);
  if (caseMatch) {
    const word = caseMatch[1];
    const answerLower = ex.answer.toLowerCase();
    const wordLower = word.toLowerCase();
    if (answerLower.startsWith(wordLower)) {
      const ending = ex.answer.slice(word.length);
      if (ending) {
        const lastChar = wordLower.slice(-1);
        return `Слово «${word}» оканчивается на «${lastChar}» — по правилу сингармонизма добавляется окончание «${ending}».`;
      }
    }
  }
  const verbMatch = ex.prompt.match(/(Мен|Сен|Ол|Біз|Сендер|Олар)\s+\(([^)]+)\)/);
  if (verbMatch) {
    const person = verbMatch[1];
    const endings = {
      'Мен': '-мын / -мін (я)',
      'Сен': '-сың / -сің (ты)',
      'Ол': '-ды / -ді (он/она)',
      'Біз': '-мыз / -міз (мы)',
      'Сендер': '-сыңдар / -сіңдер (вы)',
      'Олар': '-ды / -ді (они)'
    };
    return `Для «${person}» нужно личное окончание ${endings[person] || '—'}.`;
  }
  return '';
}

function heartsDisplay(n){
  const total = 5;
  let s = '';
  for (let i=0; i<total; i++) s += (i < n) ? '❤️' : '🖤';
  return s;
}

function topMenuHTML(active){
  const icon = menuOpen ? '▲' : '▼';
  return `
    <div class="topbar">
      <button type="button" class="menu-btn" id="menuBtn">☰ Мәзір ${icon}</button>
      <div class="pills">
        <div class="pill">🔥 ${store.streak}</div>
        <div class="pill blue">⚡ ${store.xp} XP</div>
      </div>
    </div>
    ${menuOpen ? `<div class="menu-dd">
      <button type="button" class="menu-tab ${active==='home'?'active':''}" data-view="home">🏠 Главное</button>
      <button type="button" class="menu-tab ${active==='words'?'active':''}" data-view="words">📖 Список слов</button>
      <button type="button" class="menu-tab ${active==='review'?'active':''}" data-view="review">🔁 Повторение</button>
      <button type="button" class="menu-tab ${active==='translate'?'active':''}" data-view="translate">🔄 Переводчик</button>
      <button type="button" class="menu-tab ${active==='settings'?'active':''}" data-view="settings">⚙️ Настройки</button>
    </div>` : ''}`;
}
function bindMenu(){
  const mb = document.getElementById('menuBtn');
  if (mb) mb.onclick = () => {
    menuOpen = !menuOpen;
    if (currentView === 'words') renderWords();
    else if (currentView === 'review') renderReview();
    else if (currentView === 'translate') renderTranslate();
    else if (currentView === 'settings') renderSettings();
    else renderHome();
  };
  document.querySelectorAll('.menu-tab[data-view]').forEach(t => {
    t.onclick = () => {
      currentView = t.dataset.view; menuOpen = false;
      if (currentView === 'words') renderWords();
      else if (currentView === 'review') renderReview();
      else if (currentView === 'translate') renderTranslate();
      else if (currentView === 'settings') renderSettings();
      else renderHome();
    };
  });
}

function renderWords(){
  session = null;
  setApp(`${topMenuHTML('words')}
    <header class="hero" style="padding:14px 0 18px"><h1>Сөздік</h1><p>Изученные слова</p></header>
    <div class="word-controls">
      <input type="text" class="search-input" id="wordSearch" placeholder="🔍 Поиск..." value="${esc(wordsSearch)}">
      <div class="sort-tabs">
        <button type="button" class="sort-tab ${wordsSort==='lesson'?'active':''}" data-sort="lesson">📚 По уроку</button>
        <button type="button" class="sort-tab ${wordsSort==='alpha'?'active':''}" data-sort="alpha">🔤 А-Я</button>
        <button type="button" class="sort-tab ${wordsSort==='alpha-desc'?'active':''}" data-sort="alpha-desc">🔤 Я-А</button>
      </div>
    </div>
    <div id="wordListContainer"></div>
  `);
  bindMenu();
  renderWordList();
  const searchEl = document.getElementById('wordSearch');
  if (searchEl){
    searchEl.oninput = (e) => { wordsSearch = e.target.value; renderWordList(); };
  }
  document.querySelectorAll('.sort-tab').forEach(b => {
    b.onclick = () => { wordsSort = b.dataset.sort; renderWords(); };
  });
  window.scrollTo(0,0);
}
function renderWordList(){
  const container = document.getElementById('wordListContainer');
  if (!container) return;
  const all = getLearnedWords();
  if (all.length === 0){
    setEl(container, `<div class="empty-words"><div style="font-size:64px;line-height:1">📚</div><p>Пока нет изученных слов.</p></div>`);
    return;
  }
  let words = all;
  if (wordsSearch.trim()){
    const q = wordsSearch.toLowerCase().trim();
    words = words.filter(w => w.kz.toLowerCase().includes(q) || w.ru.toLowerCase().includes(q));
  }
  if (wordsSort === 'alpha') words = words.slice().sort((a,b) => kkCompare(a.kz, b.kz));
  else if (wordsSort === 'alpha-desc') words = words.slice().sort((a,b) => kkCompare(b.kz, a.kz));
  if (words.length === 0){
    setEl(container, `<div class="no-results">🔍 Ничего не найдено.</div>`);
    return;
  }
  setEl(container, `<div class="words-table">
    <div class="words-head"><div>Қазақша</div><div>Русский</div></div>
    ${words.map(w => `<div class="word-row"><div class="w-kz">${w.emoji?w.emoji+' ':''}${esc(w.kz)}</div><div class="w-ru">${esc(w.ru)}</div></div>`).join('')}
  </div>`);
}

function renderReview(){
  session = null;
  const groups = DATA.map(lv => {
    const doneLessons = lv.lessons.map((ls,i) => ({ls, i})).filter(({ls,i}) => store.done[lv.id+':'+i] && ls.words);
    if (doneLessons.length === 0) return null;
    return { level: lv, doneLessons };
  }).filter(Boolean);

  if (groups.length === 0){
    setApp(`${topMenuHTML('review')}
      <header class="hero" style="padding:14px 0 18px"><h1>Қайталау</h1><p>Повторение</p></header>
      <div class="empty-words"><div style="font-size:64px">🔁</div><p>Пока нечего повторять.</p></div>`);
    bindMenu();
    return;
  }
  const total = groups.reduce((s,g) => s + g.doneLessons.length, 0);
  const weakList = getWeakWordsList();
  const weakBtn = weakList.length > 0
    ? `<div class="review-weak" id="weakBtn">
        <h4>🎯 Слабые слова (${weakList.length})</h4>
        <p>Повторить только то, где были ошибки</p>
      </div>`
    : '';

  setApp(`${topMenuHTML('review')}
    <header class="hero" style="padding:14px 0 18px"><h1>Қайталау</h1><p>Повторение · ${total}</p></header>
    <div class="review-intro">Выбери тему — 10 вопросов без новой теории.</div>
    ${weakBtn}
    <div class="review-random" id="randomBtn"><h4>🎲 Случайное повторение</h4><p>Из всех пройденных тем</p></div>
    ${groups.map(g => `<div class="review-group"><h3>${g.level.icon} ${esc(g.level.title)}</h3><div class="review-list">
      ${g.doneLessons.map(({ls,i}) => `<button type="button" class="review-item" data-id="${g.level.id}:${i}"><span>${esc(ls.title)}</span><span>→</span></button>`).join('')}
    </div></div>`).join('')}`);
  bindMenu();

  document.getElementById('randomBtn').onclick = () => {
    const all = [];
    groups.forEach(g => g.doneLessons.forEach(({ls,i}) => all.push({levelId:g.level.id, li:i})));
    if (!all.length) return;
    const pick = shuffle(all)[0];
    startReviewLesson(pick.levelId, pick.li);
  };
  if (weakList.length > 0) {
    document.getElementById('weakBtn').onclick = () => startWeakWordsReview();
  }
  app.querySelectorAll('.review-item').forEach(b => {
    b.onclick = () => { const [lid,li]=b.dataset.id.split(':'); startReviewLesson(lid,+li); };
  });
  window.scrollTo(0,0);
}

/* ===== ПЕРЕВОДЧИК ===== */
function renderTranslate(){
  session = null;
  setApp(`${topMenuHTML('translate')}
    <header class="hero" style="padding:14px 0 18px"><h1>Аудармашы</h1><p>Переводчик · ${getAllWords().length} слов в словаре</p></header>
    <div class="translate-tabs">
      <button type="button" class="translate-tab ${translateFromLang==='kz'?'active':''}" data-from="kz">Қаз → Рус</button>
      <button type="button" class="translate-tab ${translateFromLang==='ru'?'active':''}" data-from="ru">Рус → Қаз</button>
    </div>
    <div class="translate-input-wrap">
      <textarea class="translate-textarea" id="translateInput" placeholder="${translateFromLang==='kz'?'Введите казахское слово или фразу...':'Введите русское слово или фразу...'}" rows="3"></textarea>
    </div>
    <div id="translateResult"></div>
    <div class="hint">Поиск по словарю приложения. Можно вводить слово или короткую фразу.</div>
  `);
  bindMenu();
  const inp = document.getElementById('translateInput');
  if (inp){
    inp.value = translateInput;
    inp.oninput = (e) => { translateInput = e.target.value; renderTranslateResult(); };
    inp.focus();
  }
  document.querySelectorAll('.translate-tab').forEach(t => {
    t.onclick = () => { translateFromLang = t.dataset.from; renderTranslate(); };
  });
  renderTranslateResult();
  window.scrollTo(0,0);
}
function normalizeTranslateStr(s){
  return String(s || '').toLowerCase().replace(/[?!.,;:]/g, '').replace(/\s+/g, ' ').trim();
}
function findWordTranslation(word, fromLang){
  const q = normalizeTranslateStr(word);
  if (!q) return null;
  const allWords = getAllWords();
  const field = fromLang === 'kz' ? 'kz' : 'ru';
  const seen = new Set();
  const results = [];

  allWords.forEach(w => {
    const val = normalizeTranslateStr(w[field]);
    if (val === q && !seen.has(w.kz)){
      seen.add(w.kz);
      results.push({...w, matchType:'exact'});
    }
  });
  if (results.length > 0) return results;

  allWords.forEach(w => {
    const val = normalizeTranslateStr(w[field]);
    if (val.startsWith(q) && !seen.has(w.kz)){
      seen.add(w.kz);
      results.push({...w, matchType:'partial'});
    }
  });
  if (results.length > 0) return results;

  allWords.forEach(w => {
    const val = normalizeTranslateStr(w[field]);
    if (val.includes(q) && !seen.has(w.kz)){
      seen.add(w.kz);
      results.push({...w, matchType:'contains'});
    }
  });
  return results;
}
function translateQuery(){
  const q = translateInput.trim();
  if (!q) return { type: 'empty' };
  const tokens = q.match(/[а-яёәғқңөұүһіa-z0-9?]+/gi) || [];
  if (tokens.length <= 1){
    const localRes = findWordTranslation(q, translateFromLang);
    if (localRes && localRes.length > 0) {
      return { type: 'word', results: localRes, source: 'local' };
    }
  }
  return { type: 'api', query: q, source: 'api' };
}
function renderTranslateResult(){
  const container = document.getElementById('translateResult');
  if (!container) return;
  const result = translateQuery();

  if (result.type === 'empty'){
    setEl(container, `<div class="empty-words"><div style="font-size:64px;line-height:1">🌐</div><p>Введите слово или фразу для перевода</p></div>`);
    return;
  }

  if (result.type === 'word'){
    const html = result.results.slice(0, 15).map(r => {
      const source = translateFromLang === 'kz' ? r.kz : r.ru;
      const target = translateFromLang === 'kz' ? r.ru : r.kz;
      const badge = r.matchType === 'exact' ? '<span class="translate-badge">точное</span>' : '';
      return `<div class="translate-result-item">
        <div class="translate-result-emoji">${r.emoji || '📖'}</div>
        <div class="translate-result-text">
          <div class="translate-result-source">${esc(source)} ${badge}</div>
          <div class="translate-result-target">${esc(target)}</div>
        </div>
        <button type="button" class="translate-speak" data-speak="${esc(source)}">🔊</button>
      </div>`;
    }).join('');
    setEl(container, `<div class="translate-results">${html}</div><div class="translate-phrase-hint">💡 Из словаря приложения</div>`);
    container.querySelectorAll('.translate-speak').forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.speak); };
    });
    return;
  }

  if (result.type === 'api'){
    setEl(container, `<div class="empty-words"><div style="font-size:64px;line-height:1">⏳</div><p>Переводим «${esc(result.query)}»...</p></div>`);
    const queryAtRequest = result.query;
    translateExternal(result.query, translateFromLang).then(translatedText => {
      if (!container.isConnected) return;
      if (translateInput.trim() !== queryAtRequest) return;
      if (!translatedText){
        setEl(container, `<div class="no-results">🔍 Не удалось перевести.<br><small>Проверьте интернет или попробуйте позже.</small></div>`);
        return;
      }
      const html = `<div class="translate-result-item">
        <div class="translate-result-emoji">🌐</div>
        <div class="translate-result-text">
          <div class="translate-result-source">${esc(result.query)}</div>
          <div class="translate-result-target">${esc(translatedText)}</div>
        </div>
        <button type="button" class="translate-speak">🔊</button>
      </div>`;
      setEl(container, `<div class="translate-results">${html}</div><div class="translate-phrase-hint">💡 Машинный перевод (MyMemory)</div>`);
      const sp = container.querySelector('.translate-speak');
      if (sp) sp.onclick = () => speak(translatedText);
    }).catch(() => {
      if (!container.isConnected) return;
      setEl(container, `<div class="no-results">🔍 Ошибка перевода.<br><small>Проверьте интернет-соединение.</small></div>`);
    });
  }
}

// Внешний перевод через MyMemory (бесплатно, без ключа)
function translateExternal(text, fromLang){
  const langpair = fromLang === 'kz' ? 'kk-KZ|ru-RU' : 'ru-RU|kk-KZ';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
  return fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data && data.responseStatus === 200 && data.responseData && data.responseData.translatedText){
        const t = data.responseData.translatedText;
        if (t && !/^MYMEMORY WARNING/i.test(t)) return t;
      }
      return null;
    })
    .catch(() => null);
}

function renderSettings(){
  session = null;
  setApp(`${topMenuHTML('settings')}
    <header class="hero" style="padding:14px 0 18px"><h1>Баптаулар</h1><p>Настройки</p></header>
    <div class="settings-list">
      <div class="settings-item">
        <div class="si-text"><div class="si-title">🔀 Интерливинг</div><div class="si-desc">2 старых вопроса в конце каждого урока</div></div>
        <button type="button" class="toggle ${store.interleaving?'on':''}" id="tInt"><span class="toggle-knob"></span></button>
      </div>
      <div class="settings-item">
        <div class="si-text"><div class="si-title">🌙 Тёмный режим</div><div class="si-desc">Тёмное оформление интерфейса</div></div>
        <button type="button" class="toggle ${store.darkMode?'on':''}" id="tDark"><span class="toggle-knob"></span></button>
      </div>
            <div class="settings-item" style="justify-content: center; cursor: pointer;" id="logoutBtn">
        <div class="si-title" style="color: #ff4b4b;">🚪 Выйти из аккаунта</div>
      </div>
    </div>`);
  bindMenu();
  document.getElementById('tInt').onclick = () => { store.interleaving = !store.interleaving; save(); renderSettings(); };
     document.getElementById('logoutBtn').onclick = () => {
    if (window.firebaseAuth && window.firebaseAuth.signOut) {
      window.firebaseAuth.signOut(window.firebaseAuth.auth);
    }
  };
  document.getElementById('tDark').onclick = () => { store.darkMode = !store.darkMode; document.body.classList.toggle('dark', store.darkMode); save(); renderSettings(); };
  window.scrollTo(0,0);
}

function isGrammarLesson(ls){ return ls && ls.type === 'grammar'; }

function buildLearnCards(lesson){
  if (isGrammarLesson(lesson)) return lesson.theory.map(t => ({kind:'theory', title:t.title, text:t.text, examples:t.examples||[]}));
  if (lesson.type === 'checkpoint' || lesson.type === 'text') return [];
  return lesson.words.map(w => ({kind:'word', kz:w.kz, ru:w.ru, emoji:w.emoji}));
}
function buildExercises(lesson, lessonId, skipInterleaving){
  if (isGrammarLesson(lesson)) return shuffle(lesson.exercises);
  if (lesson.type === 'checkpoint') return shuffle(lesson.exercises);
  if (lesson.type === 'text') return lesson.questions;
  const words = lesson.words, mcq = [];
  words.forEach(w => {
    const others = shuffle(words.filter(x => x !== w)).slice(0,3).map(x => x.ru);
    mcq.push({type:'choice', prompt:'Что означает это слово?', display:w.kz, speak:w.kz, answer:w.ru, options:shuffle([w.ru,...others]), _wordKey: w.kz});
  });
  words.forEach(w => {
    const others = shuffle(words.filter(x => x !== w)).slice(0,3).map(x => x.kz);
    mcq.push({type:'choice', prompt:'Как это сказать по-казахски?', display:w.ru, speak:null, answer:w.kz, options:shuffle([w.kz,...others]), _wordKey: w.kz});
  });
  const current = shuffle(mcq).slice(0, 10);
  if (!skipInterleaving && store.interleaving && lessonId){
    const oldWords = getOldWords(lessonId);
    if (oldWords.length >= 4){
      const picked = shuffle(oldWords).slice(0, 2);
      const review = picked.map(w => {
        const others = shuffle(oldWords.filter(x => x !== w)).slice(0,3).map(x => x.ru);
        return { type:'choice', prompt:'Қайталау · Что означает это слово?', display:w.kz, speak:w.kz, answer:w.ru, options:shuffle([w.ru,...others]), isReview:true, _wordKey: w.kz };
      });
      return [...current.slice(0, 8), ...review];
    }
  }
  return current;
}

function isUnlocked(id){
  const idx = FLAT_INDEX[id];
  if (idx === undefined || idx <= 0) return true;
  return !!store.done[FLAT[idx-1].id];
}

function renderAuth() {
  setApp(`
    <header class="hero" style="padding:30px 0 10px">
      <h1>Қазақ тілі</h1>
      <p>Войдите, чтобы сохранять прогресс</p>
    </header>
    <div class="auth-container">
      
      <!-- БЛОК РЕГИСТРАЦИИ -->
      <div class="auth-block">
        <h2>Регистрация</h2>
        <input type="email" id="regEmail" class="search-input" placeholder="Email">
        <input type="password" id="regPass" class="search-input" placeholder="Пароль (мин. 6 символов)">
        <button type="button" class="btn primary" id="btnRegister">Создать аккаунт</button>
        <button type="button" class="btn btn-google" id="btnRegGoogle">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"> Регистрация через Google
        </button>
      </div>

      <div class="auth-divider">или</div>

      <!-- БЛОК ВХОДА -->
      <div class="auth-block">
        <h2>Вход</h2>
        <input type="email" id="logEmail" class="search-input" placeholder="Email">
        <input type="password" id="logPass" class="search-input" placeholder="Пароль">
        <button type="button" class="btn primary" id="btnLogin">Войти</button>
        <button type="button" class="btn btn-google" id="btnLogGoogle">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"> Войти через Google
        </button>
      </div>

      <p class="auth-error" id="authError"></p>
    </div>
  `);

  if (!window.firebaseAuth) {
    document.getElementById('authError').textContent = 'Ошибка: Firebase не загружен.';
    return;
  }

  const { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, googleProvider, signInWithPopup } = window.firebaseAuth;
  const errEl = document.getElementById('authError');

  const showError = (error) => {
    // Переводим популярные ошибки на русский
    const msg = error.code === 'auth/invalid-credential' ? 'Неверный email или пароль.' :
                error.code === 'auth/email-already-in-use' ? 'Этот email уже зарегистрирован.' :
                error.code === 'auth/weak-password' ? 'Пароль слишком короткий (минимум 6 символов).' :
                error.message;
    errEl.textContent = msg;
  };

  // 1. Регистрация через Email
  document.getElementById('btnRegister').onclick = () => {
    errEl.textContent = '';
    const email = document.getElementById('regEmail').value;
    const pass = document.getElementById('regPass').value;
    createUserWithEmailAndPassword(auth, email, pass).catch(showError);
  };

  // 2. Вход через Email
  document.getElementById('btnLogin').onclick = () => {
    errEl.textContent = '';
    const email = document.getElementById('logEmail').value;
    const pass = document.getElementById('logPass').value;
    signInWithEmailAndPassword(auth, email, pass).catch(showError);
  };

  // 3. Вход/Регистрация через Google (одна кнопка делает и то, и другое)
  const handleGoogle = () => {
    errEl.textContent = '';
    signInWithPopup(auth, googleProvider).catch(showError);
  };
  document.getElementById('btnRegGoogle').onclick = handleGoogle;
  document.getElementById('btnLogGoogle').onclick = handleGoogle;
}

function renderHome(){
  session = null;
  const { total, done, pct } = getProgress();
  const wordsCount = getLearnedWords().length;
  const weakCount = getWeakWordsList().length;
  let globalNodeIndex = 0;

  const levelsHtml = DATA.map(lv => {
    const nodes = lv.lessons.map((ls,i) => {
      const id = lv.id + ':' + i;
      const isDone = !!store.done[id], unlocked = isUnlocked(id);
      let cls, label;
      if (isDone) { cls='done'; label='✓'; }
      else if (unlocked) {
        if (isGrammarLesson(ls)) { cls='current grammar'; label='📝'; }
        else if (ls.type === 'checkpoint') { cls='current checkpoint'; label='🎯'; }
        else if (ls.type === 'text') { cls='current text'; label='📖'; }
        else { cls='current'; label=(i+1); }
      } else { cls='locked'; label='🔒'; }
      const offset = Math.sin(globalNodeIndex * Math.PI / 3) * 70;
      globalNodeIndex++;
      return `<div class="node-wrap" style="transform:translateX(${offset}px)">
        <button type="button" class="node ${cls}" data-id="${id}" ${unlocked?'':'disabled'}>${label}</button>
        <div class="node-label">${esc(ls.title)}</div>
      </div>`;
    }).join('');
    return `<section class="level">
      <div class="level-head"><span>${esc(lv.title)}</span></div>
      <div class="nodes">${nodes}</div>
    </section>`;
  }).join('');

  const weakPart = weakCount > 0 ? `<span>⚠️ Слабых: <b>${weakCount}</b></span>` : '';

  setApp(`${topMenuHTML('home')}
    <header class="hero"><h1>Қазақ тілі</h1><p>Учим казахский — шаг за шагом</p></header>
    <div class="progress-card">
      <div class="progress-row">
        <span>📚 Пройдено уроков</span>
        <span><b>${done}</b> / ${total}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-stats">
        <span>📖 Слов: <b>${wordsCount}</b></span>
        <span>🎯 Прогресс: <b>${pct}%</b></span>
        ${weakPart}
      </div>
    </div>
    <div>${levelsHtml}</div>
    <div class="hint">Прогресс в браузере · <button type="button" class="link" id="reset">Сбросить</button></div>
  `);
  bindMenu();
  app.querySelectorAll('.node').forEach(btn => {
    btn.onclick = () => { const [lid,li] = btn.dataset.id.split(':'); startLesson(lid, +li); };
  });
  document.getElementById('reset').onclick = () => {
    showConfirm({
      title: 'Сбросить прогресс?',
      message: 'XP, серия, пройденные уроки и слабые слова обнулятся. Настройки останутся.',
      yesText: 'Сбросить', noText: 'Отмена', danger: true,
      onYes: () => {
        const dm = store.darkMode, il = store.interleaving;
        store = {xp:0, done:{}, streak:0, last:null, interleaving:il, darkMode:dm, weakWords:{}};
        save(); renderHome();
      }
    });
  };
  window.scrollTo(0,0);
}

function startLesson(levelId, li){
  const lv = DATA.find(l => l.id === levelId);
  if (!lv || !lv.lessons || !lv.lessons[li]) return;
  const lesson = lv.lessons[li];
  let phase = 'learn';
  if (lesson.type === 'checkpoint') phase = 'quiz';
  else if (lesson.type === 'text') phase = 'reading';
  session = { levelId, li, lesson, phase, learnCards:buildLearnCards(lesson), learnIdx:0,
    exercises:buildExercises(lesson, levelId + ':' + li, false), idx:0, correct:0, wrong:0, selected:null, feedback:null,
    hearts: 5, errors: [] };
  renderLesson();
}
function startReviewLesson(levelId, li){
  const lv = DATA.find(l => l.id === levelId);
  const lesson = lv.lessons[li];
  const ex = buildExercises(lesson, levelId + ':' + li, true);
  const picked = shuffle(ex).slice(0, 10);
  session = { levelId, li, lesson, phase:'quiz', learnCards:[], learnIdx:0,
    exercises:picked, idx:0, correct:0, wrong:0, selected:null, feedback:null,
    hearts: 5, errors: [], isReview: true };
  renderLesson();
}
function startWeakWordsReview(){
  const weakList = getWeakWordsList();
  if (!weakList.length) return;
  const allWords = getAllWords();
  const exercises = weakList.map(({word}) => {
    const others = shuffle(allWords.filter(x => x.kz !== word.kz)).slice(0,3).map(x => x.ru);
    return { type:'choice', prompt:'Қайталау · Что означает это слово?', display:word.kz, speak:word.kz, answer:word.ru, options:shuffle([word.ru,...others]), isReview:true, _wordKey: word.kz };
  });
  session = { levelId: null, li: null, lesson: null, phase:'quiz', learnCards:[], learnIdx:0,
    exercises: shuffle(exercises).slice(0, 10), idx:0, correct:0, wrong:0, selected:null, feedback:null,
    hearts: 5, errors: [], isReview: true, isWeak: true };
  renderLesson();
}
function startErrorRepeat(){
  if (!lastResult || !lastResult.errors || !lastResult.errors.length) return;
  const s = {
    levelId: lastResult.levelId, li: lastResult.li, lesson: lastResult.lesson,
    phase: 'quiz', learnCards: [], learnIdx: 0,
    exercises: shuffle(lastResult.errors.slice()),
    idx: 0, correct: 0, wrong: 0, selected: null, feedback: null,
    hearts: 5, errors: [], isRepeat: true
  };
  lastResult = null;
  session = s;
  renderLesson();
}
function handleQuit(){
  const s = session; if (!s) return;
  showConfirm({
    title: 'Выйти из урока?', message: 'Прогресс этого урока не сохранится.',
    yesText: 'Выйти', noText: 'Остаться', danger: true,
    onYes: () => {
      const wasReview = s.isReview; session = null;
      if (wasReview) { currentView = 'review'; renderReview(); }
      else { currentView = 'home'; renderHome(); }
    }
  });
}
function renderHeartsOut(){
  const s = session; if (!s) return;
  const wasReview = s.isReview;
  const wasRepeat = s.isRepeat;
  const levelId = s.levelId;
  const li = s.li;
  const errors = s.errors.slice();
  const lesson = s.lesson;
  session = null;
  setApp(`<div class="result">
    <div class="res-emoji">💔</div>
    <h1>Сердечки закончились</h1>
    <p class="res-sub">Не страшно! Попробуй ещё раз</p>
    <button type="button" class="btn primary" id="retryBtn">Попробовать снова</button>
    <button type="button" class="btn secondary" id="quitBtn2" style="margin-top:10px">Вернуться</button>
  </div>`);
  document.getElementById('retryBtn').onclick = () => {
    if (wasRepeat && errors.length) {
      session = { levelId, li, lesson, phase:'quiz', learnCards:[], learnIdx:0,
        exercises: shuffle(errors), idx:0, correct:0, wrong:0, selected:null, feedback:null,
        hearts: 5, errors: [], isRepeat: true };
      renderLesson();
    } else if (wasReview && levelId !== null && levelId !== undefined) {
      startReviewLesson(levelId, li);
    } else if (levelId !== null && levelId !== undefined) {
      startLesson(levelId, li);
    } else {
      currentView = 'home'; renderHome();
    }
  };
  document.getElementById('quitBtn2').onclick = () => {
    if (wasReview) { currentView = 'review'; renderReview(); }
    else { currentView = 'home'; renderHome(); }
  };
  window.scrollTo(0,0);
}
function renderLesson(){
  const s = session; if (!s) return;
  if (s.phase === 'reading') return renderReading();
  if (s.phase === 'learn') return renderLearn();
  if (s.idx >= s.exercises.length) return finishLesson();
  const ex = s.exercises[s.idx];
  const pct = Math.round((s.idx / s.exercises.length) * 100);
  setApp(`<div class="lesson-screen">
    <div class="lesson-top">
      <button type="button" class="icon-btn" id="quitBtn">✕</button>
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="hearts">${heartsDisplay(s.hearts)}</div>
      <div class="cnt">${s.idx+1}/${s.exercises.length}</div>
    </div>
    <div class="lesson-body">${choiceHTML(ex)}</div>
    <div class="lesson-bottom" id="bottom"></div>
  </div>`);
  document.getElementById('quitBtn').onclick = handleQuit;
  bindChoice(ex);
  window.scrollTo(0,0);
}
function renderReading(){
  const s = session; const lesson = s.lesson;
  setApp(`<div class="lesson-screen">
    <div class="lesson-top">
      <button type="button" class="icon-btn" id="quitBtn">✕</button>
      <div class="bar"><div class="fill" style="width:0%"></div></div>
      <div class="hearts">${heartsDisplay(s.hearts)}</div>
      <div class="cnt">📖</div>
    </div>
    <div class="lesson-body"><p class="q-prompt">Мәтін · Текст</p>
      <h2 class="text-title">${esc(lesson.title)}</h2>
      <div class="text-hint">Нажми на предложение — перевод</div>
      <div class="text-card">${lesson.sentences.map(se => `<div class="text-sentence"><div class="ts-kz">${esc(se.kz)} <button type="button" class="inline-speak" data-text="${esc(se.kz)}">🔊</button></div><div class="ts-ru">${esc(se.ru)}</div></div>`).join('')}</div>
    </div>
    <div class="lesson-bottom"><button type="button" class="btn primary" id="toQuiz">К вопросам →</button></div>
  </div>`);
  document.getElementById('quitBtn').onclick = handleQuit;
  app.querySelectorAll('.text-sentence').forEach(el => { el.onclick = () => el.classList.toggle('revealed'); });
   app.querySelectorAll('.inline-speak').forEach(btn => {
    btn.onclick = (e) => { 
      e.stopPropagation(); // Чтобы при клике на звук не открывался перевод
      speak(btn.dataset.text); 
    };
  });
  document.getElementById('toQuiz').onclick = () => { s.phase='quiz'; s.idx=0; s.selected=null; s.feedback=null; renderLesson(); };
  window.scrollTo(0,0);
}
function renderLearn(){
  const s = session; if (!s) return;
  const cards = s.learnCards || [];
  if (cards.length === 0){ s.phase = 'quiz'; s.idx = 0; s.selected = null; s.feedback = null; renderLesson(); return; }
  const i = s.learnIdx, card = cards[i];
  if (!card){ s.phase = 'quiz'; s.idx = 0; s.selected = null; s.feedback = null; renderLesson(); return; }
  const isLast = i >= cards.length - 1;
  const pct = Math.round((i / cards.length) * 100);
  const alreadyDone = !!store.done[s.levelId + ':' + s.li];
  let body, prompt;
  if (card.kind === 'theory'){
    prompt = 'Ереже · Правило';
    body = `<div class="theory-card"><h3>${esc(card.title)}</h3><p>${esc(card.text)}</p>${(card.examples||[]).map(e => `<div class="theory-example"><div class="te-kz">${esc(e.kz)}</div><div class="te-ru">${esc(e.ru)}</div></div>`).join('')}</div>`;
  } else {
    prompt = 'Жаңа сөз · Новое слово';
    body = `<div class="learn-card">${card.emoji?`<div class="lc-emoji">${card.emoji}</div>`:''}<div class="lc-kz">${esc(card.kz)}</div><div class="lc-ru">${esc(card.ru)}</div><button type="button" class="speak" id="speakBtn">🔊</button></div>`;
  }
  setApp(`<div class="lesson-screen">
    <div class="lesson-top">
      <button type="button" class="icon-btn" id="quitBtn">✕</button>
      <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="hearts">${heartsDisplay(s.hearts)}</div>
      <div class="cnt">${i+1}/${cards.length}</div>
    </div>
    <div class="lesson-body"><p class="q-prompt">${prompt}</p>${body}</div>
    <div class="lesson-bottom">
      ${i>0?'<button type="button" class="btn secondary" id="backBtn">← Назад</button>':''}
      <button type="button" class="btn primary" id="nextLearnBtn">${isLast?'Начать тренировку':'Продолжить'}</button>
      ${alreadyDone && i===0?'<div style="text-align:center;margin-top:10px"><button type="button" class="link" id="skipLearn">Сразу к упражнениям →</button></div>':''}
    </div>
  </div>`);
  document.getElementById('quitBtn').onclick = handleQuit;
  const sp = document.getElementById('speakBtn');
  if (sp) sp.onclick = () => speak(card.kz);
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.onclick = () => { s.learnIdx--; renderLearn(); };
  function goToQuiz(){ s.phase='quiz'; s.idx=0; s.selected=null; s.feedback=null; renderLesson(); }
  document.getElementById('nextLearnBtn').onclick = () => {
    if (isLast) goToQuiz(); else { s.learnIdx++; renderLearn(); }
  };
  const skip = document.getElementById('skipLearn');
  if (skip) skip.onclick = goToQuiz;
  window.scrollTo(0,0);
}
function choiceHTML(ex){
  return `${ex.isReview ? '<div class="q-badge">🔁 Повторение</div>' : ''}
    <p class="q-prompt">${esc(ex.prompt)}</p>
    <div class="q-card ${ex.display?'':'small'}">
      ${ex.display?`<div class="q-word">${esc(ex.display)}</div>`:'<div class="q-ru">Выбери правильный ответ</div>'}
      ${ex.speak?`<button type="button" class="speak" id="speakBtn">🔊</button>`:''}
    </div>
    <div class="options" id="options">
      ${ex.options.map(o => `<button type="button" class="opt" data-val="${esc(o)}">${esc(o)}</button>`).join('')}
    </div>`;
}
function bindChoice(ex){
  const opts = Array.from(app.querySelectorAll('.opt'));
  opts.forEach(b => {
    b.onclick = () => {
      if (session.feedback) return;
      session.selected = b.dataset.val;
      opts.forEach(x => x.classList.toggle('sel', x === b));
      renderBottom();
    };
  });
  const sp = document.getElementById('speakBtn');
  if (sp && ex.speak) sp.onclick = () => speak(ex.speak);
}
function canCheck(){ const s=session; if(!s||s.feedback) return false; return s.selected != null; }
function renderBottom(){
  const s = session, bottom = document.getElementById('bottom');
  if (!bottom || !s) return;
  if (!s.feedback){
    bottom.className = 'lesson-bottom';
    setEl(bottom, `<button type="button" class="btn primary" id="checkBtn" ${canCheck()?'':'disabled'}>Проверить</button>`);
    const b = document.getElementById('checkBtn');
    if (b) b.onclick = doCheck;
  } else {
    const f = s.feedback;
    bottom.className = 'lesson-bottom fb ' + (f.ok?'ok':'bad');
    const hint = f.ok ? '' : grammarHint(f.exercise);
    setEl(bottom, `<div class="fb-row"><div class="fb-icon">${f.ok?'✅':'❌'}</div>
      <div class="fb-text"><b>${f.ok?'Дұрыс!':'Қате!'}</b>
        <span>${f.ok?'Правильно':'Правильный ответ:'}</span>
        ${f.ok?'':`<em>${esc(f.answer)}</em>`}
        ${hint ? `<div class="fb-hint">💡 ${esc(hint)}</div>` : ''}
      </div></div>
      <button type="button" class="btn ${f.ok?'primary':'danger'}" id="nextBtn">Продолжить</button>`);
    document.getElementById('nextBtn').onclick = nextQ;
  }
}
function doCheck(){
  const s = session, ex = s.exercises[s.idx];
  const ok = s.selected === ex.answer;
  if (ex._wordKey) {
    const cur = store.weakWords[ex._wordKey] || 0;
    if (ok) {
      const next = Math.max(0, cur - 1);
      if (next === 0) delete store.weakWords[ex._wordKey];
      else store.weakWords[ex._wordKey] = next;
    } else {
      store.weakWords[ex._wordKey] = Math.min(10, cur + 1);
    }
    save();
  }
  if (!ok) {
    s.hearts = Math.max(0, s.hearts - 1);
    s.errors.push(ex);
  }
  app.querySelectorAll('.opt').forEach(b => {
    if (b.dataset.val === ex.answer) b.classList.add('right');
    if (b.dataset.val === s.selected && !ok) b.classList.add('wrong');
    b.classList.add('locked');
  });
  if (ok) s.correct++; else s.wrong++;
  s.feedback = { ok, answer: ex.answer, exercise: ex };
  renderBottom();
}
function nextQ(){
  const s = session;
  if (s.hearts <= 0) {
    renderHeartsOut();
    return;
  }
  s.idx++;
  s.selected = null;
  s.feedback = null;
  renderLesson();
}
function finishLesson(){
  const s = session, total = s.exercises.length;
  const acc = total ? Math.round(s.correct/total*100) : 0;
  const baseResult = {
    acc, correct: s.correct, wrong: s.wrong,
    errors: s.errors.slice(),
    levelId: s.levelId, li: s.li, lesson: s.lesson,
    isReview: s.isReview, isWeak: s.isWeak
  };
  const isNormalLesson = !s.isRepeat && !s.isReview && s.levelId && s.li !== null && s.li !== undefined;
  if (isNormalLesson){
    const id = s.levelId + ':' + s.li;
    const first = !store.done[id];
    const xp = (first?10:0) + Math.round(s.correct*1.5);
    store.xp += xp;
    store.done[id] = true;
    const today = new Date().toDateString();
    if (store.last !== today){
      const y = new Date(Date.now()-86400000).toDateString();
      store.streak = (store.last === y) ? store.streak+1 : 1;
      store.last = today;
    }
    save();
    baseResult.xp = xp;
  } else {
    baseResult.xp = 0;
    if (s.isRepeat) baseResult.isRepeat = true;
  }
  lastResult = baseResult;
  session = null;
  renderResult();
}
function renderResult(){
  const r = lastResult;
  const face = r.acc>=80?'🏆':r.acc>=50?'💪':'🌱';
  const title = r.acc>=80?'Керемет!':r.acc>=50?'Жарайсың!':'Жалғастыр!';
  const sub = r.acc>=80?'Отличная работа!':r.acc>=50?'Хороший результат!':'Продолжай тренироваться!';
  const hasErrors = r.errors && r.errors.length > 0;

  let buttons = '';
  if (hasErrors && !r.isReview){
    buttons = `<button type="button" class="btn primary" id="repeatErrorsBtn">🔁 Повторить ошибки (${r.errors.length})</button>
      <button type="button" class="btn secondary" id="homeBtn" style="margin-top:10px">Продолжить</button>`;
  } else {
    buttons = `<button type="button" class="btn primary" id="homeBtn">${r.isReview ? 'К повторению' : 'Продолжить'}</button>`;
  }

  setApp(`<div class="result"><div class="res-emoji">${face}</div><h1>${title}</h1><p class="res-sub">${sub}</p>
    <div class="res-stats">
      <div class="stat-box"><span class="s-val">⚡ ${r.xp}</span><span class="s-lab">Опыт</span></div>
      <div class="stat-box"><span class="s-val">🎯 ${r.acc}%</span><span class="s-lab">Точность</span></div>
      <div class="stat-box"><span class="s-val">✅ ${r.correct}</span><span class="s-lab">Верно</span></div>
    </div>
    ${buttons}
  </div>`);
  document.getElementById('homeBtn').onclick = () => {
    lastResult = null;
    if (r.isReview) { currentView = 'review'; renderReview(); }
    else { currentView = 'home'; renderHome(); }
  };
  if (hasErrors && !r.isReview){
    document.getElementById('repeatErrorsBtn').onclick = startErrorRepeat;
  }
  window.scrollTo(0,0);
}

// Запуск приложения после проверки авторизации
if (window.firebaseInitError) {
  // Показываем понятную ошибку, если Firebase упал
  setApp(`
    <div style="padding: 40px 20px; text-align: center;">
      <h2 style="color: #ff4b4b; margin-bottom: 16px;">Ошибка подключения</h2>
      <p style="font-weight: 700; color: #3c3c3c; margin-bottom: 20px;">${esc(window.firebaseInitError)}</p>
      <button type="button" class="btn primary" onclick="location.reload()">Попробовать снова</button>
    </div>
  `);
} else if (window.firebaseAuth && window.firebaseAuth.onAuthStateChanged) {
  // Если Firebase ок, запускаем проверку авторизации
  window.firebaseAuth.onAuthStateChanged(window.firebaseAuth.auth, (user) => {
    if (user) {
      currentView = 'home';
      renderHome();
    } else {
      currentView = 'auth';
      renderAuth();
    }
  });
} else {
  // Резервный вариант
  renderHome();
}
