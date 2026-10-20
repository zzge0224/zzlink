/**
 * 字笺 · ZiJian — 聊天 / 字卡 / 音乐一起听 / 主题
 * 主存储：IndexedDB（大容量）；兼容迁移 localStorage
 */
(function () {
  'use strict';
  const STORAGE_KEY = 'zijian_data_v7';
  const IDB_NAME = 'zijian_db';
  const IDB_STORE = 'kv';
  const IDB_VERSION = 1;
  const DEFAULT_SETTINGS = { minDelay: 1.5, maxDelay: 4, maxReplies: 2 };
  const DEFAULT_INTERACTION = ['轻轻拍了拍', '重重拍了拍', '拍了拍', '戳了戳', '碰了碰'];
  const DEFAULT_LISTEN = { pauseChance: 0.18, favoriteChance: 0.12, pauseDurationMax: 6 };
  const THEMES = ['classic', 'dark', 'cream', 'lavender'];

  const SAMPLE_LRC = `[00:00.00]示例歌词第一行
[00:05.00]这是第二行歌词
[00:10.00]可以导入真正的 LRC
[00:15.00]播放时会高亮滚动
[00:20.00]和联系人一起听吧`;

  const DEFAULT_SONGS = [
    {
      id: 'song_demo1',
      title: '示例曲目 · 纸笺',
      artist: '字笺',
      cover: '',
      src: '',
      lrc: SAMPLE_LRC,
      mode: 'direct'
    }
  ];

  const DEFAULT_CONTACTS = [
    {
      id: 'c1', name: '黎枫', avatarColor: '#3D9A62', avatarImg: null,
      chatBgColor: null, chatBgImg: null,
      cards: ['今日风清，想与你分享一杯热茶。', '你说的那句话，我记了很久。', '山高水长，字笺传情。', '不必急着回复，慢慢想就好。', '夜深了，记得早点休息。'],
      interactionCards: [...DEFAULT_INTERACTION, '回拍了你一下'],
      settings: { ...DEFAULT_SETTINGS },
      favorites: [],
      listenConfig: { ...DEFAULT_LISTEN }
    },
    {
      id: 'c2', name: '阿澄', avatarColor: '#B23A3A', avatarImg: null,
      chatBgColor: null, chatBgImg: null,
      cards: ['刚写完一页，忽然想起你。', '纸笺有限，心意无限。', '下次见面，带你去看那片银杏。', '你的字卡总是很温柔。', '保持联系，别让时间把我们冲淡。'],
      interactionCards: [...DEFAULT_INTERACTION, '也拍了拍你'],
      settings: { minDelay: 2, maxDelay: 5, maxReplies: 3 },
      favorites: [],
      listenConfig: { pauseChance: 0.22, favoriteChance: 0.15, pauseDurationMax: 8 }
    }
  ];

  let state = {
    contacts: [], songs: [], chats: {}, userBalance: 888, theme: 'classic',
    currentContactId: null, chatContactId: null,
    editingCardIndex: null, editingCardType: 'normal', modalMode: null,
    pendingTimers: [], quotingMsg: null, longPressMsg: null,
    playMode: 'order', // order | random | loop | one
    // 一起听
    listenSongId: null, listenContactId: null, listenInterval: null,
    listenLyrics: [], listenLyricIdx: -1, pendingSong: null,
    listenQueue: [], listenIndex: 0, floatVisible: false
  };

  function normalizeLoaded(p) {
    if (!p || !Array.isArray(p.contacts) || !p.contacts.length) {
      return {
        contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)),
        songs: JSON.parse(JSON.stringify(DEFAULT_SONGS)),
        chats: {}, userBalance: 888, theme: 'classic', playMode: 'order'
      };
    }
    p.contacts.forEach(c => {
      if (!c.settings) c.settings = { ...DEFAULT_SETTINGS };
      if (!c.interactionCards) c.interactionCards = [...DEFAULT_INTERACTION];
      if (!c.favorites) c.favorites = [];
      if (!c.listenConfig) c.listenConfig = { ...DEFAULT_LISTEN };
      if (c.avatarImg === undefined) c.avatarImg = null;
      if (c.chatBgImg === undefined) c.chatBgImg = null;
      if (c.chatBgColor === undefined) c.chatBgColor = null;
    });
    return {
      contacts: p.contacts,
      songs: Array.isArray(p.songs) ? p.songs : JSON.parse(JSON.stringify(DEFAULT_SONGS)),
      chats: p.chats || {},
      userBalance: typeof p.userBalance === 'number' ? p.userBalance : 888,
      theme: THEMES.includes(p.theme) ? p.theme : 'classic',
      playMode: p.playMode || 'order'
    };
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no idb')); return; }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb open fail'));
    });
  }

  function idbGet(key) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  function idbSet(key, value) {
    return openIdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function buildPersistPayload() {
    // 歌词过长时截断，封面/背景走 IDB 不限 localStorage
    const songs = (state.songs || []).map(s => {
      const o = { ...s };
      if (o.lrc && o.lrc.length > 20000) o.lrc = o.lrc.slice(0, 20000);
      return o;
    });
    const chats = {};
    Object.keys(state.chats || {}).forEach(cid => {
      const arr = state.chats[cid] || [];
      chats[cid] = arr.length > 500 ? arr.slice(-500) : arr;
    });
    return {
      contacts: state.contacts,
      songs,
      chats,
      userBalance: state.userBalance,
      theme: state.theme,
      playMode: state.playMode || 'order',
      _v: 7
    };
  }

  async function loadDataAsync() {
    // 1) IndexedDB
    try {
      const fromIdb = await idbGet(STORAGE_KEY);
      if (fromIdb && fromIdb.contacts) return normalizeLoaded(fromIdb);
    } catch (e) { console.warn('idb load', e); }
    // 2) 旧版 localStorage 迁移
    try {
      const keys = ['zijian_data_v7', 'zijian_data_v6', 'zijian_data_v5', 'zijian_data_v4'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.contacts) && p.contacts.length) {
          const data = normalizeLoaded(p);
          // 异步写入 IDB，不阻塞
          idbSet(STORAGE_KEY, data).catch(() => {});
          return data;
        }
      }
    } catch (e) { console.warn('ls load', e); }
    return normalizeLoaded(null);
  }

  let _saveTimer = null;
  let _saveChain = Promise.resolve();

  function saveData() {
    // 防抖合并频繁写入（发消息不会卡）
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      const payload = buildPersistPayload();
      _saveChain = _saveChain.then(async () => {
        try {
          await idbSet(STORAGE_KEY, payload);
          // 轻量备份到 localStorage（无大图时）
          try {
            const light = {
              contacts: payload.contacts.map(c => ({
                ...c,
                chatBgImg: c.chatBgImg && c.chatBgImg.length > 40000 ? null : c.chatBgImg,
                avatarImg: c.avatarImg && c.avatarImg.length > 30000 ? null : c.avatarImg
              })),
              songs: (payload.songs || []).slice(0, 30).map(s => ({
                id: s.id, title: s.title, artist: s.artist, cover: '',
                src: s.src, lrc: '', lrcUrl: s.lrcUrl || '', mode: s.mode, neteaseId: s.neteaseId
              })),
              chats: {},
              userBalance: payload.userBalance,
              theme: payload.theme,
              playMode: payload.playMode,
              _v: 7
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(light));
          } catch (_) { /* 备份失败可忽略 */ }
          return true;
        } catch (e) {
          console.error('save idb fail', e);
          // 回退 localStorage 精简保存
          try {
            const slim = {
              contacts: state.contacts.map(c => {
                const x = { ...c };
                if (x.chatBgImg && x.chatBgImg.length > 60000) x.chatBgImg = null;
                if (x.avatarImg && x.avatarImg.length > 40000) x.avatarImg = null;
                return x;
              }),
              songs: (state.songs || []).map(s => ({
                id: s.id, title: s.title, artist: s.artist, cover: s.cover,
                src: s.src, lrc: '', lrcUrl: s.lrcUrl || '', mode: s.mode, neteaseId: s.neteaseId
              })),
              chats: state.chats,
              userBalance: state.userBalance,
              theme: state.theme,
              playMode: state.playMode || 'order'
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
            return true;
          } catch (e2) {
            console.error('save ls fail', e2);
            if (!saveData._warned) {
              saveData._warned = true;
              alert('存储空间不足，请删除部分歌曲或背景图后再试。聊天消息可能未完整保存。');
            }
            return false;
          }
        }
      });
    }, 120);
    return true;
  }

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const app = $('#app');
  const pageTitle = $('#page-title');
  const btnBack = $('#btn-back');
  const headerAvatar = $('#header-avatar');
  const contactsList = $('#contacts-list');
  const cardsPanel = $('#cards-panel');
  const modalOverlay = $('#modal-overlay');
  const modalTitle = $('#modal-title');
  const modalBody = $('#modal-body');
  const chatList = $('#chat-list');
  const chatListEmpty = $('#chat-list-empty');
  const chatListView = $('#chat-list-view');
  const chatDetailView = $('#chat-detail-view');
  const messageList = $('#message-list');
  const msgInput = $('#msg-input');
  const btnSend = $('#btn-send');
  const btnAttach = $('#btn-attach');
  const attachPanel = $('#attach-panel');
  const quoteBar = $('#quote-bar');
  const quoteBarText = $('#quote-bar-text');
  const msgActionMenu = $('#msg-action-menu');
  const songListEl = $('#song-list');
  const songListEmpty = $('#song-list-empty');
  const listenPage = $('#listen-page');
  const listenAudio = $('#listen-audio');
  const listenCover = $('#listen-cover');
  const listenTitle = $('#listen-title');
  const listenArtist = $('#listen-artist');
  const listenLyricsEl = $('#listen-lyrics');
  const listenPlay = $('#listen-play');
  const listenSeek = $('#listen-seek');
  const listenCur = $('#listen-cur');
  const listenDur = $('#listen-dur');
  const listenToast = $('#listen-toast');
  const listenWithName = $('#listen-with-name');
  const pickOverlay = $('#pick-contact-overlay');
  const pickList = $('#pick-contact-list');

  function applyTheme(name) {
    if (!THEMES.includes(name)) name = 'classic';
    state.theme = name;
    app.setAttribute('data-theme', name);
  }
  function updateThemeUI() {
    $$('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === state.theme));
  }

  function genId(p) { return (p || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
  function truncate(s, n) { return !s ? '' : (s.length > n ? s.slice(0, n) + '…' : s); }
  function formatTime(ts) {
    const d = new Date(ts), now = new Date();
    const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === now.toDateString() ? `${hh}:${mm}` : `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
  }
  function formatSec(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  function randomDelay(a, b) { return a + Math.random() * (b - a); }

  // ===== LRC =====
  function parseLrc(text) {
    if (!text) return [];
    const lines = [];
    String(text).split(/\r?\n/).forEach(line => {
      const m = line.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
      if (m) {
        const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0);
        const txt = m[4].trim();
        if (txt) lines.push({ time: t, text: txt });
      }
    });
    return lines.sort((a, b) => a.time - b.time);
  }

  // ===== Tab =====
  function switchPage(name) {
    $$('.page').forEach(p => p.classList.remove('active'));
    $$('.tab-item').forEach(t => t.classList.remove('active'));
    const page = $(`#page-${name}`);
    const tab = $(`.tab-item[data-page="${name}"]`);
    if (page) page.classList.add('active');
    if (tab) tab.classList.add('active');
    btnBack.classList.add('hidden');
    headerAvatar.classList.add('hidden');
    hideAttachPanel();
    hideMsgMenu();
    if (name === 'chat') {
      if (state.chatContactId) enterChat(state.chatContactId);
      else { pageTitle.textContent = '聊天'; showChatListView(); renderChatList(); }
    } else if (name === 'contacts') {
      pageTitle.textContent = '联系人'; renderContactsList(); renderCardsPanel();
    } else if (name === 'music') {
      pageTitle.textContent = '音乐'; renderSongList();
    } else if (name === 'me') {
      pageTitle.textContent = '我'; updateStats(); updateThemeUI();
      const ub = $('#user-balance'); if (ub) ub.textContent = state.userBalance;
    }
  }

  // ===== Chat (simplified keep core) =====
  function renderAvatarEl(c) {
    if (c.avatarImg) return `<div class="avatar" style="background-image:url(${c.avatarImg})"></div>`;
    return `<div class="avatar" style="background:${c.avatarColor}">${c.name.charAt(0)}</div>`;
  }
  function getPreviewText(msg) {
    if (!msg) return '暂无消息，点击开始聊天';
    if (msg.type === 'system' || msg.type === 'poke') return msg.text;
    if (msg.type === 'transfer') return `[转账] ${msg.amount} 星币`;
    if (msg.type === 'redpacket') return `[红包] ${msg.note || '恭喜发财'}`;
    return (msg.from === 'user' ? '我: ' : '') + (msg.text || '');
  }
  function renderChatList() {
    const items = state.contacts.map(c => {
      const msgs = state.chats[c.id] || [];
      return { contact: c, last: msgs.length ? msgs[msgs.length - 1] : null };
    }).sort((a, b) => (b.last?.time || 0) - (a.last?.time || 0));
    if (!items.length) { chatList.innerHTML = ''; chatListEmpty.classList.remove('hidden'); return; }
    chatListEmpty.classList.add('hidden');
    chatList.innerHTML = items.map(({ contact, last }) => `
      <div class="chat-item" data-id="${contact.id}">
        ${renderAvatarEl(contact)}
        <div class="chat-item-info">
          <div class="chat-item-name">${escapeHtml(contact.name)}</div>
          <div class="chat-item-preview">${escapeHtml(getPreviewText(last))}</div>
        </div>
        <div class="chat-item-time">${last ? formatTime(last.time) : ''}</div>
      </div>`).join('');
    chatList.querySelectorAll('.chat-item').forEach(el => el.addEventListener('click', () => enterChat(el.dataset.id)));
  }
  function showChatListView() {
    chatListView.classList.remove('hidden'); chatDetailView.classList.add('hidden');
    btnBack.classList.add('hidden'); headerAvatar.classList.add('hidden');
    pageTitle.textContent = '聊天'; state.quotingMsg = null; updateQuoteBar();
  }
  function applyContactChatBg(id) {
    const c = state.contacts.find(x => x.id === id);
    if (!c) return;
    // 始终用 cover + center，避免拉伸变形
    messageList.style.backgroundSize = 'cover';
    messageList.style.backgroundPosition = 'center center';
    messageList.style.backgroundRepeat = 'no-repeat';
    if (c.chatBgImg) {
      messageList.style.backgroundImage = `url(${c.chatBgImg})`;
      messageList.style.backgroundColor = '';
    } else if (c.chatBgColor) {
      messageList.style.backgroundImage = '';
      messageList.style.backgroundColor = c.chatBgColor;
    } else {
      messageList.style.backgroundImage = '';
      messageList.style.backgroundColor = '';
    }
  }
  function enterChat(id) {
    const c = state.contacts.find(x => x.id === id); if (!c) return;
    state.chatContactId = id;
    chatListView.classList.add('hidden'); chatDetailView.classList.remove('hidden');
    btnBack.classList.remove('hidden'); pageTitle.textContent = c.name;
    headerAvatar.classList.remove('hidden');
    if (c.avatarImg) { headerAvatar.style.backgroundImage = `url(${c.avatarImg})`; headerAvatar.textContent = ''; }
    else { headerAvatar.style.backgroundImage = ''; headerAvatar.style.background = c.avatarColor; headerAvatar.textContent = c.name.charAt(0); }
    applyContactChatBg(id);
    if (!state.chats[id]) state.chats[id] = [];
    renderMessages(); msgInput.value = ''; hideAttachPanel(); state.quotingMsg = null; updateQuoteBar();
  }
  function leaveChat() {
    clearPendingTimers(); state.chatContactId = null; state.quotingMsg = null;
    showChatListView(); renderChatList();
  }
  function renderMsgBubble(m) {
    if (m.type === 'system' || m.type === 'poke') return `<div class="msg-system">${escapeHtml(m.text)}</div>`;
    if (m.type === 'transfer') return `<div class="msg-bubble msg-transfer"><div class="tf-label">${m.from==='user'?'转账给对方':'收到转账'}</div><div class="tf-amount">${m.amount}<span class="tf-unit"> 星币</span></div>${m.note?`<div class="tf-note">${escapeHtml(m.note)}</div>`:''}</div>`;
    if (m.type === 'redpacket') return `<div class="msg-bubble msg-redpacket"><div class="rp-icon">🧧</div><div class="rp-body"><div class="rp-title">${escapeHtml(m.note||'恭喜发财')}</div><div class="rp-amount">${m.amount} 星币</div></div></div>`;
    let q = '';
    if (m.quote) {
      const qf = m.quote.from === 'user' ? '我' : (state.contacts.find(c=>c.id===state.chatContactId)?.name||'对方');
      q = `<div class="msg-quote"><div class="msg-quote-from">${escapeHtml(qf)}</div><div>${escapeHtml(truncate(m.quote.text||'',40))}</div></div>`;
    }
    return `<div class="msg-bubble">${q}${escapeHtml(m.text||'')}</div>`;
  }
  function renderMessages() {
    const msgs = state.chats[state.chatContactId] || [];
    messageList.innerHTML = msgs.map(m => {
      let cls = m.from; if (m.type==='system'||m.type==='poke') cls='system';
      return `<div class="msg-row ${cls}" data-id="${m.id}">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div></div>`;
    }).join('');
    messageList.querySelectorAll('.msg-row:not(.system)').forEach(bindLongPress);
    requestAnimationFrame(() => { messageList.scrollTop = messageList.scrollHeight; });
  }
  function appendMessage(msg) {
    const typing = messageList.querySelector('.typing-row'); if (typing) typing.remove();
    let cls = msg.from; if (msg.type==='system'||msg.type==='poke') cls='system';
    const row = document.createElement('div');
    row.className = `msg-row ${cls}`; row.dataset.id = msg.id;
    row.innerHTML = `${renderMsgBubble(msg)}<div class="msg-time">${formatTime(msg.time)}</div>`;
    messageList.appendChild(row);
    if (cls !== 'system') bindLongPress(row);
    messageList.scrollTop = messageList.scrollHeight;
  }
  function showTyping() {
    if (messageList.querySelector('.typing-row')) return;
    const row = document.createElement('div');
    row.className = 'msg-row contact typing-row';
    row.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    messageList.appendChild(row); messageList.scrollTop = messageList.scrollHeight;
  }
  function bindLongPress(row) {
    let t = null;
    const start = () => { t = setTimeout(() => {
      const msg = (state.chats[state.chatContactId]||[]).find(m => m.id === row.dataset.id);
      if (msg) { state.longPressMsg = msg; const r = row.getBoundingClientRect();
        msgActionMenu.style.left = Math.min(r.left+20, innerWidth-120)+'px';
        msgActionMenu.style.top = (r.top-48)+'px'; msgActionMenu.classList.remove('hidden'); }
    }, 500); };
    const cancel = () => { if (t) clearTimeout(t); };
    row.addEventListener('touchstart', start, {passive:true});
    row.addEventListener('touchend', cancel); row.addEventListener('touchmove', cancel);
    row.addEventListener('mousedown', start); row.addEventListener('mouseup', cancel); row.addEventListener('mouseleave', cancel);
  }
  function hideMsgMenu() { msgActionMenu.classList.add('hidden'); state.longPressMsg = null; }
  function updateQuoteBar() {
    if (state.quotingMsg) { quoteBarText.textContent = truncate(state.quotingMsg.text||getPreviewText(state.quotingMsg),30); quoteBar.classList.remove('hidden'); }
    else quoteBar.classList.add('hidden');
  }
  function pushMsg(msg) {
    if (!state.chats[state.chatContactId]) state.chats[state.chatContactId] = [];
    state.chats[state.chatContactId].push(msg); saveData();
  }
  function clearPendingTimers() { state.pendingTimers.forEach(clearTimeout); state.pendingTimers = []; }
  function scheduleReplies(contact, forceCount) {
    clearPendingTimers();
    const s = contact.settings || DEFAULT_SETTINGS;
    const maxR = Math.min(3, Math.max(1, s.maxReplies||2));
    const count = forceCount || (Math.floor(Math.random()*maxR)+1);
    if (!contact.cards?.length) return;
    const selected = [];
    for (let i=0;i<count;i++) selected.push(contact.cards[Math.floor(Math.random()*contact.cards.length)]);
    let cum = 0;
    selected.forEach(text => {
      const d = randomDelay(s.minDelay, s.maxDelay); cum += d;
      state.pendingTimers.push(setTimeout(() => { if (state.chatContactId!==contact.id) return; showTyping(); }, Math.max(0,(cum-d*0.6)*1000)));
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId!==contact.id) return;
        const msg = { id:genId('m'), from:'contact', type:'text', text, time:Date.now() };
        pushMsg(msg); appendMessage(msg);
      }, cum*1000));
    });
  }
  function doPoke() {
    const c = state.contacts.find(x => x.id === state.chatContactId); if (!c) return;
    const poke = { id:genId('m'), from:'system', type:'poke', text:`你拍了拍 ${c.name}`, time:Date.now() };
    pushMsg(poke); appendMessage(poke);
    state.pendingTimers.push(setTimeout(() => {
      if (state.chatContactId !== c.id) return;
      if (Math.random() < 0.7) {
        const acts = c.interactionCards?.length ? c.interactionCards : DEFAULT_INTERACTION;
        const back = { id:genId('m'), from:'system', type:'poke', text:`${c.name}${acts[Math.floor(Math.random()*acts.length)]}你`, time:Date.now() };
        pushMsg(back); appendMessage(back);
      }
      scheduleReplies(c, 1);
    }, randomDelay(0.8,2.2)*1000));
  }
  function sendMessage() {
    const text = msgInput.value.trim(); if (!text || !state.chatContactId) return;
    const c = state.contacts.find(x => x.id === state.chatContactId); if (!c) return;
    const msg = { id:genId('m'), from:'user', type: state.quotingMsg?'quote':'text', text, time:Date.now() };
    if (state.quotingMsg) msg.quote = { id:state.quotingMsg.id, from:state.quotingMsg.from, text:state.quotingMsg.text||getPreviewText(state.quotingMsg), type:state.quotingMsg.type };
    pushMsg(msg); appendMessage(msg); msgInput.value=''; state.quotingMsg=null; updateQuoteBar(); hideAttachPanel(); scheduleReplies(c);
  }
  function hideAttachPanel() { attachPanel.classList.add('hidden'); btnAttach.classList.remove('active'); }
  function openMoneyModal(kind) {
    state.modalMode = kind; modalTitle.textContent = kind==='transfer'?'转账':'发红包';
    modalBody.innerHTML = `<div class="form-row"><label>金额（星币）</label><input type="number" id="money-amount" min="1" value="8.88"/></div>
      <div class="form-row"><label>备注</label><input type="text" id="money-note" placeholder="${kind==='redpacket'?'恭喜发财':''}"/></div>`;
    modalOverlay.classList.remove('hidden'); hideAttachPanel();
  }

  // ===== Contacts =====
  function renderContactsList() {
    contactsList.innerHTML = '';
    state.contacts.forEach(c => {
      const item = document.createElement('div');
      item.className = 'contact-item' + (c.id===state.currentContactId?' active':'');
      item.innerHTML = `${renderAvatarEl(c)}<div class="contact-name">${escapeHtml(c.name)}</div>`;
      item.addEventListener('click', () => { state.currentContactId=c.id; renderContactsList(); renderCardsPanel(); });
      contactsList.appendChild(item);
    });
  }
  function renderCardsPanel() {
    const c = state.contacts.find(x => x.id === state.currentContactId);
    if (!c) { cardsPanel.innerHTML = `<div class="empty-state small"><p>选择一位联系人查看字卡库</p></div>`; return; }
    const s = c.settings || DEFAULT_SETTINGS;
    const mk = (text, idx, type) => `<div class="card-item ${type==='interaction'?'interaction':''}"><div class="card-text">${escapeHtml(text)}</div>
      <div class="card-actions"><button class="card-btn edit" data-i="${idx}" data-t="${type}">✎</button><button class="card-btn delete" data-i="${idx}" data-t="${type}">✕</button></div></div>`;
    const favSongs = (c.favorites||[]).map(fid => state.songs.find(s => s.id===fid)).filter(Boolean);
    cardsPanel.innerHTML = `
      <div class="cards-header"><h2>${escapeHtml(c.name)}</h2><button class="btn-settings" id="btn-settings">设置</button></div>
      <div class="settings-summary">回复延迟 <strong>${s.minDelay}~${s.maxDelay}s</strong> · 每次最多 <strong>${s.maxReplies}</strong> 条</div>
      <div class="contact-custom-bar">
        <button class="btn-custom" id="btn-set-avatar">头像</button>
        <button class="btn-custom" id="btn-set-bg">背景</button>
      </div>
      <div class="section-title">普通字卡 <button class="btn-add" id="btn-add-card" style="margin-left:8px">+</button></div>
      <div class="card-list">${(c.cards||[]).map((t,i)=>mk(t,i,'normal')).join('')||'<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">互动字卡 <button class="btn-add" id="btn-add-inter" style="margin-left:8px">+</button></div>
      <div class="card-list">${(c.interactionCards||[]).map((t,i)=>mk(t,i,'interaction')).join('')||'<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">TA 收藏的歌</div>
      <div>${favSongs.map(sg => `<div class="fav-song-item" data-sid="${sg.id}"><div class="song-cover" style="${sg.cover?`background-image:url(${sg.cover})`:''}">${sg.cover?'':'🎵'}</div>
        <div class="song-info"><div class="song-title">${escapeHtml(sg.title)}</div><div class="song-artist">${escapeHtml(sg.artist||'')}</div></div></div>`).join('') || '<div class="empty-state small"><p>暂无收藏</p></div>'}</div>`;
    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add','normal'));
    $('#btn-add-inter')?.addEventListener('click', () => openCardModal('add','interaction'));
    $('#btn-settings')?.addEventListener('click', openSettingsModal);
    $('#btn-set-avatar')?.addEventListener('click', () => $('#file-avatar').click());
    $('#btn-set-bg')?.addEventListener('click', openBgModal);
    cardsPanel.querySelectorAll('.card-btn.edit').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openCardModal('edit', b.dataset.t, +b.dataset.i); }));
    cardsPanel.querySelectorAll('.card-btn.delete').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); if (!confirm('删除？')) return;
      const arr = b.dataset.t==='interaction' ? c.interactionCards : c.cards; arr.splice(+b.dataset.i,1); saveData(); renderCardsPanel();
    }));
    cardsPanel.querySelectorAll('.fav-song-item').forEach(el => el.addEventListener('click', () => {
      openListenWithContact(el.dataset.sid, c.id);
    }));
  }
  function openCardModal(mode, type, index) {
    state.modalMode = mode==='edit'?'card-edit':'card-add'; state.editingCardType=type; state.editingCardIndex=mode==='edit'?index:null;
    modalTitle.textContent = (mode==='edit'?'编辑':'添加') + (type==='interaction'?'互动字卡':'字卡');
    modalBody.innerHTML = `<textarea id="modal-input" rows="3" placeholder="内容"></textarea>`;
    const input = $('#modal-input');
    if (mode==='edit') { const c=state.contacts.find(x=>x.id===state.currentContactId); const arr=type==='interaction'?c.interactionCards:c.cards; input.value=arr[index]||''; }
    modalOverlay.classList.remove('hidden'); input.focus();
  }
  function openSettingsModal() {
    const c = state.contacts.find(x => x.id === state.currentContactId); if (!c) return;
    state.modalMode = 'settings'; modalTitle.textContent = '回复设置';
    const s = c.settings || DEFAULT_SETTINGS;
    const lc = c.listenConfig || DEFAULT_LISTEN;
    modalBody.innerHTML = `
      <div class="form-row"><label>最小延迟(秒)</label><input type="number" id="set-min" step="0.5" value="${s.minDelay}"/></div>
      <div class="form-row"><label>最大延迟(秒)</label><input type="number" id="set-max" step="0.5" value="${s.maxDelay}"/></div>
      <div class="form-row"><label>每次最多回复条数</label><input type="number" id="set-count" min="1" max="3" value="${s.maxReplies}"/></div>
      <div class="form-row"><label>一起听·暂停概率(0~1)</label><input type="number" id="set-pause" step="0.01" min="0" max="1" value="${lc.pauseChance}"/></div>
      <div class="form-row"><label>一起听·收藏概率(0~1)</label><input type="number" id="set-fav" step="0.01" min="0" max="1" value="${lc.favoriteChance}"/></div>
      <div class="form-row"><label>暂停最长秒数</label><input type="number" id="set-pdur" min="1" max="30" value="${lc.pauseDurationMax}"/></div>`;
    modalOverlay.classList.remove('hidden');
  }
  function openBgModal() {
    const c = state.contacts.find(x => x.id === state.currentContactId); if (!c) return;
    state.modalMode = 'chat-bg'; modalTitle.textContent = '聊天背景';
    modalBody.innerHTML = `<div class="form-row"><label>颜色</label><input type="color" id="bg-color" value="${c.chatBgColor||'#141311'}"/></div>
      <div class="form-row"><button class="btn-primary" id="btn-pick-bg-img" style="width:100%">上传背景图</button></div>`;
    modalOverlay.classList.remove('hidden');
    $('#btn-pick-bg-img')?.addEventListener('click', () => $('#file-bg').click());
  }

  // ===== Music library =====
  function renderSongList() {
    if (!state.songs.length) { songListEl.innerHTML=''; songListEmpty.classList.remove('hidden'); return; }
    songListEmpty.classList.add('hidden');
    songListEl.innerHTML = state.songs.map(sg => `
      <div class="song-item" data-id="${sg.id}">
        <div class="song-cover" style="${sg.cover?`background-image:url(${sg.cover})`:''}">${sg.cover?'':'🎵'}</div>
        <div class="song-info">
          <div class="song-title">${escapeHtml(sg.title)}</div>
          <div class="song-artist">${escapeHtml(sg.artist||'未知歌手')}</div>
          <div class="song-mode">${sg.mode==='direct'?'直链':'嵌入'} ${sg.src?'· 可播放':'· 无音频源'}</div>
        </div>
        <div class="song-actions">
          <button class="song-btn" data-act="listen" data-id="${sg.id}">一起听</button>
          <button class="song-btn danger" data-act="del" data-id="${sg.id}">删</button>
        </div>
      </div>`).join('');
    songListEl.querySelectorAll('[data-act="listen"]').forEach(b => b.addEventListener('click', () => openPickContact(b.dataset.id)));
    songListEl.querySelectorAll('[data-act="del"]').forEach(b => b.addEventListener('click', () => {
      if (!confirm('确定删除这首歌？')) return;
      state.songs = state.songs.filter(s => s.id !== b.dataset.id);
      state.contacts.forEach(c => { if (c.favorites) c.favorites = c.favorites.filter(id => id !== b.dataset.id); });
      saveData(); renderSongList(); updateStats();
    }));
  }

  const METING = 'https://api.injahow.cn/meting/';

  function parseNeteaseResource(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();
    // 歌单
    let m = str.match(/playlist\?id=(\d+)/i) || str.match(/\/playlist\/(\d+)/i);
    if (m) return { kind: 'playlist', id: m[1] };
    if (/playlist|歌单/i.test(str)) {
      m = str.match(/[?&#]id=(\d+)/i);
      if (m) return { kind: 'playlist', id: m[1] };
    }
    // 单曲
    m = str.match(/song\?id=(\d+)/i) || str.match(/\/song\/(\d+)/i);
    if (m) return { kind: 'song', id: m[1] };
    if (/song|单曲/i.test(str)) {
      m = str.match(/[?&#]id=(\d+)/i);
      if (m) return { kind: 'song', id: m[1] };
    }
    // 纯数字
    m = str.match(/^\s*(\d{5,})\s*$/);
    if (m) return { kind: 'song', id: m[1] };
    m = str.match(/[?&#]id=(\d{5,})/i);
    if (m) return { kind: 'song', id: m[1] };
    return null;
  }

  async function fetchMeting(type, id) {
    const url = `${METING}?server=netease&type=${type}&id=${encodeURIComponent(id)}&r=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('接口请求失败 ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (type === 'lrc') return await res.text();
    return await res.json();
  }

  function metingItemToSong(item) {
    // 导入时不拉取整份歌词，避免撑爆 localStorage；播放时再按需获取
    let nid = '';
    const um = (item.url || '').match(/[?&]id=(\d+)/);
    if (um) nid = um[1];
    let lrcUrl = '';
    if (item.lrc && /^https?:\/\//i.test(item.lrc)) lrcUrl = item.lrc;
    else if (nid) lrcUrl = `${METING}?server=netease&type=lrc&id=${nid}`;
    return {
      id: genId('song'),
      title: item.name || '未知歌曲',
      artist: item.artist || '未知歌手',
      cover: item.pic || '',
      src: item.url || '',
      lrc: '',
      lrcUrl,
      mode: 'direct',
      neteaseId: nid
    };
  }

  async function ensureSongLrc(song) {
    if (!song) return '';
    if (song.lrc && song.lrc.length > 10) return song.lrc;
    if (!song.lrcUrl && !song.neteaseId) return '';
    const url = song.lrcUrl || `${METING}?server=netease&type=lrc&id=${song.neteaseId}`;
    try {
      const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'r=' + Date.now());
      const text = await r.text();
      if (text && !text.startsWith('<')) {
        song.lrc = text.length > 12000 ? text.slice(0, 12000) : text;
        // 不强制立刻 save，避免频繁写盘
        return song.lrc;
      }
    } catch (_) {}
    return '';
  }

  function openImportSong() {
    state.modalMode = 'import-song';
    modalTitle.textContent = '导入歌曲 / 歌单';
    modalBody.innerHTML = `
      <div class="form-row">
        <label>网易云单曲或歌单链接</label>
        <input type="text" id="imp-link" placeholder="粘贴 https://music.163.com/playlist?id=... 或 song?id=..."/>
      </div>
      <div class="form-row" style="font-size:12px;color:var(--muted);line-height:1.5">
        粘贴链接后点确定，将自动获取歌名、歌手、封面、歌词与试听地址。<br/>
        歌单会批量导入（最多 500 首，已存在的会跳过）。歌词在播放时按需加载。
      </div>
      <div id="imp-status" style="font-size:13px;color:var(--accent);min-height:1.2em"></div>`;
    modalOverlay.classList.remove('hidden');
    $('#imp-link')?.focus();
  }

  async function confirmImportSong() {
    const link = ($('#imp-link')?.value || '').trim();
    const statusEl = $('#imp-status');
    if (!link) { alert('请粘贴链接'); return; }

    // 也支持纯音频直链手动兜底
    if (/\.(mp3|m4a|flac|ogg|wav)(\?|$)/i.test(link) || /^https?:\/\/.+\.(mp3|m4a)/i.test(link)) {
      const name = decodeURIComponent((link.split('/').pop() || '直链音频').split('?')[0].replace(/\.\w+$/, '')) || '直链音频';
      state.songs.unshift({ id: genId('song'), title: name, artist: '本地直链', cover: '', src: link, lrc: '', mode: 'direct' });
      saveData(); renderSongList(); updateStats(); closeModal();
      return;
    }

    const res = parseNeteaseResource(link);
    if (!res) {
      alert('无法识别链接。请使用：\nhttps://music.163.com/song?id=xxx\nhttps://music.163.com/playlist?id=xxx');
      return;
    }

    const confirmBtn = $('#modal-confirm');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '导入中…'; }
    if (statusEl) statusEl.textContent = '正在获取…';

    try {
      if (res.kind === 'song') {
        if (statusEl) statusEl.textContent = '正在获取单曲信息…';
        const data = await fetchMeting('song', res.id);
        const item = Array.isArray(data) ? data[0] : data;
        if (!item || !item.name) throw new Error('未找到该歌曲');
        // 去重
        if (state.songs.some(s => s.neteaseId === String(res.id))) {
          alert('曲库中已有该歌曲');
        } else {
          const song = metingItemToSong(item);
          song.neteaseId = String(res.id);
          state.songs.unshift(song);
          saveData();
          renderSongList();
          updateStats();
          alert('已导入：' + song.title);
        }
        closeModal();
      } else {
        if (statusEl) statusEl.textContent = '正在获取歌单…';
        const data = await fetchMeting('playlist', res.id);
        if (!Array.isArray(data) || !data.length) throw new Error('歌单为空或获取失败');
        const limit = Math.min(data.length, 500);
        let added = 0, skipped = 0;
        for (let i = 0; i < limit; i++) {
          const item = data[i];
          if (statusEl) statusEl.textContent = `导入中 ${i + 1}/${limit}：${item.name || ''}`;
          let nid = '';
          const um = (item.url || '').match(/[?&]id=(\d+)/);
          if (um) nid = um[1];
          if (nid && state.songs.some(s => s.neteaseId === nid)) { skipped++; continue; }
          try {
            const song = metingItemToSong(item);
            if (nid) song.neteaseId = nid;
            state.songs.push(song);
            added++;
          } catch (_) { skipped++; }
        }
        saveData();
        renderSongList();
        updateStats();
        alert(`歌单导入完成\n新增 ${added} 首，跳过 ${skipped} 首`);
        closeModal();
      }
    } catch (err) {
      console.error(err);
      alert('导入失败：' + (err.message || '网络错误，请稍后重试'));
      if (statusEl) statusEl.textContent = '';
    } finally {
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确定'; }
    }
  }

  // ===== 一起听 =====
  function openPickContact(songId) {
    state.pendingSong = songId;
    pickList.innerHTML = state.contacts.map(c => `
      <div class="pick-contact-item" data-id="${c.id}">
        ${renderAvatarEl(c)}
        <span>${escapeHtml(c.name)}</span>
      </div>`).join('');
    pickList.querySelectorAll('.pick-contact-item').forEach(el => {
      el.addEventListener('click', () => {
        pickOverlay.classList.add('hidden');
        openListenWithContact(state.pendingSong, el.dataset.id);
      });
    });
    pickOverlay.classList.remove('hidden');
  }

  const PLAY_MODE_LABEL = { order: '顺序', random: '随机', loop: '列表循环', one: '单曲循环' };

  function openListenWithContact(songId, contactId) {
    const song = state.songs.find(s => s.id === songId);
    const contact = state.contacts.find(c => c.id === contactId);
    if (!song || !contact) return;
    state.listenContactId = contactId;
    // 队列：当前曲库全部（有 src 的优先）
    state.listenQueue = state.songs.map(s => s.id);
    state.listenIndex = Math.max(0, state.listenQueue.indexOf(songId));
    if (state.listenIndex < 0) {
      state.listenQueue.unshift(songId);
      state.listenIndex = 0;
    }
    listenWithName.textContent = `和 ${contact.name} 一起听`;
    updatePlayModeBtn();
    loadListenTrack(songId, true);
    listenPage.classList.remove('hidden');
    hideFloatPlayer();
    startListenSimulation();
  }

  async function loadListenTrack(songId, autoplay) {
    const song = state.songs.find(s => s.id === songId);
    if (!song) return;
    state.listenSongId = songId;
    listenTitle.textContent = song.title;
    listenArtist.textContent = song.artist || '';
    if (song.cover) { listenCover.style.backgroundImage = `url(${song.cover})`; listenCover.textContent = ''; }
    else { listenCover.style.backgroundImage = ''; listenCover.textContent = '🎵'; }
    updateFloatUI(song);
    listenLyricsEl.innerHTML = '<div class="lyric-line">加载歌词中…</div>';
    const lrcText = await ensureSongLrc(song);
    state.listenLyrics = parseLrc(lrcText);
    state.listenLyricIdx = -1;
    renderListenLyrics();
    listenAudio.src = song.src || '';
    listenAudio.load();
    listenSeek.value = 0; listenCur.textContent = '0:00'; listenDur.textContent = '0:00';
    listenCover.classList.remove('spinning');
    listenPlay.textContent = '▶';
    if (autoplay && song.src) {
      listenAudio.play().then(() => {
        listenPlay.textContent = '⏸';
        listenCover.classList.add('spinning');
        updateFloatPlaying(true);
      }).catch(() => showListenToast('播放失败，可尝试换一首'));
    }
  }

  function pickNextIndex(dir) {
    const n = state.listenQueue.length;
    if (!n) return -1;
    const mode = state.playMode || 'order';
    if (mode === 'one' && dir === 1) return state.listenIndex;
    if (mode === 'random') {
      if (n === 1) return 0;
      let i = state.listenIndex;
      while (i === state.listenIndex) i = Math.floor(Math.random() * n);
      return i;
    }
    // order / loop
    let next = state.listenIndex + dir;
    if (mode === 'loop' || mode === 'order') {
      if (next >= n) next = mode === 'loop' ? 0 : -1;
      if (next < 0) next = mode === 'loop' ? n - 1 : -1;
    }
    return next;
  }

  function playNext(dir) {
    const next = pickNextIndex(dir || 1);
    if (next < 0) {
      listenPlay.textContent = '▶';
      listenCover.classList.remove('spinning');
      updateFloatPlaying(false);
      showListenToast('列表已播完');
      return;
    }
    state.listenIndex = next;
    loadListenTrack(state.listenQueue[next], true);
  }

  function cyclePlayMode() {
    const modes = ['order', 'random', 'loop', 'one'];
    const i = modes.indexOf(state.playMode || 'order');
    state.playMode = modes[(i + 1) % modes.length];
    saveData();
    updatePlayModeBtn();
    showListenToast('播放模式：' + PLAY_MODE_LABEL[state.playMode]);
  }

  function updatePlayModeBtn() {
    const btn = $('#listen-mode');
    if (btn) btn.textContent = PLAY_MODE_LABEL[state.playMode || 'order'] || '顺序';
  }

  function minimizeListenPage() {
    // 收起到悬浮窗，不停止播放
    stopListenSimulation();
    listenPage.classList.add('hidden');
    showFloatPlayer();
    state.floatVisible = true;
  }

  function closeListenPage() {
    stopListenSimulation();
    listenAudio.pause();
    listenAudio.removeAttribute('src');
    listenCover.classList.remove('spinning');
    listenPage.classList.add('hidden');
    hideFloatPlayer();
    state.listenSongId = null;
    state.listenContactId = null;
    state.floatVisible = false;
    updateFloatPlaying(false);
  }

  function showFloatPlayer() {
    const el = $('#float-player');
    if (el) el.classList.remove('hidden');
  }
  function hideFloatPlayer() {
    const el = $('#float-player');
    if (el) el.classList.add('hidden');
  }
  function updateFloatUI(song) {
    const t = $('#float-title');
    const a = $('#float-artist');
    const c = $('#float-cover');
    if (t) t.textContent = song ? song.title : '';
    if (a) a.textContent = song ? (song.artist || '') : '';
    if (c) {
      if (song && song.cover) { c.style.backgroundImage = `url(${song.cover})`; c.textContent = ''; }
      else { c.style.backgroundImage = ''; c.textContent = '🎵'; }
    }
  }
  function updateFloatPlaying(playing) {
    const btn = $('#float-play');
    if (btn) btn.textContent = playing ? '⏸' : '▶';
  }

  function renderListenLyrics() {
    if (!state.listenLyrics.length) {
      listenLyricsEl.innerHTML = '<div class="lyric-line">暂无歌词</div>'; return;
    }
    listenLyricsEl.innerHTML = state.listenLyrics.map((l, i) =>
      `<div class="lyric-line" data-i="${i}">${escapeHtml(l.text)}</div>`).join('');
  }

  function syncLyrics(t) {
    if (!state.listenLyrics.length) return;
    let idx = -1;
    for (let i = 0; i < state.listenLyrics.length; i++) {
      if (state.listenLyrics[i].time <= t) idx = i; else break;
    }
    if (idx === state.listenLyricIdx) return;
    state.listenLyricIdx = idx;
    listenLyricsEl.querySelectorAll('.lyric-line').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
    const active = listenLyricsEl.querySelector('.lyric-line.active');
    if (active) {
      const wrap = listenLyricsEl.parentElement;
      const top = active.offsetTop - wrap.clientHeight / 2 + active.clientHeight / 2;
      listenLyricsEl.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  function showListenToast(text) {
    listenToast.textContent = text;
    listenToast.classList.remove('hidden');
    clearTimeout(showListenToast._t);
    showListenToast._t = setTimeout(() => listenToast.classList.add('hidden'), 2200);
  }

  function startListenSimulation() {
    stopListenSimulation();
    const contact = state.contacts.find(c => c.id === state.listenContactId);
    if (!contact) return;
    const cfg = contact.listenConfig || DEFAULT_LISTEN;
    state.listenInterval = setInterval(() => {
      if (listenAudio.paused) return;
      const r = Math.random();
      if (r < cfg.pauseChance) {
        listenAudio.pause();
        listenPlay.textContent = '▶';
        listenCover.classList.remove('spinning');
        updateFloatPlaying(false);
        showListenToast(`${contact.name} 暂停了播放`);
        const dur = (1 + Math.random() * Math.max(1, (cfg.pauseDurationMax || 6) - 1)) * 1000;
        setTimeout(() => {
          if (!state.listenContactId) return;
          listenAudio.play().catch(() => {});
          listenPlay.textContent = '⏸';
          listenCover.classList.add('spinning');
          updateFloatPlaying(true);
          showListenToast('继续播放');
        }, dur);
      } else if (r < cfg.pauseChance + cfg.favoriteChance) {
        if (!contact.favorites) contact.favorites = [];
        if (state.listenSongId && !contact.favorites.includes(state.listenSongId)) {
          contact.favorites.push(state.listenSongId);
          saveData();
        }
        showListenToast(`${contact.name} 收藏了这首歌`);
      }
    }, 3000 + Math.random() * 2000);
  }

  function stopListenSimulation() {
    if (state.listenInterval) { clearInterval(state.listenInterval); state.listenInterval = null; }
  }

  function togglePlay() {
    if (!listenAudio.src) { showListenToast('该歌曲没有可播放的音频直链'); return; }
    if (listenAudio.paused) {
      listenAudio.play().then(() => {
        listenPlay.textContent = '⏸';
        listenCover.classList.add('spinning');
        updateFloatPlaying(true);
      }).catch(() => showListenToast('播放失败，请检查音频链接'));
    } else {
      listenAudio.pause();
      listenPlay.textContent = '▶';
      listenCover.classList.remove('spinning');
      updateFloatPlaying(false);
    }
  }

  // ===== Modal confirm =====
  function closeModal() { modalOverlay.classList.add('hidden'); state.modalMode = null; }
  function confirmModal() {
    if (state.modalMode === 'import-song') { confirmImportSong(); return; }
    if (state.modalMode === 'transfer' || state.modalMode === 'redpacket') {
      const amount = parseFloat($('#money-amount')?.value)||0;
      const note = ($('#money-note')?.value||'').trim();
      if (amount<=0) { alert('金额无效'); return; }
      const msg = { id:genId('m'), from:'user', type:state.modalMode, text:'', amount, note: note||(state.modalMode==='redpacket'?'恭喜发财':''), time:Date.now() };
      if (state.userBalance >= amount) { state.userBalance = Math.round((state.userBalance-amount)*100)/100; }
      pushMsg(msg); appendMessage(msg); saveData(); closeModal();
      const c = state.contacts.find(x=>x.id===state.chatContactId);
      if (c) scheduleReplies(c,1);
      return;
    }
    if (state.modalMode === 'balance') {
      const v = parseFloat($('#set-balance')?.value);
      if (!isNaN(v)&&v>=0) { state.userBalance=Math.round(v*100)/100; saveData(); const ub=$('#user-balance'); if(ub) ub.textContent=state.userBalance; }
      closeModal(); return;
    }
    if (state.modalMode === 'chat-bg') {
      const c = state.contacts.find(x=>x.id===state.currentContactId);
      if (c) { c.chatBgColor = $('#bg-color')?.value||null; c.chatBgImg=null; saveData(); if(state.chatContactId===c.id) applyContactChatBg(c.id); }
      closeModal(); return;
    }
    if (state.modalMode === 'settings') {
      const c = state.contacts.find(x=>x.id===state.currentContactId); if(!c) return;
      let min=parseFloat($('#set-min').value)||1.5, max=parseFloat($('#set-max').value)||4, count=parseInt($('#set-count').value,10)||2;
      min=Math.max(0.5,Math.min(30,min)); max=Math.max(min,Math.min(60,max)); count=Math.max(1,Math.min(3,count));
      c.settings = { minDelay:min, maxDelay:max, maxReplies:count };
      const pc=parseFloat($('#set-pause')?.value), fc=parseFloat($('#set-fav')?.value), pd=parseFloat($('#set-pdur')?.value);
      c.listenConfig = {
        pauseChance: isNaN(pc)?0.18:Math.max(0,Math.min(1,pc)),
        favoriteChance: isNaN(fc)?0.12:Math.max(0,Math.min(1,fc)),
        pauseDurationMax: isNaN(pd)?6:Math.max(1,Math.min(30,pd))
      };
      saveData(); renderCardsPanel(); closeModal(); return;
    }
    if (state.modalMode === 'card-add' || state.modalMode === 'card-edit') {
      const text = ($('#modal-input')?.value||'').trim(); if(!text){alert('不能为空');return;}
      const c = state.contacts.find(x=>x.id===state.currentContactId); if(!c) return;
      const arr = state.editingCardType==='interaction' ? (c.interactionCards||(c.interactionCards=[])) : c.cards;
      if (state.modalMode==='card-add') arr.push(text); else arr[state.editingCardIndex]=text;
      saveData(); renderCardsPanel(); closeModal();
    }
  }

  function updateStats() {
    const sc=$('#stat-contacts'), sk=$('#stat-cards'), ss=$('#stat-songs');
    if (sc) sc.textContent = state.contacts.length;
    if (sk) sk.textContent = state.contacts.reduce((n,c)=>n+(c.cards?.length||0)+(c.interactionCards?.length||0),0);
    if (ss) ss.textContent = state.songs.length;
  }

  /** 压缩图片：保持原始比例缩小，展示端用 CSS background-size:cover */
  function compressImage(file, maxSize = 720, q = 0.72) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const maxEdge = Math.max(w, h);
          if (maxEdge > maxSize) {
            const scale = maxSize / maxEdge;
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', q));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function resetToDefault() {
    if (!confirm('确定重置全部数据？')) return;
    clearPendingTimers(); stopListenSimulation(); closeListenPage();
    const d = { contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)), songs: JSON.parse(JSON.stringify(DEFAULT_SONGS)), chats:{}, userBalance:888, theme:'classic' };
    state.contacts=d.contacts; state.songs=d.songs; state.chats={}; state.userBalance=888; state.theme='classic';
    state.currentContactId=null; state.chatContactId=null;
    applyTheme('classic'); saveData();
    renderContactsList(); renderCardsPanel(); renderChatList(); showChatListView(); renderSongList(); updateStats(); updateThemeUI();
  }

  async function init() {
    const data = await loadDataAsync();
    state.contacts = data.contacts; state.songs = data.songs; state.chats = data.chats;
    state.userBalance = data.userBalance; state.theme = data.theme;
    state.playMode = data.playMode || 'order';
    applyTheme(state.theme);

    $$('.tab-item').forEach(t => t.addEventListener('click', () => switchPage(t.dataset.page)));
    btnBack.addEventListener('click', leaveChat);

    let lastTap=0;
    headerAvatar.addEventListener('click', () => {
      const now=Date.now(); if(now-lastTap<350){ doPoke(); lastTap=0; } else lastTap=now;
    });

    $('#modal-cancel').addEventListener('click', closeModal);
    $('#modal-confirm').addEventListener('click', confirmModal);
    modalOverlay.addEventListener('click', e => { if (e.target===modalOverlay) closeModal(); });
    $('#btn-reset-data').addEventListener('click', resetToDefault);
    $('#btn-edit-balance')?.addEventListener('click', () => {
      state.modalMode='balance'; modalTitle.textContent='修改星币';
      modalBody.innerHTML=`<div class="form-row"><label>数量</label><input type="number" id="set-balance" value="${state.userBalance}"/></div>`;
      modalOverlay.classList.remove('hidden');
    });
    $('#theme-grid')?.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => { applyTheme(card.dataset.theme); saveData(); updateThemeUI(); });
    });

    $('#file-avatar').addEventListener('change', async e => {
      const f=e.target.files?.[0]; e.target.value='';
      const c=state.contacts.find(x=>x.id===state.currentContactId); if(!c||!f) return;
      try {
        c.avatarImg = await compressImage(f, 200, 0.65);
        if (!saveData()) alert('头像已设置，但存储空间不足，刷新后可能丢失');
        renderContactsList(); renderCardsPanel();
        if (state.chatContactId === c.id) enterChat(c.id);
      } catch(_){ alert('图片失败'); }
    });
    $('#file-bg').addEventListener('change', async e => {
      const f=e.target.files?.[0]; e.target.value='';
      const c=state.contacts.find(x=>x.id===state.currentContactId); if(!c||!f) return;
      try {
        // 居中裁剪 + 较强压缩，避免比例失衡与存储溢出
        c.chatBgImg = await compressImage(f, 900, 0.7);
        c.chatBgColor = null;
        if (!saveData()) alert('背景已应用，但存储空间不足，建议删除部分歌曲后再保存');
        closeModal();
        if (state.chatContactId === c.id) applyContactChatBg(c.id);
      } catch(_){ alert('图片失败'); }
    });

    btnSend.addEventListener('click', sendMessage);
    msgInput.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});
    btnAttach.addEventListener('click', () => {
      if (attachPanel.classList.contains('hidden')) { attachPanel.classList.remove('hidden'); btnAttach.classList.add('active'); }
      else hideAttachPanel();
    });
    attachPanel.querySelectorAll('.attach-btn').forEach(b => b.addEventListener('click', () => openMoneyModal(b.dataset.action)));
    $('#quote-bar-close').addEventListener('click', () => { state.quotingMsg=null; updateQuoteBar(); });
    msgActionMenu.querySelector('[data-action="quote"]').addEventListener('click', () => {
      if (state.longPressMsg) { state.quotingMsg=state.longPressMsg; updateQuoteBar(); hideMsgMenu(); msgInput.focus(); }
    });
    document.addEventListener('click', e => { if (!msgActionMenu.contains(e.target)) hideMsgMenu(); });

    // 音乐
    $('#btn-import-song').addEventListener('click', openImportSong);
    $('#pick-contact-cancel').addEventListener('click', () => pickOverlay.classList.add('hidden'));
    $('#listen-back').addEventListener('click', () => {
      // 有在播内容则收起为悬浮窗，否则直接关闭
      if (state.listenSongId && listenAudio.src) minimizeListenPage();
      else closeListenPage();
    });
    listenPlay.addEventListener('click', togglePlay);
    $('#listen-prev')?.addEventListener('click', () => playNext(-1));
    $('#listen-next')?.addEventListener('click', () => playNext(1));
    $('#listen-mode')?.addEventListener('click', cyclePlayMode);
    $('#listen-mini')?.addEventListener('click', minimizeListenPage);
    $('#float-play')?.addEventListener('click', togglePlay);
    $('#float-expand')?.addEventListener('click', () => {
      hideFloatPlayer();
      listenPage.classList.remove('hidden');
      if (state.listenContactId) startListenSimulation();
    });
    $('#float-close')?.addEventListener('click', closeListenPage);
    listenAudio.addEventListener('timeupdate', () => {
      if (!listenAudio.duration) return;
      listenSeek.value = (listenAudio.currentTime / listenAudio.duration) * 100;
      listenCur.textContent = formatSec(listenAudio.currentTime);
      syncLyrics(listenAudio.currentTime);
    });
    listenAudio.addEventListener('loadedmetadata', () => { listenDur.textContent = formatSec(listenAudio.duration); });
    listenAudio.addEventListener('ended', () => {
      // 按播放模式自动下一首 / 单曲循环
      playNext(1);
    });
    listenSeek.addEventListener('input', () => {
      if (!listenAudio.duration) return;
      listenAudio.currentTime = (listenSeek.value / 100) * listenAudio.duration;
    });

    switchPage('chat');
    updateStats();
    updateThemeUI();
    updatePlayModeBtn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
