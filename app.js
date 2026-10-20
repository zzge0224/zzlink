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
  const DEFAULT_LISTEN = {
    pauseChance: 0.18,
    favoriteChance: 0.12,
    pauseDurationMax: 6,
    momentsChance: 0.15,
    replyChance: 0.92,
    readNoReplyChance: 0.08,
    pokeChance: 0.1,
    // 每隔多少分钟主动给用户发一条消息；0 表示关闭
    proactiveIntervalMin: 30
  };
  const THEMES = [
    'classic', 'dark', 'seasalt', 'mintchoc', 'taro', 'peach',
    'yuzu', 'algae', 'lavender', 'cream', 'rose', 'ocean'
  ];

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

  const DEFAULT_STATUSES = ['在线', '忙碌', '睡觉', '听歌中'];

  let state = {
    contacts: [], songs: [], chats: {}, stickers: [], moments: [], memorials: [],
    userBalance: 888, theme: 'classic', userAvatar: null, userName: '昕',
    currentContactId: null, chatContactId: null,
    editingCardIndex: null, editingCardType: 'normal', editingGroup: '默认', modalMode: null,
    pendingTimers: [], quotingMsg: null, longPressMsg: null,
    playMode: 'order',
    listenSongId: null, listenContactId: null, listenInterval: null,
    listenLyrics: [], listenLyricIdx: -1, pendingSong: null,
    listenQueue: [], listenIndex: 0, floatVisible: false,
    statusTimer: null, proactiveTimer: null, activeCardGroup: '默认',
    lastProactiveAt: {}
  };

  function ensureContactShape(c) {
    if (!c.settings) c.settings = { ...DEFAULT_SETTINGS };
    if (!c.interactionCards) c.interactionCards = [...DEFAULT_INTERACTION];
    if (!c.favorites) c.favorites = [];
    if (!c.listenConfig) c.listenConfig = { ...DEFAULT_LISTEN };
    else {
      c.listenConfig = Object.assign({}, DEFAULT_LISTEN, c.listenConfig);
      if (c.listenConfig.proactiveIntervalMin == null) {
        c.listenConfig.proactiveIntervalMin = c.listenConfig.proactiveMsgChance > 0 ? 30 : 0;
      }
    }
    if (c.avatarImg === undefined) c.avatarImg = null;
    if (c.chatBgImg === undefined) c.chatBgImg = null;
    if (c.chatBgColor === undefined) c.chatBgColor = null;
    // 字卡分组：旧版 cards[] 迁移到 cardGroups
    if (!c.cardGroups || typeof c.cardGroups !== 'object') {
      c.cardGroups = { '默认': Array.isArray(c.cards) ? c.cards.slice() : [] };
    }
    if (!Array.isArray(c.cards)) c.cards = Object.values(c.cardGroups).flat();
    if (!Array.isArray(c.statuses) || !c.statuses.length) c.statuses = DEFAULT_STATUSES.slice();
    if (!c.currentStatus) c.currentStatus = c.statuses[0];
    return c;
  }

  function normalizeLoaded(p) {
    if (!p || !Array.isArray(p.contacts) || !p.contacts.length) {
      return {
        contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)).map(ensureContactShape),
        songs: JSON.parse(JSON.stringify(DEFAULT_SONGS)),
        chats: {}, stickers: [], moments: [],
        userBalance: 888, theme: 'classic', playMode: 'order'
      };
    }
    p.contacts.forEach(ensureContactShape);
    return {
      contacts: p.contacts,
      songs: Array.isArray(p.songs) ? p.songs : JSON.parse(JSON.stringify(DEFAULT_SONGS)),
      chats: p.chats || {},
      stickers: Array.isArray(p.stickers) ? p.stickers : [],
      moments: Array.isArray(p.moments) ? p.moments : [],
      memorials: Array.isArray(p.memorials) ? p.memorials : [],
      userBalance: typeof p.userBalance === 'number' ? p.userBalance : 888,
      theme: THEMES.includes(p.theme) ? p.theme : 'classic',
      playMode: p.playMode || 'order',
      userAvatar: p.userAvatar || null,
      userName: p.userName || '昕',
      lastProactiveAt: p.lastProactiveAt || {},
      momentsCover: p.momentsCover || null
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
    // 同步 cards 扁平数组方便旧逻辑
    (state.contacts || []).forEach(c => {
      if (c.cardGroups) c.cards = Object.values(c.cardGroups).flat();
    });
    return {
      contacts: state.contacts,
      songs,
      chats,
      stickers: state.stickers || [],
      moments: (state.moments || []).slice(-100),
      memorials: state.memorials || [],
      userBalance: state.userBalance,
      theme: state.theme,
      playMode: state.playMode || 'order',
      userAvatar: state.userAvatar || null,
      userName: state.userName || '昕',
      lastProactiveAt: state.lastProactiveAt || {},
      momentsCover: state.momentsCover || null,
      _v: 11
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
    $('#btn-chat-more')?.classList.add('hidden');
    hideAttachPanel();
    hideMsgMenu();
    // 互动页子视图重置
    $('#music-subpage')?.classList.add('hidden');
    $('#memorial-subpage')?.classList.add('hidden');
    document.querySelector('.discover-list')?.classList.remove('hidden');
    if (name === 'chat') {
      if (state.chatContactId) enterChat(state.chatContactId);
      else { pageTitle.textContent = '聊天'; showChatListView(); renderChatList(); }
    } else if (name === 'contacts') {
      pageTitle.textContent = '联系人'; renderContactsList(); renderCardsPanel();
    } else if (name === 'interact') {
      pageTitle.textContent = '互动';
      document.querySelector('.discover-list')?.classList.remove('hidden');
      $('#music-subpage')?.classList.add('hidden');
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
    if (msg.type === 'sticker') return '[表情]';
    if (msg.type === 'image') return '[图片]';
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
    $('#btn-chat-more')?.classList.add('hidden');
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
    btnBack.classList.remove('hidden');
    const st = c.currentStatus ? ` · ${c.currentStatus}` : '';
    pageTitle.innerHTML = `${escapeHtml(c.name)}<span class="header-status">${escapeHtml(st)}</span>`;
    headerAvatar.classList.remove('hidden');
    if (c.avatarImg) { headerAvatar.style.backgroundImage = `url(${c.avatarImg})`; headerAvatar.textContent = ''; }
    else { headerAvatar.style.backgroundImage = ''; headerAvatar.style.background = c.avatarColor; headerAvatar.textContent = c.name.charAt(0); }
    applyContactChatBg(id);
    if (!state.chats[id]) state.chats[id] = [];
    renderMessages(); msgInput.value = ''; hideAttachPanel(); hideStickerPanel(); state.quotingMsg = null; updateQuoteBar();
    $('#btn-chat-more')?.classList.remove('hidden');
    updateChatPinMemorial(id);
  }
  function leaveChat() {
    clearPendingTimers(); state.chatContactId = null; state.quotingMsg = null;
    $('#btn-chat-more')?.classList.add('hidden');
    const pin = $('#chat-pin-memorial');
    if (pin) { pin.classList.add('hidden'); pin.textContent = ''; }
    showChatListView(); renderChatList();
  }

  function openChatSettings() {
    const c = state.contacts.find(x => x.id === state.chatContactId);
    if (!c) return;
    ensureContactShape(c);
    const s = c.settings || DEFAULT_SETTINGS;
    const lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
    const body = $('#chat-settings-body');
    const page = $('#chat-settings-page');
    if (!body || !page) return;
    body.innerHTML = `
      <div class="settings-section-title">资料</div>
      <div class="settings-cell" id="cs-avatar"><span>设置头像</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-bg"><span>设置聊天背景</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-status"><span>状态</span><span class="val">${escapeHtml(c.currentStatus || '')} ›</span></div>
      <div class="settings-section-title">回复</div>
      <div class="settings-cell"><span>最小延迟(秒)</span><input type="number" id="cs-min" step="0.5" value="${s.minDelay}"/></div>
      <div class="settings-cell"><span>最大延迟(秒)</span><input type="number" id="cs-max" step="0.5" value="${s.maxDelay}"/></div>
      <div class="settings-cell"><span>每次最多回复条数</span><input type="number" id="cs-count" min="1" max="3" value="${s.maxReplies}"/></div>
      <div class="settings-cell"><span>回复概率</span><input type="number" id="cs-reply" step="0.01" min="0" max="1" value="${lc.replyChance}"/></div>
      <div class="settings-cell"><span>已读不回概率</span><input type="number" id="cs-noreply" step="0.01" min="0" max="1" value="${lc.readNoReplyChance}"/></div>
      <div class="settings-section-title">互动概率</div>
      <div class="settings-cell"><span>一起听·暂停概率</span><input type="number" id="cs-pause" step="0.01" min="0" max="1" value="${lc.pauseChance}"/></div>
      <div class="settings-cell"><span>一起听·收藏概率</span><input type="number" id="cs-fav" step="0.01" min="0" max="1" value="${lc.favoriteChance}"/></div>
      <div class="settings-cell"><span>暂停最长秒数</span><input type="number" id="cs-pdur" min="1" max="30" value="${lc.pauseDurationMax}"/></div>
      <div class="settings-cell"><span>朋友圈发动态概率</span><input type="number" id="cs-moments" step="0.01" min="0" max="1" value="${lc.momentsChance}"/></div>
      <div class="settings-cell"><span>主动拍一拍概率</span><input type="number" id="cs-poke" step="0.01" min="0" max="1" value="${lc.pokeChance}"/></div>
      <div class="settings-cell"><span>主动发消息间隔(分钟)</span><input type="number" id="cs-proactive" min="0" max="10080" value="${lc.proactiveIntervalMin == null ? 30 : lc.proactiveIntervalMin}"/></div>
      <div class="settings-section-title" style="padding-top:0">间隔为 0 则关闭主动发消息</div>
      <div style="padding:16px"><button class="btn-primary" id="cs-save" style="width:100%">保存</button></div>`;
    page.classList.remove('hidden');

    $('#cs-avatar')?.addEventListener('click', () => {
      state.currentContactId = c.id;
      $('#file-avatar')?.click();
    });
    $('#cs-bg')?.addEventListener('click', () => {
      state.currentContactId = c.id;
      openBgModal();
    });
    $('#cs-status')?.addEventListener('click', () => {
      state.currentContactId = c.id;
      openStatusModal();
    });
    $('#cs-save')?.addEventListener('click', () => {
      const num = (id, def) => {
        const v = parseFloat($(id)?.value);
        return isNaN(v) ? def : v;
      };
      let min = Math.max(0.5, Math.min(30, num('#cs-min', 1.5)));
      let max = Math.max(min, Math.min(60, num('#cs-max', 4)));
      let count = Math.max(1, Math.min(3, parseInt($('#cs-count')?.value, 10) || 2));
      c.settings = { minDelay: min, maxDelay: max, maxReplies: count };
      const clamp01 = v => Math.max(0, Math.min(1, v));
      c.listenConfig = {
        pauseChance: clamp01(num('#cs-pause', 0.18)),
        favoriteChance: clamp01(num('#cs-fav', 0.12)),
        pauseDurationMax: Math.max(1, Math.min(30, num('#cs-pdur', 6))),
        momentsChance: clamp01(num('#cs-moments', 0.15)),
        replyChance: clamp01(num('#cs-reply', 0.92)),
        readNoReplyChance: clamp01(num('#cs-noreply', 0.08)),
        pokeChance: clamp01(num('#cs-poke', 0.1)),
        proactiveIntervalMin: Math.max(0, Math.min(10080, num('#cs-proactive', 30)))
      };
      scheduleProactiveMessages();
      saveData();
      page.classList.add('hidden');
      alert('已保存');
    });
  }

  function closeChatSettings() {
    $('#chat-settings-page')?.classList.add('hidden');
  }
  function renderMsgBubble(m) {
    if (m.type === 'system' || m.type === 'poke') return `<div class="msg-system">${escapeHtml(m.text)}</div>`;
    if (m.type === 'sticker') {
      const src = m.stickerData || (state.stickers.find(s => s.id === m.stickerId) || {}).data || '';
      return `<div class="msg-bubble msg-sticker" style="background:transparent;box-shadow:none;padding:4px">${src ? `<img src="${src}" alt="表情"/>` : '[表情]'}</div>`;
    }
    if (m.type === 'image') {
      return `<div class="msg-bubble msg-photo" style="padding:4px;background:transparent;box-shadow:none"><img src="${m.imageData || ''}" alt="图片"/></div>`;
    }
    if (m.type === 'transfer') {
      const opened = m.opened ? ' opened' : '';
      const label = m.opened ? '已收款' : (m.from === 'user' ? '转账给对方' : '点击收款');
      return `<div class="msg-bubble msg-transfer${opened}" data-money-id="${m.id}"><div class="tf-label">${label}</div><div class="tf-amount">${m.amount}<span class="tf-unit"> 星币</span></div>${m.note?`<div class="tf-note">${escapeHtml(m.note)}</div>`:''}</div>`;
    }
    if (m.type === 'redpacket') {
      const opened = m.opened ? ' opened' : '';
      const title = m.opened ? '已领取' : (m.note || '恭喜发财');
      return `<div class="msg-bubble msg-redpacket${opened}" data-money-id="${m.id}"><div class="rp-icon">🧧</div><div class="rp-body"><div class="rp-title">${escapeHtml(title)}</div><div class="rp-amount">${m.opened ? m.amount + ' 星币' : '点击拆开'}</div></div></div>`;
    }
    let q = '';
    if (m.quote) {
      const qf = m.quote.from === 'user' ? '我' : (state.contacts.find(c=>c.id===state.chatContactId)?.name||'对方');
      q = `<div class="msg-quote"><div class="msg-quote-from">${escapeHtml(qf)}</div><div>${escapeHtml(truncate(m.quote.text||'',40))}</div></div>`;
    }
    return `<div class="msg-bubble">${q}${escapeHtml(m.text||'')}</div>`;
  }
  function bindMoneyOpen(row) {
    const el = row.querySelector('[data-money-id]');
    if (!el) return;
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-money-id');
      const msgs = state.chats[state.chatContactId] || [];
      const m = msgs.find(x => x.id === id);
      if (!m || m.opened) return;
      m.opened = true;
      saveData();
      if (m.type === 'redpacket') {
        const overlay = $('#rp-open-overlay');
        $('#rp-open-amount').textContent = m.amount;
        $('#rp-open-note').textContent = m.note || '恭喜发财';
        overlay?.classList.remove('hidden');
      }
      // 刷新该气泡
      row.innerHTML = `${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div>`;
      bindMoneyOpen(row);
      if (m.type !== 'redpacket') showListenToast && showListenToast('已收款');
    });
  }
  function msgAvatarHtml(from) {
    if (from === 'user') {
      if (state.userAvatar) return `<div class="msg-avatar" style="background-image:url(${state.userAvatar})"></div>`;
      return `<div class="msg-avatar" style="background:var(--accent)">我</div>`;
    }
    const c = state.contacts.find(x => x.id === state.chatContactId);
    if (!c) return `<div class="msg-avatar" style="background:#666">?</div>`;
    if (c.avatarImg) return `<div class="msg-avatar msg-avatar-contact" style="background-image:url(${c.avatarImg})"></div>`;
    return `<div class="msg-avatar msg-avatar-contact" style="background:${c.avatarColor}">${c.name.charAt(0)}</div>`;
  }

  function readStatusHtml(m) {
    if (m.from !== 'user') return '';
    if (m.readStatus === 'noreply') return `<div class="msg-read noreply">已读不回</div>`;
    if (m.read || m.readStatus === 'read') return `<div class="msg-read">已读</div>`;
    return `<div class="msg-read unread">未读</div>`;
  }

  /**
   * 只处理「最近一段」尚未有已读状态的用户消息：
   * 从末尾往前，直到碰到联系人消息或已有 readStatus 的用户消息为止。
   * asNoreply=true → 已读不回；false → 已读
   */
  function markUserMsgsRead(contactId, asNoreply) {
    const msgs = state.chats[contactId] || [];
    let changed = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.from === 'contact') break;
      if (m.from !== 'user') continue;
      // 已有明确状态则跳过（保留历史）
      if (m.readStatus === 'read' || m.readStatus === 'noreply') continue;
      m.read = true;
      m.readStatus = asNoreply ? 'noreply' : 'read';
      changed = true;
    }
    if (changed) {
      saveData();
      if (state.chatContactId === contactId) renderMessages();
    }
  }

  function buildMsgRowHtml(m) {
    if (m.type === 'system' || m.type === 'poke') {
      return `<div class="msg-row system" data-id="${m.id}">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div></div>`;
    }
    const cls = m.from === 'user' ? 'user' : 'contact';
    const av = msgAvatarHtml(m.from);
    const body = `<div class="msg-col">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div>${readStatusHtml(m)}</div>`;
    return `<div class="msg-row ${cls}" data-id="${m.id}">${cls === 'contact' ? av + body : body + av}</div>`;
  }

  function bindMsgRowEvents(row) {
    if (row.classList.contains('system')) return;
    bindLongPress(row);
    bindMoneyOpen(row);
    const avEl = row.querySelector('.msg-avatar-contact');
    if (avEl) {
      avEl.addEventListener('dblclick', e => { e.stopPropagation(); doPoke(); });
      let last = 0;
      avEl.addEventListener('click', e => {
        e.stopPropagation();
        const now = Date.now();
        if (now - last < 350) { doPoke(); last = 0; } else last = now;
      });
    }
  }

  function renderMessages() {
    const msgs = state.chats[state.chatContactId] || [];
    messageList.innerHTML = msgs.map(buildMsgRowHtml).join('');
    messageList.querySelectorAll('.msg-row').forEach(bindMsgRowEvents);
    requestAnimationFrame(() => { messageList.scrollTop = messageList.scrollHeight; });
  }
  function appendMessage(msg) {
    const typing = messageList.querySelector('.typing-row'); if (typing) typing.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = buildMsgRowHtml(msg);
    const row = wrap.firstElementChild;
    messageList.appendChild(row);
    bindMsgRowEvents(row);
    messageList.scrollTop = messageList.scrollHeight;
    // 对方回复时，把此前未读用户消息标为已读（非不回）
    if (msg.from === 'contact' && state.chatContactId) {
      markUserMsgsRead(state.chatContactId, false);
    }
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
  function getContactCardPool(contact) {
    if (contact.cardGroups) {
      const all = Object.values(contact.cardGroups).flat().filter(Boolean);
      if (all.length) return all;
    }
    return contact.cards || [];
  }

  function scheduleReplies(contact, forceCount) {
    clearPendingTimers();
    const s = contact.settings || DEFAULT_SETTINGS;
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const minD = Math.max(0.5, s.minDelay || 1.5);
    const maxD = Math.max(minD, s.maxDelay || 4);

    // 已读延迟（先变已读，再决定是否回复）
    const readDelay = randomDelay(
      Math.min(0.5, minD * 0.35),
      Math.min(2.2, Math.max(0.8, minD * 0.85))
    );

    // 已读不回：按设置概率
    const willNoreply = !forceCount && Math.random() < (Number(lc.readNoReplyChance) || 0);
    // 回复概率（在未触发已读不回时）
    const willSkipReply = !forceCount && !willNoreply &&
      Math.random() > (lc.replyChance == null ? 1 : Number(lc.replyChance));

    // 统一先在 readDelay 后写入已读状态
    state.pendingTimers.push(setTimeout(() => {
      markUserMsgsRead(contact.id, willNoreply || willSkipReply);
    }, readDelay * 1000));

    // 已读不回 或 不回复 → 结束
    if (willNoreply || willSkipReply) return;

    const maxR = Math.min(3, Math.max(1, s.maxReplies || 2));
    const count = forceCount || (Math.floor(Math.random() * maxR) + 1);
    const pool = getContactCardPool(contact);
    const stickers = state.stickers || [];
    let cum = readDelay;
    for (let i = 0; i < count; i++) {
      const d = randomDelay(minD, maxD);
      cum += d;
      const sendSticker = stickers.length && Math.random() < 0.22;
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        showTyping();
      }, Math.max(0, (cum - d * 0.6) * 1000)));
      state.pendingTimers.push(setTimeout(() => {
        // 回复前确保已读（非不回）
        markUserMsgsRead(contact.id, false);
        if (state.chatContactId !== contact.id) {
          // 不在当前页也写入消息
          let msg;
          if (sendSticker) {
            const st = stickers[Math.floor(Math.random() * stickers.length)];
            msg = { id: genId('m'), from: 'contact', type: 'sticker', stickerId: st.id, stickerData: st.data, time: Date.now() };
          } else if (pool.length) {
            msg = { id: genId('m'), from: 'contact', type: 'text', text: pool[Math.floor(Math.random() * pool.length)], time: Date.now() };
          } else return;
          if (!state.chats[contact.id]) state.chats[contact.id] = [];
          state.chats[contact.id].push(msg);
          saveData();
          return;
        }
        let msg;
        if (sendSticker) {
          const st = stickers[Math.floor(Math.random() * stickers.length)];
          msg = { id: genId('m'), from: 'contact', type: 'sticker', stickerId: st.id, stickerData: st.data, time: Date.now() };
        } else if (pool.length) {
          const text = pool[Math.floor(Math.random() * pool.length)];
          msg = { id: genId('m'), from: 'contact', type: 'text', text, time: Date.now() };
        } else return;
        pushMsg(msg);
        appendMessage(msg);
      }, cum * 1000));
    }
  }
  function doPoke() {
    const c = state.contacts.find(x => x.id === state.chatContactId);
    if (!c) return;
    // 防双击/多入口重复触发
    const now = Date.now();
    if (doPoke._last && now - doPoke._last < 800) return;
    doPoke._last = now;
    const poke = { id: genId('m'), from: 'system', type: 'poke', text: `你拍了拍 ${c.name}`, time: now };
    pushMsg(poke);
    appendMessage(poke);
    const lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
    state.pendingTimers.push(setTimeout(() => {
      if (state.chatContactId !== c.id) return;
      // 对方回拍（不算用户那条的重复）
      if (Math.random() < (lc.pokeChance != null ? Math.max(0.4, lc.pokeChance + 0.5) : 0.65)) {
        const acts = c.interactionCards?.length ? c.interactionCards : DEFAULT_INTERACTION;
        const back = {
          id: genId('m'), from: 'system', type: 'poke',
          text: `${c.name}${acts[Math.floor(Math.random() * acts.length)]}你`,
          time: Date.now()
        };
        pushMsg(back);
        appendMessage(back);
      } else {
        scheduleReplies(c, 1);
      }
    }, randomDelay(0.8, 2.2) * 1000));
  }
  function sendMessage() {
    const text = msgInput.value.trim(); if (!text || !state.chatContactId) return;
    const c = state.contacts.find(x => x.id === state.chatContactId); if (!c) return;
    const msg = { id:genId('m'), from:'user', type: state.quotingMsg?'quote':'text', text, time:Date.now(), read:false };
    if (state.quotingMsg) msg.quote = { id:state.quotingMsg.id, from:state.quotingMsg.from, text:state.quotingMsg.text||getPreviewText(state.quotingMsg), type:state.quotingMsg.type };
    pushMsg(msg); appendMessage(msg); msgInput.value=''; state.quotingMsg=null; updateQuoteBar(); hideAttachPanel(); hideStickerPanel(); scheduleReplies(c);
  }

  async function sendChatPhoto(file) {
    if (!file || !state.chatContactId) return;
    const c = state.contacts.find(x => x.id === state.chatContactId); if (!c) return;
    try {
      const imageData = await compressImage(file, 720, 0.72);
      const msg = { id: genId('m'), from: 'user', type: 'image', imageData, time: Date.now(), read: false };
      pushMsg(msg); appendMessage(msg); hideAttachPanel(); scheduleReplies(c);
    } catch (_) { alert('图片发送失败'); }
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
      item.className = 'contact-item' + (c.id === state.currentContactId ? ' active' : '');
      item.innerHTML = `${renderAvatarEl(c)}<div class="contact-name">${escapeHtml(c.name)}</div>
        <div class="contact-status">${escapeHtml(c.currentStatus || '')}</div>
        <button class="contact-del" data-id="${c.id}" title="删除">✕</button>`;
      item.addEventListener('click', e => {
        if (e.target.closest('.contact-del')) return;
        state.currentContactId = c.id; state.activeCardGroup = '默认';
        renderContactsList(); renderCardsPanel();
      });
      item.querySelector('.contact-del')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`删除联系人「${c.name}」？聊天记录与其朋友圈也会移除。`)) return;
        state.contacts = state.contacts.filter(x => x.id !== c.id);
        delete state.chats[c.id];
        state.moments = (state.moments || []).filter(m => m.contactId !== c.id);
        if (state.currentContactId === c.id) state.currentContactId = state.contacts[0]?.id || null;
        if (state.chatContactId === c.id) leaveChat();
        saveData();
        renderContactsList(); renderCardsPanel(); renderChatList(); updateStats();
      });
      // 长按显示删除
      let t = null;
      item.addEventListener('touchstart', () => { t = setTimeout(() => item.classList.add('show-del'), 500); }, { passive: true });
      item.addEventListener('touchend', () => clearTimeout(t));
      contactsList.appendChild(item);
    });
  }

  function openAddContactModal() {
    state.modalMode = 'add-contact';
    modalTitle.textContent = '添加联系人';
    modalBody.innerHTML = `
      <div class="form-row"><label>名称</label><input type="text" id="new-c-name" placeholder="联系人昵称"/></div>
      <div class="form-row"><label>头像色</label><input type="color" id="new-c-color" value="#3D9A62"/></div>`;
    modalOverlay.classList.remove('hidden');
    $('#new-c-name')?.focus();
  }

  function renderCardsPanel() {
    const c = state.contacts.find(x => x.id === state.currentContactId);
    if (!c) { cardsPanel.innerHTML = `<div class="empty-state small"><p>选择一位联系人查看字卡库</p></div>`; return; }
    ensureContactShape(c);
    const s = c.settings || DEFAULT_SETTINGS;
    const groups = Object.keys(c.cardGroups);
    if (!groups.includes(state.activeCardGroup)) state.activeCardGroup = groups[0] || '默认';
    const gName = state.activeCardGroup;
    const list = c.cardGroups[gName] || [];
    const mk = (text, idx, type) => `<div class="card-item ${type === 'interaction' ? 'interaction' : ''}"><div class="card-text">${escapeHtml(text)}</div>
      <div class="card-actions"><button class="card-btn edit" data-i="${idx}" data-t="${type}">✎</button><button class="card-btn delete" data-i="${idx}" data-t="${type}">✕</button></div></div>`;
    const favSongs = (c.favorites || []).map(fid => state.songs.find(s => s.id === fid)).filter(Boolean);
    cardsPanel.innerHTML = `
      <div class="cards-header"><h2>${escapeHtml(c.name)}</h2>
        <button class="btn-xs" id="btn-open-chat">去聊天</button>
      </div>
      <div class="settings-summary">状态 <strong>${escapeHtml(c.currentStatus || '')}</strong> · 字卡设置请在聊天页右上角 ⋯</div>
      <div class="contact-custom-bar"></div>
      <div class="section-title">字卡分组</div>
      <div class="group-tabs" id="group-tabs">
        ${groups.map(g => `<button class="group-tab ${g === gName ? 'active' : ''}" data-g="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
        <button class="group-tab" id="btn-add-group">+组</button>
      </div>
      <div class="toolbar-row">
        <button class="btn-xs" id="btn-add-card">+ 字卡</button>
        <button class="btn-xs" id="btn-batch-cards">批量导入</button>
        <button class="btn-xs" id="btn-file-cards">文件导入</button>
      </div>
      <div class="card-list">${list.map((t, i) => mk(t, i, 'normal')).join('') || '<div class="empty-state small"><p>暂无字卡</p></div>'}</div>
      <div class="section-title">互动字卡 <button class="btn-add" id="btn-add-inter" style="margin-left:8px">+</button></div>
      <div class="card-list">${(c.interactionCards || []).map((t, i) => mk(t, i, 'interaction')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">TA 收藏的歌</div>
      <div>${favSongs.map(sg => `<div class="fav-song-item" data-sid="${sg.id}"><div class="song-cover" style="${sg.cover ? `background-image:url(${sg.cover})` : ''}">${sg.cover ? '' : '🎵'}</div>
        <div class="song-info"><div class="song-title">${escapeHtml(sg.title)}</div><div class="song-artist">${escapeHtml(sg.artist || '')}</div></div></div>`).join('') || '<div class="empty-state small"><p>暂无收藏</p></div>'}</div>`;

    $('#group-tabs')?.querySelectorAll('.group-tab[data-g]').forEach(btn => {
      btn.addEventListener('click', () => { state.activeCardGroup = btn.dataset.g; renderCardsPanel(); });
    });
    $('#btn-add-group')?.addEventListener('click', () => {
      const name = prompt('新分组名称');
      if (!name || !name.trim()) return;
      if (c.cardGroups[name.trim()]) { alert('已存在'); return; }
      c.cardGroups[name.trim()] = [];
      state.activeCardGroup = name.trim();
      saveData(); renderCardsPanel();
    });
    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add', 'normal'));
    $('#btn-add-inter')?.addEventListener('click', () => openCardModal('add', 'interaction'));
    $('#btn-batch-cards')?.addEventListener('click', openBatchCardModal);
    $('#btn-file-cards')?.addEventListener('click', () => $('#file-cards-txt')?.click());
    $('#btn-open-chat')?.addEventListener('click', () => {
      switchPage('chat');
      enterChat(c.id);
    });
    cardsPanel.querySelectorAll('.card-btn.edit').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); openCardModal('edit', b.dataset.t, +b.dataset.i);
    }));
    cardsPanel.querySelectorAll('.card-btn.delete').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); if (!confirm('删除？')) return;
      if (b.dataset.t === 'interaction') c.interactionCards.splice(+b.dataset.i, 1);
      else {
        const arr = c.cardGroups[state.activeCardGroup] || [];
        arr.splice(+b.dataset.i, 1);
        c.cardGroups[state.activeCardGroup] = arr;
        c.cards = Object.values(c.cardGroups).flat();
      }
      saveData(); renderCardsPanel();
    }));
    cardsPanel.querySelectorAll('.fav-song-item').forEach(el => el.addEventListener('click', () => {
      openListenWithContact(el.dataset.sid, c.id);
    }));
  }
  function openCardModal(mode, type, index) {
    state.modalMode = mode === 'edit' ? 'card-edit' : 'card-add';
    state.editingCardType = type;
    state.editingCardIndex = mode === 'edit' ? index : null;
    modalTitle.textContent = (mode === 'edit' ? '编辑' : '添加') + (type === 'interaction' ? '互动字卡' : '字卡');
    modalBody.innerHTML = `<textarea id="modal-input" rows="3" placeholder="内容"></textarea>`;
    const input = $('#modal-input');
    if (mode === 'edit') {
      const c = state.contacts.find(x => x.id === state.currentContactId);
      const arr = type === 'interaction' ? c.interactionCards : (c.cardGroups[state.activeCardGroup] || []);
      input.value = arr[index] || '';
    }
    modalOverlay.classList.remove('hidden');
    input.focus();
  }

  function openBatchCardModal() {
    state.modalMode = 'batch-cards';
    modalTitle.textContent = '批量导入字卡（每行一条）';
    modalBody.innerHTML = `<textarea id="modal-input" rows="8" placeholder="一行一条字卡内容"></textarea>
      <div class="form-row" style="font-size:12px;color:var(--muted)">将导入到当前分组「${escapeHtml(state.activeCardGroup)}」</div>`;
    modalOverlay.classList.remove('hidden');
  }

  function openStatusModal() {
    const cid = state.currentContactId || state.chatContactId;
    const c = state.contacts.find(x => x.id === cid);
    if (!c) return;
    state.currentContactId = c.id;
    state.modalMode = 'status';
    modalTitle.textContent = '状态列表（每行一个）';
    modalBody.innerHTML = `<textarea id="modal-input" rows="5">${escapeHtml((c.statuses || DEFAULT_STATUSES).join('\n'))}</textarea>`;
    modalOverlay.classList.remove('hidden');
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
    let str = input.trim();
    // 清理分享文案、中文标点
    str = str.replace(/[\u200b-\u200f\ufeff]/g, '');
    // 歌单：支持 /m/playlist、#/playlist、playlist?id=
    let m = str.match(/playlist(?:\?id=|\/|#\/playlist\?id=)(\d+)/i)
      || str.match(/[?&#]id=(\d+)/i) && /playlist|歌单/i.test(str) && str.match(/[?&#]id=(\d+)/i);
    if (m && /playlist|歌单/i.test(str)) return { kind: 'playlist', id: m[1] };
    m = str.match(/\/playlist\/(\d+)/i) || str.match(/playlist\?id=(\d+)/i);
    if (m) return { kind: 'playlist', id: m[1] };
    // 单曲
    m = str.match(/song(?:\?id=|\/|#\/song\?id=)(\d+)/i);
    if (m) return { kind: 'song', id: m[1] };
    if (/song|单曲/i.test(str)) {
      m = str.match(/[?&#]id=(\d+)/i);
      if (m) return { kind: 'song', id: m[1] };
    }
    // 纯数字（>=5 位当单曲；也可手动指定歌单）
    m = str.match(/^\s*(\d{5,})\s*$/);
    if (m) return { kind: 'song', id: m[1] };
    m = str.match(/[?&#]id=(\d{5,})/i);
    if (m) return { kind: /playlist|歌单/i.test(str) ? 'playlist' : 'song', id: m[1] };
    return null;
  }

  async function fetchMeting(type, id) {
    const bases = [
      'https://api.injahow.cn/meting/',
      'https://api.qijieya.cn/meting/'
    ];
    let lastErr = null;
    for (const base of bases) {
      try {
        const url = `${base}?server=netease&type=${type}&id=${encodeURIComponent(id)}&r=${Date.now()}`;
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
        if (type === 'lrc') return await res.text();
        const text = await res.text();
        if (!text || text.startsWith('<')) { lastErr = new Error('返回非 JSON'); continue; }
        const data = JSON.parse(text);
        if (type === 'playlist' && (!Array.isArray(data) || !data.length)) {
          lastErr = new Error('歌单为空（可能是隐私歌单或 ID 无效）');
          continue;
        }
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('接口不可用');
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
    if (!el) return;
    el.classList.remove('hidden', 'dragging');
    el.style.maxWidth = '200px';
    el.style.maxHeight = '48px';
    el.style.height = 'auto';
    el.style.width = 'auto';
  }
  function hideFloatPlayer() {
    const el = $('#float-player');
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('dragging');
    }
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
      const text = ($('#modal-input')?.value || '').trim();
      if (!text) { alert('不能为空'); return; }
      const c = state.contacts.find(x => x.id === state.currentContactId);
      if (!c) return;
      ensureContactShape(c);
      if (state.editingCardType === 'interaction') {
        if (!c.interactionCards) c.interactionCards = [];
        if (state.modalMode === 'card-add') c.interactionCards.push(text);
        else c.interactionCards[state.editingCardIndex] = text;
      } else {
        if (!c.cardGroups[state.activeCardGroup]) c.cardGroups[state.activeCardGroup] = [];
        const arr = c.cardGroups[state.activeCardGroup];
        if (state.modalMode === 'card-add') arr.push(text);
        else arr[state.editingCardIndex] = text;
        c.cards = Object.values(c.cardGroups).flat();
      }
      saveData(); renderCardsPanel(); closeModal();
      return;
    }
    if (state.modalMode === 'batch-cards') {
      const raw = ($('#modal-input')?.value || '');
      const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) { alert('没有内容'); return; }
      const c = state.contacts.find(x => x.id === state.currentContactId);
      if (!c) return;
      ensureContactShape(c);
      if (!c.cardGroups[state.activeCardGroup]) c.cardGroups[state.activeCardGroup] = [];
      c.cardGroups[state.activeCardGroup].push(...lines);
      c.cards = Object.values(c.cardGroups).flat();
      saveData(); renderCardsPanel(); closeModal();
      return;
    }
    if (state.modalMode === 'status') {
      const lines = ($('#modal-input')?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const cid = state.currentContactId || state.chatContactId;
      const c = state.contacts.find(x => x.id === cid);
      if (!c) return;
      c.statuses = lines.length ? lines : DEFAULT_STATUSES.slice();
      if (!c.statuses.includes(c.currentStatus)) c.currentStatus = c.statuses[0];
      saveData();
      renderCardsPanel(); renderContactsList();
      if (state.chatContactId === c.id) {
        const st = c.currentStatus ? ` · ${c.currentStatus}` : '';
        pageTitle.innerHTML = `${escapeHtml(c.name)}<span class="header-status">${escapeHtml(st)}</span>`;
      }
      closeModal();
      return;
    }
    if (state.modalMode === 'add-contact') {
      const name = ($('#new-c-name')?.value || '').trim();
      if (!name) { alert('请输入名称'); return; }
      const color = $('#new-c-color')?.value || '#3D9A62';
      const c = ensureContactShape({
        id: genId('c'), name, avatarColor: color, avatarImg: null,
        chatBgColor: null, chatBgImg: null,
        cards: ['你好，很高兴认识你。'], interactionCards: [...DEFAULT_INTERACTION],
        settings: { ...DEFAULT_SETTINGS }, favorites: [], listenConfig: { ...DEFAULT_LISTEN },
        cardGroups: { '默认': ['你好，很高兴认识你。'] },
        statuses: [...DEFAULT_STATUSES], currentStatus: '在线'
      });
      state.contacts.push(c);
      state.chats[c.id] = [];
      state.currentContactId = c.id;
      saveData();
      renderContactsList(); renderCardsPanel(); renderChatList(); updateStats();
      closeModal();
      return;
    }
    if (state.modalMode === 'post-moment') {
      const text = ($('#moment-text')?.value || '').trim();
      if (!text && !state._momentDraftImage) { alert('写点内容或选一张图'); return; }
      const m = {
        id: genId('mo'), contactId: 'me', text,
        imageData: state._momentDraftImage || null,
        stickerData: null, time: Date.now(), likes: [], comments: []
      };
      if (!state.moments) state.moments = [];
      state.moments.unshift(m);
      state._momentDraftImage = null;
      saveData();
      closeModal();
      renderMoments();
      return;
    }
    if (state.modalMode === 'add-memorial') {
      const contactId = $('#mem-contact')?.value;
      const title = ($('#mem-title')?.value || '').trim() || '纪念';
      const date = $('#mem-date')?.value;
      const type = $('#mem-type')?.value || 'anniversary';
      const pinInChat = !!$('#mem-pin')?.checked;
      if (!contactId || !date) { alert('请选择联系人和日期'); return; }
      if (!state.memorials) state.memorials = [];
      if (pinInChat) {
        state.memorials.forEach(x => { if (x.contactId === contactId) x.pinInChat = false; });
      }
      state.memorials.push({ id: genId('mem'), contactId, title, date, type, pinInChat });
      saveData();
      closeModal();
      renderMemorialList();
      if (state.chatContactId === contactId) updateChatPinMemorial(contactId);
      return;
    }
  }

  function updateStats() {
    const sc = $('#stat-contacts'), sk = $('#stat-cards'), ss = $('#stat-songs');
    if (sc) sc.textContent = state.contacts.length;
    if (sk) sk.textContent = state.contacts.reduce((n, c) => {
      const n1 = c.cardGroups ? Object.values(c.cardGroups).flat().length : (c.cards?.length || 0);
      return n + n1 + (c.interactionCards?.length || 0);
    }, 0);
    if (ss) ss.textContent = state.songs.length;
  }

  function hideStickerPanel() {
    $('#sticker-panel')?.classList.add('hidden');
  }

  function renderStickerPanel() {
    const panel = $('#sticker-panel');
    if (!panel) return;
    const list = state.stickers || [];
    if (!list.length) {
      panel.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px">暂无表情，请在「我」页管理导入</div>';
      return;
    }
    panel.innerHTML = list.map(s =>
      `<div class="sticker-item" data-id="${s.id}"><img src="${s.data}" alt=""/></div>`
    ).join('');
    panel.querySelectorAll('.sticker-item').forEach(el => {
      el.addEventListener('click', () => {
        const st = state.stickers.find(x => x.id === el.dataset.id);
        if (!st || !state.chatContactId) return;
        const msg = { id: genId('m'), from: 'user', type: 'sticker', stickerId: st.id, stickerData: st.data, time: Date.now() };
        pushMsg(msg); appendMessage(msg); hideStickerPanel();
        const c = state.contacts.find(x => x.id === state.chatContactId);
        if (c) scheduleReplies(c);
      });
    });
  }

  function toggleStickerPanel() {
    const panel = $('#sticker-panel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
      hideAttachPanel();
      renderStickerPanel();
      panel.classList.remove('hidden');
    } else panel.classList.add('hidden');
  }

  function startStatusRotation() {
    if (state.statusTimer) clearInterval(state.statusTimer);
    state.statusTimer = setInterval(() => {
      state.contacts.forEach(c => {
        if (!c.statuses || c.statuses.length < 2) return;
        if (Math.random() < 0.35) {
          c.currentStatus = c.statuses[Math.floor(Math.random() * c.statuses.length)];
        }
      });
      saveData();
      if ($('#page-contacts')?.classList.contains('active')) renderContactsList();
      if (state.chatContactId) {
        const c = state.contacts.find(x => x.id === state.chatContactId);
        if (c) {
          const st = c.currentStatus ? ` · ${c.currentStatus}` : '';
          pageTitle.innerHTML = `${escapeHtml(c.name)}<span class="header-status">${escapeHtml(st)}</span>`;
        }
      }
    }, 45000 + Math.random() * 30000);
  }

  function scheduleProactiveMessages() {
    if (state.proactiveTimer) clearInterval(state.proactiveTimer);
    if (!state.lastProactiveAt) state.lastProactiveAt = {};
    // 每分钟检查一次
    state.proactiveTimer = setInterval(() => {
      const now = Date.now();
      state.contacts.forEach(c => {
        const lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
        const intervalMin = Number(lc.proactiveIntervalMin);
        if (!intervalMin || intervalMin <= 0) return;
        const last = state.lastProactiveAt[c.id] || 0;
        if (now - last < intervalMin * 60 * 1000) return;
        state.lastProactiveAt[c.id] = now;
        const pool = getContactCardPool(c);
        const stickers = state.stickers || [];
        let msg;
        if (stickers.length && Math.random() < 0.25) {
          const st = stickers[Math.floor(Math.random() * stickers.length)];
          msg = { id: genId('m'), from: 'contact', type: 'sticker', stickerId: st.id, stickerData: st.data, time: now };
        } else if (pool.length) {
          msg = { id: genId('m'), from: 'contact', type: 'text', text: pool[Math.floor(Math.random() * pool.length)], time: now };
        } else return;
        if (!state.chats[c.id]) state.chats[c.id] = [];
        state.chats[c.id].push(msg);
        saveData();
        if (state.chatContactId === c.id) appendMessage(msg);
        else renderChatList();
      });
    }, 60000);
  }

  function daysBetween(dateStr) {
    // dateStr YYYY-MM-DD，返回距今天数（正=已过，负=未到）
    try {
      const t = new Date(dateStr + 'T00:00:00');
      const n = new Date();
      n.setHours(0, 0, 0, 0);
      return Math.round((n - t) / 86400000);
    } catch (_) { return 0; }
  }

  function memorialLabel(m) {
    const d = daysBetween(m.date);
    if (m.type === 'countdown') {
      if (d > 0) return `已过 ${d} 天`;
      if (d === 0) return '就是今天';
      return `还有 ${-d} 天`;
    }
    // anniversary：已过天数
    if (d < 0) return `还有 ${-d} 天到来`;
    if (d === 0) return '今天！';
    return `已 ${d} 天`;
  }

  function renderMemorialList() {
    const list = $('#memorial-list');
    if (!list) return;
    const arr = state.memorials || [];
    if (!arr.length) {
      list.innerHTML = '<div class="empty-state small"><p>还没有纪念</p><p class="hint">记录纪念日或倒数日</p></div>';
      return;
    }
    list.innerHTML = arr.map(m => {
      const c = state.contacts.find(x => x.id === m.contactId);
      const name = c ? c.name : '未知';
      return `<div class="memorial-card" data-id="${m.id}">
        <div class="memorial-title">${escapeHtml(m.title || '纪念')}</div>
        <div class="memorial-meta">${escapeHtml(name)} · ${m.date} · ${m.type === 'countdown' ? '倒数日' : '纪念日'}${m.pinInChat ? ' · 已置顶' : ''}</div>
        <div class="memorial-days">${memorialLabel(m)}</div>
        <div class="memorial-actions">
          <button class="btn-xs" data-act="pin">${m.pinInChat ? '取消置顶' : '聊天置顶'}</button>
          <button class="btn-xs" data-act="del">删除</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.memorial-card').forEach(card => {
      const id = card.dataset.id;
      const m = (state.memorials || []).find(x => x.id === id);
      if (!m) return;
      card.querySelector('[data-act="pin"]')?.addEventListener('click', () => {
        m.pinInChat = !m.pinInChat;
        // 同一联系人只保留一个置顶
        if (m.pinInChat) {
          (state.memorials || []).forEach(x => {
            if (x.id !== m.id && x.contactId === m.contactId) x.pinInChat = false;
          });
        }
        saveData();
        renderMemorialList();
        if (state.chatContactId === m.contactId) updateChatPinMemorial(m.contactId);
      });
      card.querySelector('[data-act="del"]')?.addEventListener('click', () => {
        if (!confirm('删除这条纪念？')) return;
        state.memorials = (state.memorials || []).filter(x => x.id !== id);
        saveData();
        renderMemorialList();
        if (state.chatContactId) updateChatPinMemorial(state.chatContactId);
      });
    });
  }

  function openAddMemorialModal() {
    if (!(state.contacts || []).length) { alert('请先添加联系人'); return; }
    state.modalMode = 'add-memorial';
    modalTitle.textContent = '添加纪念';
    const opts = state.contacts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    modalBody.innerHTML = `
      <div class="form-row"><label>联系人</label><select id="mem-contact">${opts}</select></div>
      <div class="form-row"><label>标题</label><input type="text" id="mem-title" placeholder="如：认识纪念日"/></div>
      <div class="form-row"><label>日期</label><input type="date" id="mem-date" value="${today}"/></div>
      <div class="form-row"><label>类型</label>
        <select id="mem-type"><option value="anniversary">纪念日（已过天数）</option><option value="countdown">倒数日</option></select>
      </div>
      <div class="form-row"><label><input type="checkbox" id="mem-pin"/> 在聊天页置顶显示</label></div>`;
    modalOverlay.classList.remove('hidden');
  }

  function updateChatPinMemorial(contactId) {
    const el = $('#chat-pin-memorial');
    if (!el) return;
    const m = (state.memorials || []).find(x => x.contactId === contactId && x.pinInChat);
    if (!m) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = `${m.title || '纪念'} · ${memorialLabel(m)}`;
    el.classList.remove('hidden');
  }

  function openMomentsPage() {
    const page = $('#moments-page');
    if (!page) return;
    page.classList.remove('hidden');
    updateMomentsCoverUI();
    hideMomentCommentBar();
    renderMoments();
  }

  function closeMomentsPage() {
    $('#moments-page')?.classList.add('hidden');
    hideMomentCommentBar();
  }

  function updateMomentsCoverUI() {
    const cover = $('#moments-cover');
    const nameEl = $('#moments-cover-name');
    const av = $('#moments-cover-avatar');
    if (nameEl) nameEl.textContent = state.userName || '昕';
    if (av) {
      if (state.userAvatar) {
        av.style.backgroundImage = `url(${state.userAvatar})`;
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.style.background = 'var(--accent)';
        av.textContent = (state.userName || '昕').charAt(0);
      }
    }
    if (cover) {
      if (state.momentsCover) {
        cover.style.backgroundImage = `url(${state.momentsCover})`;
      } else {
        cover.style.backgroundImage = '';
      }
    }
  }

  function hideMomentCommentBar() {
    const bar = $('#moment-comment-bar');
    if (bar) bar.classList.add('hidden');
    state._commentMomentId = null;
  }

  function showMomentCommentBar(momentId) {
    state._commentMomentId = momentId;
    const bar = $('#moment-comment-bar');
    const input = $('#moment-comment-input');
    if (bar) bar.classList.remove('hidden');
    if (input) { input.value = ''; input.focus(); }
  }

  function genRandomMoment() {
    const c = state.contacts[Math.floor(Math.random() * state.contacts.length)];
    if (!c) return null;
    const pool = getContactCardPool(c);
    const text = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '今天天气不错。';
    let stickerData = null, stickerId = null;
    if ((state.stickers || []).length && Math.random() < 0.35) {
      const st = state.stickers[Math.floor(Math.random() * state.stickers.length)];
      stickerId = st.id; stickerData = st.data;
    }
    return {
      id: genId('mo'), contactId: c.id, text, stickerId, stickerData, imageData: null,
      time: Date.now() - Math.floor(Math.random() * 86400000 * 3),
      likes: [], comments: []
    };
  }

  function openPostMomentModal() {
    state.modalMode = 'post-moment';
    state._momentDraftImage = null;
    modalTitle.textContent = '发表朋友圈';
    modalBody.innerHTML = `
      <textarea id="moment-text" rows="4" placeholder="这一刻的想法..."></textarea>
      <div class="toolbar-row" style="margin-top:8px">
        <button class="btn-xs" type="button" id="moment-pick-photo">＋ 照片</button>
        <span id="moment-photo-preview" style="font-size:12px;color:var(--muted)"></span>
      </div>`;
    modalOverlay.classList.remove('hidden');
    $('#moment-pick-photo')?.addEventListener('click', () => $('#file-moment-photo')?.click());
  }

  function replyToMomentLater(m) {
    const c = state.contacts.find(x => x.id === m.contactId);
    if (!c || Math.random() > 0.65) return;
    setTimeout(() => {
      if (!m.comments) m.comments = [];
      const pool = getContactCardPool(c);
      if ((state.stickers || []).length && Math.random() < 0.3) {
        const st = state.stickers[Math.floor(Math.random() * state.stickers.length)];
        m.comments.push({ from: c.name, stickerData: st.data, time: Date.now() });
      } else {
        m.comments.push({ from: c.name, text: pool.length ? pool[Math.floor(Math.random() * pool.length)] : '收到~', time: Date.now() });
      }
      saveData();
      renderMoments();
    }, 700 + Math.random() * 1200);
  }

  function renderMoments() {
    const list = $('#moments-list');
    if (!list) return;
    if (!state.moments) state.moments = [];
    if (state.moments.length < 3) {
      for (let i = 0; i < 3; i++) {
        const m = genRandomMoment();
        if (m) state.moments.unshift(m);
      }
      saveData();
    }
    const sorted = state.moments.slice().sort((a, b) => b.time - a.time);
    list.innerHTML = sorted.map(m => {
      const isMe = m.contactId === 'me';
      const c = isMe ? null : state.contacts.find(x => x.id === m.contactId);
      const name = isMe ? (state.userName || '昕') : (c ? c.name : '未知');
      const avHtml = isMe
        ? (state.userAvatar
          ? `<div class="avatar" style="background-image:url(${state.userAvatar})"></div>`
          : `<div class="avatar" style="background:var(--accent)">${(state.userName || '昕').charAt(0)}</div>`)
        : (c ? renderAvatarEl(c) : '<div class="avatar" style="background:#666">?</div>');
      const liked = (m.likes || []).includes('me');
      const ago = (() => {
        const d = Date.now() - m.time;
        if (d < 60000) return '刚刚';
        if (d < 3600000) return Math.floor(d / 60000) + '分钟前';
        if (d < 86400000) return Math.floor(d / 3600000) + '小时前';
        return formatTime(m.time);
      })();
      return `<div class="moment-card wx" data-id="${m.id}">
        <div class="moment-head">
          ${avHtml}
          <div class="moment-meta">
            <div class="moment-name">${escapeHtml(name)}</div>
            <div class="moment-text">${escapeHtml(m.text || '')}</div>
            ${m.imageData ? `<div class="moment-photo"><img src="${m.imageData}"/></div>` : ''}
            ${m.stickerData ? `<div class="moment-sticker"><img src="${m.stickerData}"/></div>` : ''}
            <div class="moment-foot">
              <span class="moment-time">${ago}</span>
              ${m.contactId === 'me' || true ? `<button class="moment-del" data-act="del" type="button">删除</button>` : ''}
              <button class="moment-more" data-act="menu" type="button">···</button>
            </div>
            <div class="moment-action-bar hidden" data-bar>
              <button data-act="like" type="button">${liked ? '取消' : '赞'}</button>
              <button data-act="comment" type="button">评论</button>
            </div>
            ${(m.likes || []).length ? `<div class="moment-likes">♥ ${(m.likes || []).map(x => x === 'me' ? '我' : x).join('、')}</div>` : ''}
            <div class="moment-comments">${(m.comments || []).map(cm => {
              if (cm.stickerData) return `<div class="moment-comment"><span class="who">${escapeHtml(cm.from)}</span><img class="cm-sticker" src="${cm.stickerData}"/></div>`;
              return `<div class="moment-comment"><span class="who">${escapeHtml(cm.from)}</span>${escapeHtml(cm.text || '')}</div>`;
            }).join('')}</div>
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state small"><p>暂无动态，点右上角刷新</p></div>';

    list.querySelectorAll('.moment-card').forEach(card => {
      const id = card.dataset.id;
      const m = state.moments.find(x => x.id === id);
      if (!m) return;
      const bar = card.querySelector('[data-bar]');
      card.querySelector('[data-act="menu"]')?.addEventListener('click', e => {
        e.stopPropagation();
        // 关闭其他
        list.querySelectorAll('[data-bar]').forEach(b => { if (b !== bar) b.classList.add('hidden'); });
        bar?.classList.toggle('hidden');
      });
      card.querySelector('[data-act="like"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!m.likes) m.likes = [];
        if (m.likes.includes('me')) m.likes = m.likes.filter(x => x !== 'me');
        else m.likes.push('me');
        saveData();
        renderMoments();
      });
      card.querySelector('[data-act="comment"]')?.addEventListener('click', e => {
        e.stopPropagation();
        bar?.classList.add('hidden');
        showMomentCommentBar(m.id);
      });
      card.querySelector('[data-act="del"]')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('删除这条朋友圈？')) return;
        state.moments = (state.moments || []).filter(x => x.id !== m.id);
        saveData();
        renderMoments();
      });
    });
  }

  function submitMomentComment(text, stickerData) {
    const mid = state._commentMomentId;
    if (!mid) return;
    const m = state.moments.find(x => x.id === mid);
    if (!m) return;
    if (!m.comments) m.comments = [];
    if (stickerData) m.comments.push({ from: '我', stickerData, time: Date.now() });
    else if (text && text.trim()) m.comments.push({ from: '我', text: text.trim(), time: Date.now() });
    else return;
    hideMomentCommentBar();
    saveData();
    renderMoments();
    replyToMomentLater(m);
  }

  function openStickerManager() {
    state.modalMode = 'sticker-manage';
    modalTitle.textContent = '表情包管理';
    const list = state.stickers || [];
    modalBody.innerHTML = `
      <div class="toolbar-row">
        <button class="btn-primary" id="sm-add" style="flex:1">＋ 添加</button>
      </div>
      <div class="sticker-panel" style="max-height:280px">${list.map(s =>
        `<div class="sticker-item sm-item" data-id="${s.id}" style="position:relative">
          <img src="${s.data}"/>
          <button class="sm-del" data-id="${s.id}" title="删除">✕</button>
        </div>`).join('') || '<div style="color:var(--muted);font-size:13px;padding:12px">暂无表情</div>'}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">点击 ✕ 删除；点添加可多选图片导入</div>`;
    modalOverlay.classList.remove('hidden');
    $('#sm-add')?.addEventListener('click', () => $('#file-stickers')?.click());
    modalBody.querySelectorAll('.sm-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        state.stickers = (state.stickers || []).filter(s => s.id !== id);
        saveData();
        openStickerManager();
      });
    });
  }

  function exportBackup() {
    const payload = buildPersistPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zijian-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(reader.result);
        const data = normalizeLoaded(p);
        state.contacts = data.contacts;
        state.songs = data.songs;
        state.chats = data.chats;
        state.stickers = data.stickers || [];
        state.moments = data.moments || [];
        state.userBalance = data.userBalance;
        state.theme = data.theme;
        state.playMode = data.playMode || 'order';
        applyTheme(state.theme);
        saveData();
        renderContactsList(); renderCardsPanel(); renderChatList(); renderSongList(); updateStats(); updateThemeUI();
        alert('备份已恢复');
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    };
    reader.readAsText(file);
  }

  function enableFloatDrag() {
    const el = $('#float-player');
    if (!el || el._dragBound) return;
    el._dragBound = true;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const W = () => Math.min(el.offsetWidth || 180, 200);
    const H = () => Math.min(el.offsetHeight || 44, 48);

    const onStart = (x, y, e) => {
      // 点按钮不拖
      if (e && e.target && e.target.closest && e.target.closest('button')) return false;
      dragging = true;
      el.classList.add('dragging');
      const r = el.getBoundingClientRect();
      // 用实际可见尺寸，避免被错误撑开
      ox = r.left;
      oy = r.top;
      sx = x;
      sy = y;
      el.style.width = W() + 'px';
      el.style.maxWidth = '200px';
      el.style.height = 'auto';
      el.style.maxHeight = '48px';
      el.style.left = ox + 'px';
      el.style.top = oy + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      el.style.margin = '0';
      return true;
    };
    const onMove = (x, y) => {
      if (!dragging) return;
      const w = W(), h = H();
      let nx = ox + (x - sx);
      let ny = oy + (y - sy);
      nx = Math.max(4, Math.min(window.innerWidth - w - 4, nx));
      ny = Math.max(4, Math.min(window.innerHeight - h - 4, ny));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      el.style.width = w + 'px';
      el.style.maxHeight = '48px';
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      el.style.pointerEvents = '';
    };

    el.addEventListener('mousedown', e => {
      if (!onStart(e.clientX, e.clientY, e)) return;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onEnd);
    el.addEventListener('touchstart', e => {
      const t = e.touches[0];
      if (!onStart(t.clientX, t.clientY, e)) return;
    }, { passive: true });
    window.addEventListener('touchmove', e => {
      if (!dragging) return;
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    }, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
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

  function updateMeAvatarUI() {
    const el = $('#me-avatar');
    const nameEl = $('#me-name');
    if (nameEl) nameEl.textContent = state.userName || '昕';
    if (!el) return;
    if (state.userAvatar) {
      el.style.backgroundImage = `url(${state.userAvatar})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.style.background = '#3D9A62';
      el.textContent = (state.userName || '昕').charAt(0);
    }
  }

  async function init() {
    const data = await loadDataAsync();
    state.contacts = data.contacts; state.songs = data.songs; state.chats = data.chats;
    state.stickers = data.stickers || []; state.moments = data.moments || [];
    state.memorials = data.memorials || [];
    state.userBalance = data.userBalance; state.theme = data.theme;
    state.playMode = data.playMode || 'order';
    state.userAvatar = data.userAvatar || null;
    state.userName = data.userName || '昕';
    state.lastProactiveAt = data.lastProactiveAt || {};
    state.momentsCover = data.momentsCover || null;
    applyTheme(state.theme);
    startStatusRotation();
    scheduleProactiveMessages();
    enableFloatDrag();
    updateMeAvatarUI();

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
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        const dataUrl = await compressImage(f, 200, 0.65);
        if (state.uploadTarget === 'user') {
          state.userAvatar = dataUrl;
          state.uploadTarget = null;
          saveData();
          updateMeAvatarUI();
          if (state.chatContactId) renderMessages();
          return;
        }
        const c = state.contacts.find(x => x.id === state.currentContactId);
        if (!c) return;
        c.avatarImg = dataUrl;
        saveData();
        renderContactsList(); renderCardsPanel();
        if (state.chatContactId === c.id) enterChat(c.id);
      } catch (_) { alert('图片失败'); }
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
    attachPanel.querySelectorAll('.attach-btn').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.action === 'photo') {
        $('#file-chat-photo')?.click();
        hideAttachPanel();
        return;
      }
      openMoneyModal(b.dataset.action);
    }));
    $('#file-chat-photo')?.addEventListener('change', e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (f) sendChatPhoto(f);
    });
    $('#file-moment-photo')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        state._momentDraftImage = await compressImage(f, 900, 0.72);
        const prev = $('#moment-photo-preview');
        if (prev) prev.textContent = '已选 1 张图';
      } catch (_) { alert('图片失败'); }
    });
    $('#btn-add-contact')?.addEventListener('click', openAddContactModal);
    $('#moments-post')?.addEventListener('click', openPostMomentModal);
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

    // 互动页
    $('#btn-goto-moments')?.addEventListener('click', openMomentsPage);
    $('#btn-goto-music')?.addEventListener('click', () => {
      document.querySelector('.discover-list')?.classList.add('hidden');
      $('#music-subpage')?.classList.remove('hidden');
      $('#memorial-subpage')?.classList.add('hidden');
      pageTitle.textContent = '音乐';
      renderSongList();
    });
    $('#btn-music-back')?.addEventListener('click', () => {
      $('#music-subpage')?.classList.add('hidden');
      $('#memorial-subpage')?.classList.add('hidden');
      document.querySelector('.discover-list')?.classList.remove('hidden');
      pageTitle.textContent = '互动';
    });
    $('#btn-goto-memorial')?.addEventListener('click', () => {
      document.querySelector('.discover-list')?.classList.add('hidden');
      $('#music-subpage')?.classList.add('hidden');
      $('#memorial-subpage')?.classList.remove('hidden');
      pageTitle.textContent = '纪念';
      renderMemorialList();
    });
    $('#btn-memorial-back')?.addEventListener('click', () => {
      $('#memorial-subpage')?.classList.add('hidden');
      document.querySelector('.discover-list')?.classList.remove('hidden');
      pageTitle.textContent = '互动';
    });
    $('#btn-add-memorial')?.addEventListener('click', openAddMemorialModal);
    $('#btn-chat-more')?.addEventListener('click', openChatSettings);
    $('#chat-settings-back')?.addEventListener('click', closeChatSettings);

    // 表情 / 备份 / 朋友圈 / 红包
    $('#btn-sticker')?.addEventListener('click', toggleStickerPanel);
    $('#btn-export-data')?.addEventListener('click', exportBackup);
    $('#btn-import-data')?.addEventListener('click', () => $('#file-backup')?.click());
    $('#file-backup')?.addEventListener('change', e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (f) importBackupFile(f);
    });
    $('#file-cards-txt')?.addEventListener('change', e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      const c = state.contacts.find(x => x.id === state.currentContactId);
      if (!c) return;
      const reader = new FileReader();
      reader.onload = () => {
        const lines = String(reader.result || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        ensureContactShape(c);
        if (!c.cardGroups[state.activeCardGroup]) c.cardGroups[state.activeCardGroup] = [];
        c.cardGroups[state.activeCardGroup].push(...lines);
        c.cards = Object.values(c.cardGroups).flat();
        saveData(); renderCardsPanel();
        alert(`已导入 ${lines.length} 条字卡`);
      };
      reader.readAsText(f);
    });
    $('#btn-manage-stickers')?.addEventListener('click', openStickerManager);
    $('#me-avatar')?.addEventListener('click', () => {
      state.uploadTarget = 'user';
      $('#file-avatar')?.click();
    });
    $('#file-stickers')?.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      for (const f of files.slice(0, 40)) {
        try {
          const data = await compressImage(f, 200, 0.7);
          state.stickers.push({ id: genId('st'), data });
        } catch (_) {}
      }
      saveData();
      if (state.modalMode === 'sticker-manage') openStickerManager();
      else alert(`已导入表情，当前共 ${state.stickers.length} 个`);
    });
    $('#moments-back')?.addEventListener('click', closeMomentsPage);
    $('#moments-refresh')?.addEventListener('click', () => {
      const m = genRandomMoment();
      if (m) { state.moments.unshift(m); saveData(); }
      renderMoments();
    });
    $('#moment-comment-send')?.addEventListener('click', () => {
      submitMomentComment($('#moment-comment-input')?.value || '');
    });
    $('#moment-comment-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitMomentComment($('#moment-comment-input')?.value || '');
      }
    });
    $('#moment-comment-sticker')?.addEventListener('click', () => {
      if (!(state.stickers || []).length) { alert('请先导入表情包'); return; }
      state.modalMode = 'moment-sticker';
      modalTitle.textContent = '选择表情';
      modalBody.innerHTML = `<div class="sticker-panel" style="max-height:240px">${state.stickers.map(s =>
        `<div class="sticker-item" data-id="${s.id}"><img src="${s.data}"/></div>`).join('')}</div>`;
      modalOverlay.classList.remove('hidden');
      modalBody.querySelectorAll('.sticker-item').forEach(el => {
        el.addEventListener('click', () => {
          const st = state.stickers.find(x => x.id === el.dataset.id);
          closeModal();
          if (st) submitMomentComment('', st.data);
        });
      });
    });
    $('#btn-moments-cover')?.addEventListener('click', () => $('#file-moments-cover')?.click());
    $('#file-moments-cover')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        state.momentsCover = await compressImage(f, 900, 0.72);
        saveData();
        updateMomentsCoverUI();
        alert('朋友圈封面已更新');
      } catch (_) { alert('图片失败'); }
    });
    $('#rp-open-close')?.addEventListener('click', () => $('#rp-open-overlay')?.classList.add('hidden'));
    $('#rp-open-overlay')?.addEventListener('click', e => {
      if (e.target === $('#rp-open-overlay')) e.target.classList.add('hidden');
    });

    switchPage('chat');
    updateStats();
    updateThemeUI();
    updatePlayModeBtn();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
