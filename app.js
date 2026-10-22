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
    favoriteChance: 0.12,       // 一起听时收藏「整首歌」的概率
    lyricFavoriteChance: 0.2,   // 播放中独立：随机收藏一句歌词
    listenInviteChance: 0.18,   // 主动邀请一起听的概率（在主动发消息时）
    pauseDurationMax: 6,
    momentsChance: 0.15,
    replyChance: 0.92,
    readNoReplyChance: 0.08,
    pokeChance: 0.1,
    // 每隔多少分钟主动给用户发一条消息；0 表示关闭
    proactiveIntervalMin: 30,
    avatarSwapChance: 0.08,
    askChance: 0.1,
    // 提问 / 问卷回答延迟（秒）
    askMinDelay: 2,
    askMaxDelay: 8,
    momentsSticker: true,
    momentCommentChance: 0.65,
    // 拼字卡：把多条短字卡拼成一句再发送
    spliceChance: 0.35,
    spliceMin: 2,
    spliceMax: 4
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
    questionnaires: [],
    groups: [],
    userBalance: 888, theme: 'classic', userAvatar: null, userName: '昕',
    currentContactId: null, chatContactId: null,
    editingCardIndex: null, editingCardType: 'normal', editingGroup: '默认', modalMode: null,
    pendingTimers: [], quotingMsg: null, longPressMsg: null,
    playMode: 'order',
    listenSongId: null, listenContactId: null, listenInterval: null,
    listenLyrics: [], listenLyricIdx: -1, pendingSong: null,
    listenQueue: [], listenIndex: 0, floatVisible: false,
    statusTimer: null, proactiveTimer: null, activeCardGroup: '默认',
    lastProactiveAt: {},
    // 未读 / 置顶 / 信箱
    unread: {},          // contactId -> number
    groupUnread: {},     // groupId -> number
    pinned: [],          // ['c:id' | 'g:id']
    letters: [],         // 信箱
    mailboxConfig: {
      minIntervalH: 6, maxIntervalH: 36,
      minWords: 20, maxWords: 120,
      replyChance: 0.55,
      enabled: true
    },
    mailboxUnread: 0,
    momentNotifs: 0,
    lastLetterAt: {},
    letterTimer: null
  };

  const DEFAULT_MAILBOX = {
    minIntervalH: 6, maxIntervalH: 36,
    minWords: 20, maxWords: 120,
    replyChance: 0.55,       // 0~1，界面按 % 显示
    replyMinMin: 1,          // 对方回信最少延迟（分钟）— 对齐 mochi
    replyMaxMin: 30,         // 对方回信最多延迟（分钟）
    enabled: true
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
    if (typeof c.balance !== 'number' || isNaN(c.balance)) c.balance = 8888;
    // 查岗提问题库（联系人主动问用户）
    if (!Array.isArray(c.askQuestions)) c.askQuestions = [];
    return c;
  }

  function normalizeLoaded(p) {
    if (!p || !Array.isArray(p.contacts) || !p.contacts.length) {
      return {
        contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)).map(ensureContactShape),
        songs: JSON.parse(JSON.stringify(DEFAULT_SONGS)),
        chats: {}, stickers: [], moments: [], memorials: [], questionnaires: [], groups: [],
        userBalance: 888, theme: 'classic', playMode: 'order',
        unread: {}, groupUnread: {}, pinned: [], letters: [],
        mailboxConfig: { ...DEFAULT_MAILBOX }, mailboxUnread: 0, momentNotifs: 0,
        lastLetterAt: {}, lastProactiveAt: {}, momentsCover: null,
        userAvatar: null, userAvatarPool: [], userName: '昕',
        notifyEnabled: false
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
      questionnaires: Array.isArray(p.questionnaires) ? p.questionnaires : [],
      groups: Array.isArray(p.groups) ? p.groups : [],
      userBalance: typeof p.userBalance === 'number' ? p.userBalance : 888,
      theme: THEMES.includes(p.theme) ? p.theme : 'classic',
      playMode: p.playMode || 'order',
      userAvatar: p.userAvatar || null,
      userAvatarPool: Array.isArray(p.userAvatarPool) ? p.userAvatarPool : [],
      userName: p.userName || '昕',
      lastProactiveAt: p.lastProactiveAt || {},
      momentsCover: p.momentsCover || null,
      unread: p.unread || {},
      groupUnread: p.groupUnread || {},
      pinned: Array.isArray(p.pinned) ? p.pinned : [],
      letters: Array.isArray(p.letters) ? p.letters : [],
      mailboxConfig: Object.assign({}, DEFAULT_MAILBOX, p.mailboxConfig || {}),
      mailboxUnread: p.mailboxUnread || 0,
      momentNotifs: p.momentNotifs || 0,
      lastLetterAt: p.lastLetterAt || {},
      notifyEnabled: !!p.notifyEnabled
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
      questionnaires: state.questionnaires || [],
      groups: state.groups || [],
      userBalance: state.userBalance,
      theme: state.theme,
      playMode: state.playMode || 'order',
      userAvatar: state.userAvatar || null,
      userAvatarPool: state.userAvatarPool || [],
      userName: state.userName || '昕',
      lastProactiveAt: state.lastProactiveAt || {},
      momentsCover: state.momentsCover || null,
      unread: state.unread || {},
      groupUnread: state.groupUnread || {},
      pinned: state.pinned || [],
      letters: (state.letters || []).slice(-80),
      mailboxConfig: state.mailboxConfig || { ...DEFAULT_MAILBOX },
      mailboxUnread: state.mailboxUnread || 0,
      momentNotifs: state.momentNotifs || 0,
      lastLetterAt: state.lastLetterAt || {},
      notifyEnabled: !!state.notifyEnabled,
      _v: 13
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
    // 同时写在 html 与 #app，保证全局 CSS 变量生效
    document.documentElement.setAttribute('data-theme', name);
    if (app) app.setAttribute('data-theme', name);
    document.body && document.body.setAttribute('data-theme', name);
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
  function formatTimeDivider(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay) return '今天 ' + hm;
    if (d.toDateString() === yest.toDateString()) return '昨天 ' + hm;
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + hm;
    return d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate() + ' ' + hm;
  }
  function shouldShowTimeDivider(prev, cur) {
    if (!cur || !cur.time) return false;
    if (!prev || !prev.time) return true;
    return Math.abs(cur.time - prev.time) >= 5 * 60 * 1000; // 5 分钟
  }

  function formatSec(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  function randomDelay(a, b) { return a + Math.random() * (b - a); }
  /** 0~1 概率命中（与 mochi「0~100% 再 /100」等价） */
  function rollChance(p01) {
    const p = Number(p01);
    if (!isFinite(p) || p <= 0) return false;
    if (p >= 1) return true;
    return Math.random() < p;
  }
  /** 0~100 百分比命中（mochi 风格 Math.random()*100 < pct） */
  function rollPercent(pct) {
    const p = Number(pct);
    if (!isFinite(p) || p <= 0) return false;
    if (p >= 100) return true;
    return Math.random() * 100 < p;
  }

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
    if (name !== 'chat') {
      document.getElementById('app')?.classList.remove('chat-detail-open');
    } else if (!state.chatContactId) {
      document.getElementById('app')?.classList.remove('chat-detail-open');
    }
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
    } else if (name === 'me') {
      pageTitle.textContent = '我';
      ensureMeMenu();
      updateMeAvatarUI();
      updateStats();
      updateThemeUI();
      updateNotifyUI();
      const ub = $('#user-balance'); if (ub) ub.textContent = state.userBalance;
    } else if (name === 'interact') {
      pageTitle.textContent = '互动';
      document.querySelector('.discover-list')?.classList.remove('hidden');
      $('#music-subpage')?.classList.add('hidden');
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
    if (msg.type === 'listen_invite') return '[一起听] ' + (msg.songTitle || msg.text || '');
    if (msg.type === 'transfer') return `[转账] ${msg.amount} 星币`;
    if (msg.type === 'redpacket') return `[红包] ${msg.note || '恭喜发财'}`;
    if (msg.type === 'sticker') return '[表情]';
    if (msg.type === 'image') return '[图片]';
    if (msg.type === 'survey') return '[问卷] ' + (msg.title || '');
    if (msg.type === 'ask') return '[提问] ' + (msg.title || msg.text || '');
    return (msg.from === 'user' ? '我: ' : '') + (msg.text || '');
  }

  function sessionKey(kind, id) { return (kind === 'group' ? 'g:' : 'c:') + id; }
  function isPinned(kind, id) {
    return (state.pinned || []).includes(sessionKey(kind, id));
  }
  function togglePin(kind, id) {
    const k = sessionKey(kind, id);
    if (!state.pinned) state.pinned = [];
    const i = state.pinned.indexOf(k);
    if (i >= 0) state.pinned.splice(i, 1);
    else state.pinned.unshift(k);
    saveData();
    renderChatList();
  }
  function addUnread(kind, id, n) {
    n = n || 1;
    if (kind === 'group') {
      if (!state.groupUnread) state.groupUnread = {};
      state.groupUnread[id] = (state.groupUnread[id] || 0) + n;
    } else {
      if (!state.unread) state.unread = {};
      state.unread[id] = (state.unread[id] || 0) + n;
    }
    updateTabDots();
  }
  function clearUnread(kind, id) {
    if (kind === 'group') {
      if (state.groupUnread) state.groupUnread[id] = 0;
    } else {
      if (state.unread) state.unread[id] = 0;
    }
    saveData();
    updateTabDots();
  }
  function totalUnread() {
    let n = 0;
    Object.values(state.unread || {}).forEach(v => n += (v || 0));
    Object.values(state.groupUnread || {}).forEach(v => n += (v || 0));
    return n;
  }
  function updateTabDots() {
    const chatTab = document.querySelector('.tab-item[data-page="chat"]');
    if (chatTab) {
      let dot = chatTab.querySelector('.tab-dot');
      if (!dot) { dot = document.createElement('span'); dot.className = 'tab-dot'; chatTab.appendChild(dot); }
      dot.classList.toggle('on', totalUnread() > 0);
    }
    const interTab = document.querySelector('.tab-item[data-page="interact"]');
    if (interTab) {
      let dot = interTab.querySelector('.tab-dot');
      if (!dot) { dot = document.createElement('span'); dot.className = 'tab-dot'; interTab.appendChild(dot); }
      const on = (state.mailboxUnread || 0) + (state.momentNotifs || 0) > 0;
      dot.classList.toggle('on', on);
    }
    const bm = $('#badge-mailbox');
    if (bm) {
      const u = state.mailboxUnread || 0;
      bm.textContent = u > 99 ? '99+' : String(u);
      bm.classList.toggle('hidden', u <= 0);
    }
    const bn = $('#badge-moments');
    const bn2 = $('#badge-moments-main');
    const mn = state.momentNotifs || 0;
    [bn, bn2].forEach(el => {
      if (!el) return;
      el.textContent = mn > 99 ? '99+' : String(mn);
      el.classList.toggle('hidden', mn <= 0);
    });
  }

  function showInAppPopup(opts) {
    // 站内顶部弹窗：不在当前会话时提醒
    opts = opts || {};
    let layer = $('#in-app-popup');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'in-app-popup';
      layer.className = 'in-app-popup hidden';
      layer.innerHTML = `<div class="in-app-popup-inner">
        <div class="in-app-popup-av" id="iap-av"></div>
        <div class="in-app-popup-text">
          <div class="in-app-popup-title" id="iap-title"></div>
          <div class="in-app-popup-body" id="iap-body"></div>
        </div>
        <button type="button" class="in-app-popup-close" id="iap-close">✕</button>
      </div>`;
      document.body.appendChild(layer);
      layer.addEventListener('click', (e) => {
        if (e.target.closest('#iap-close')) {
          layer.classList.add('hidden');
          return;
        }
        if (e.target.closest('.in-app-popup-inner')) {
          const cid = layer.dataset.contactId;
          const kind = layer.dataset.kind;
          layer.classList.add('hidden');
          if (kind === 'mailbox') {
            switchPage('interact');
            openMailboxPage();
          } else if (cid) {
            switchPage('chat');
            enterChat(cid);
          }
        }
      });
    }
    const title = opts.title || '新消息';
    const body = opts.body || '';
    $('#iap-title').textContent = title;
    $('#iap-body').textContent = body;
    const av = $('#iap-av');
    if (av) {
      const c = opts.contactId ? state.contacts.find(x => x.id === opts.contactId) : null;
      if (c && c.avatarImg) {
        av.style.backgroundImage = `url(${c.avatarImg})`;
        av.textContent = '';
      } else if (c) {
        av.style.backgroundImage = '';
        av.style.background = c.avatarColor || 'var(--accent)';
        av.textContent = (c.name || '?').charAt(0);
      } else {
        av.style.backgroundImage = '';
        av.style.background = 'var(--accent)';
        av.textContent = '信';
      }
    }
    layer.dataset.contactId = opts.contactId || '';
    layer.dataset.kind = opts.kind || 'chat';
    layer.classList.remove('hidden');
    clearTimeout(showInAppPopup._t);
    showInAppPopup._t = setTimeout(() => layer.classList.add('hidden'), 4500);
  }

  function maybeBrowserNotify(contact, msg) {
    try {
      const viewingThis = state.chatContactId === (contact && contact.id);
      // 站内弹窗：只要不在该会话就提示（即使页面在前台）
      if (!viewingThis && contact) {
        let body = '[新消息]';
        if (msg) {
          if (msg.type === 'sticker') body = '[表情]';
          else if (msg.type === 'image') body = '[图片]';
          else if (msg.type === 'listen_invite') body = '[一起听邀请]';
          else if (msg.type === 'poke' || msg.type === 'system') body = msg.text || body;
          else if (msg.text) body = String(msg.text).slice(0, 60);
          else body = getPreviewText(msg) || body;
        }
        showInAppPopup({
          title: contact.name || '联系人',
          body,
          contactId: contact.id,
          kind: 'chat'
        });
      }
      if (!state.notifyEnabled) return;
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible' && viewingThis) return;
      const title = (contact && contact.name) ? contact.name : '字笺';
      let body = '[新消息]';
      if (msg) {
        if (msg.type === 'sticker') body = '[表情]';
        else if (msg.type === 'image') body = '[图片]';
        else if (msg.type === 'poke' || msg.type === 'system') body = msg.text || body;
        else if (msg.text) body = String(msg.text).slice(0, 80);
        else body = getPreviewText(msg) || body;
      }
      const tag = 'zijian-' + (contact && contact.id) + '-' + (msg && msg.id ? msg.id : Date.now());
      if (document.visibilityState !== 'visible') {
        document.title = '（新消息）' + title;
      }
      const n = new Notification(title, {
        body,
        tag,
        renotify: true,
        silent: false
      });
      n.onclick = function () {
        try { window.focus(); } catch (_) {}
        n.close();
        if (contact && contact.id) {
          switchPage('chat');
          enterChat(contact.id);
        }
      };
    } catch (e) { console.warn('notify', e); }
  }

  function requestNotifyPermission() {
    if (typeof Notification === 'undefined') {
      alert('当前浏览器不支持系统通知');
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then(function (p) {
      state.notifyEnabled = (p === 'granted');
      saveData();
      updateNotifyUI();
      if (p === 'granted') alert('已开启：离开页面时有新消息会尝试弹出通知');
      else alert('未获得通知权限，可在浏览器设置中允许本站通知');
      return state.notifyEnabled;
    });
  }

  function updateNotifyUI() {
    const btn = document.getElementById('btn-toggle-notify');
    if (btn) btn.textContent = state.notifyEnabled ? '通知：已开启' : '通知：未开启';
  }

  function notifyContactMessage(contactId, msg) {
    if (!msg || msg.from === 'user' || msg.from === 'system') return;
    if (state.chatContactId === contactId) return;
    addUnread('contact', contactId, 1);
    saveData();
    if (!state.chatContactId) renderChatList();
  }

  function getGroupPreviewText(msg) {
    if (!msg) return '暂无消息，点击进入群聊';
    if (msg.type === 'sticker') return (msg.from === 'user' ? '我: ' : ((msg.name || '') + ': ')) + '[表情]';
    const who = msg.from === 'user' ? '我' : (msg.name || '');
    const text = msg.text || '[消息]';
    return who ? `${who}: ${text}` : text;
  }

  function renderChatList() {
    const contactItems = (state.contacts || []).map(c => {
      const msgs = state.chats[c.id] || [];
      return {
        kind: 'contact',
        id: c.id,
        contact: c,
        last: msgs.length ? msgs[msgs.length - 1] : null,
        time: msgs.length ? msgs[msgs.length - 1].time : 0
      };
    });
    const groupItems = (state.groups || []).map(g => {
      const msgs = g.messages || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return {
        kind: 'group',
        id: g.id,
        group: g,
        last,
        time: last ? last.time : (g.createdAt || 0)
      };
    });
    const items = contactItems.concat(groupItems).sort((a, b) => {
      const pa = isPinned(a.kind === 'group' ? 'group' : 'contact', a.id) ? 1 : 0;
      const pb = isPinned(b.kind === 'group' ? 'group' : 'contact', b.id) ? 1 : 0;
      if (pb !== pa) return pb - pa;
      return (b.time || 0) - (a.time || 0);
    });
    if (!items.length) {
      chatList.innerHTML = '';
      chatListEmpty.classList.remove('hidden');
      return;
    }
    chatListEmpty.classList.add('hidden');
    chatList.innerHTML = items.map(it => {
      if (it.kind === 'group') {
        const g = it.group;
        const av = g.avatarImg
          ? `<div class="avatar chat-group-av" style="background-image:url(${g.avatarImg})"></div>`
          : `<div class="avatar chat-group-av" style="background:#5B8DEF">群</div>`;
        const n = (g.memberIds || []).length;
        const ur = (state.groupUnread && state.groupUnread[g.id]) || 0;
        const pin = isPinned('group', g.id);
        return `<div class="chat-item ${pin ? 'pinned' : ''}" data-kind="group" data-id="${g.id}">
          ${av}
          <div class="chat-item-info">
            <div class="chat-item-name">${pin ? '<span class="chat-pin-mark">置顶</span>' : ''}${escapeHtml(g.name || '未命名群聊')} <span class="chat-group-tag">${n}人</span></div>
            <div class="chat-item-preview">${escapeHtml(getGroupPreviewText(it.last))}</div>
          </div>
          <div class="chat-item-time">${it.last ? formatTime(it.last.time) : ''}</div>
          ${ur ? `<span class="unread-badge">${ur > 99 ? '99+' : ur}</span>` : ''}
        </div>`;
      }
      const contact = it.contact;
      const ur = (state.unread && state.unread[contact.id]) || 0;
      const pin = isPinned('contact', contact.id);
      return `<div class="chat-item ${pin ? 'pinned' : ''}" data-kind="contact" data-id="${contact.id}">
        ${renderAvatarEl(contact)}
        <div class="chat-item-info">
          <div class="chat-item-name">${pin ? '<span class="chat-pin-mark">置顶</span>' : ''}${escapeHtml(contact.name)}</div>
          <div class="chat-item-preview">${escapeHtml(getPreviewText(it.last))}</div>
        </div>
        <div class="chat-item-time">${it.last ? formatTime(it.last.time) : ''}</div>
        ${ur ? `<span class="unread-badge">${ur > 99 ? '99+' : ur}</span>` : ''}
      </div>`;
    }).join('');
    chatList.querySelectorAll('.chat-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.kind === 'group') openGroupFromChatList(el.dataset.id);
        else enterChat(el.dataset.id);
      });
      let pt = null;
      const start = () => { pt = setTimeout(() => {
        const kind = el.dataset.kind === 'group' ? 'group' : 'contact';
        const pinned = isPinned(kind, el.dataset.id);
        if (confirm(pinned ? '取消置顶？' : '置顶该会话？')) togglePin(kind, el.dataset.id);
      }, 550); };
      const end = () => { if (pt) clearTimeout(pt); };
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchend', end);
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
    });
    updateTabDots();
  }

  function openGroupFromChatList(gid) {
    // 从聊天列表进入群聊：切到联系人页的群聊视图
    switchPage('contacts');
    openGroupPage();
    enterGroup(gid);
  }
  function showChatListView() {
    if (chatListView) {
      chatListView.classList.remove('hidden');
      chatListView.style.display = '';
    }
    if (chatDetailView) {
      chatDetailView.classList.add('hidden');
      chatDetailView.style.display = 'none';
    }
    if (btnBack) {
      btnBack.classList.add('hidden');
      btnBack.setAttribute('aria-hidden', 'true');
    }
    headerAvatar.classList.add('hidden');
    $('#btn-chat-more')?.classList.add('hidden');
    pageTitle.textContent = '聊天';
    state.quotingMsg = null;
    updateQuoteBar();
    document.getElementById('app')?.classList.remove('chat-detail-open');
  }
  function applyContactChatBg(id) {
    const c = state.contacts.find(x => x.id === id);
    if (!c) return;
    const el = messageList;
    if (!el) return;
    // 原比例：cover 只裁切不拉伸；禁止 100% 100%
    el.style.setProperty('background-size', 'cover', 'important');
    el.style.setProperty('background-position', 'center center', 'important');
    el.style.setProperty('background-repeat', 'no-repeat', 'important');
    el.style.setProperty('background-attachment', 'scroll', 'important');
    // 清除可能造成变形的属性
    el.style.removeProperty('background-width');
    el.style.removeProperty('background-height');
    if (c.chatBgImg) {
      el.style.setProperty('background-image', `url("${c.chatBgImg}")`, 'important');
      el.style.backgroundColor = 'transparent';
    } else if (c.chatBgColor) {
      el.style.setProperty('background-image', 'none', 'important');
      el.style.backgroundColor = c.chatBgColor;
    } else {
      el.style.setProperty('background-image', 'none', 'important');
      el.style.backgroundColor = '';
    }
  }
  function enterChat(id) {
    const c = state.contacts.find(x => x.id === id); if (!c) return;
    state.chatContactId = id;
    clearUnread('contact', id);
    if (chatListView) {
      chatListView.classList.add('hidden');
      chatListView.style.display = 'none';
    }
    if (chatDetailView) {
      chatDetailView.classList.remove('hidden');
      chatDetailView.style.display = 'flex';
    }
    if (btnBack) {
      btnBack.classList.remove('hidden');
      btnBack.removeAttribute('aria-hidden');
      btnBack.style.display = 'flex';
      btnBack.style.pointerEvents = 'auto';
      btnBack.style.zIndex = '200';
    }
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
    document.getElementById('app')?.classList.add('chat-detail-open');
  }
  function leaveChat() {
    // 不取消待发送的回复定时器，否则切走界面后联系人消息会丢失
    try { hideTyping(); } catch (_) {}
    state.chatContactId = null;
    state.quotingMsg = null;
    state.activeGroupId = null;
    $('#btn-chat-more')?.classList.add('hidden');
    const pin = $('#chat-pin-memorial');
    if (pin) { pin.classList.add('hidden'); pin.textContent = ''; }
    const settings = $('#chat-settings-page');
    if (settings) settings.classList.add('hidden');
    document.getElementById('app')?.classList.remove('chat-detail-open');
    showChatListView();
    renderChatList();
    // 确保仍在聊天 Tab
    const pageChat = $('#page-chat');
    if (pageChat && !pageChat.classList.contains('active')) {
      switchPage('chat');
    }
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
      <div class="settings-cell"><span>对方星币</span><span class="val">${ensureContactShape(c).balance ?? 0} ★</span></div>
      <div class="settings-cell" id="cs-avatar"><span>设置头像</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-bg"><span>设置聊天背景</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-search"><span>搜索聊天记录</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-pin"><span>置顶会话</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-status"><span>状态</span><span class="val">${escapeHtml(c.currentStatus || '')} ›</span></div>
      <div class="settings-section-title">回复</div>
      <div class="settings-cell"><span>最小延迟(秒)</span><input type="number" id="cs-min" step="0.5" value="${s.minDelay}"/></div>
      <div class="settings-cell"><span>最大延迟(秒)</span><input type="number" id="cs-max" step="0.5" value="${s.maxDelay}"/></div>
      <div class="settings-cell"><span>每次最多回复条数</span><input type="number" id="cs-count" min="1" max="3" value="${s.maxReplies}"/></div>
      <div class="settings-cell"><span>回复概率 %</span><input type="number" id="cs-reply" step="1" min="0" max="100" value="${Math.round((lc.replyChance||0)*100)}"/></div>
      <div class="settings-cell"><span>已读不回概率 %</span><input type="number" id="cs-noreply" step="1" min="0" max="100" value="${Math.round((lc.readNoReplyChance||0)*100)}"/></div>
      <div class="settings-section-title">互动概率（单位：%）</div>
      <div class="settings-cell"><span>一起听·暂停 %</span><input type="number" id="cs-pause" step="1" min="0" max="100" value="${Math.round((lc.pauseChance||0)*100)}"/></div>
      <div class="settings-cell"><span>一起听·收藏歌曲 %</span><input type="number" id="cs-fav" step="1" min="0" max="100" value="${Math.round((lc.favoriteChance||0)*100)}"/></div>
      <div class="settings-cell"><span>邀请一起听 %</span><input type="number" id="cs-listen-invite" step="1" min="0" max="100" value="${Math.round(((lc.listenInviteChance != null ? lc.listenInviteChance : 0.18)||0)*100)}"/></div>
      <div class="settings-cell"><span>一起听·收藏歌词 %</span><input type="number" id="cs-lyric-fav" step="1" min="0" max="100" value="${Math.round(((lc.lyricFavoriteChance != null ? lc.lyricFavoriteChance : 0.2)||0)*100)}"/></div>
      <div class="settings-cell"><span>暂停最长秒数</span><input type="number" id="cs-pdur" min="1" max="30" value="${lc.pauseDurationMax}"/></div>
      <div class="settings-cell"><span>拼字卡 %</span><input type="number" id="cs-splice" step="1" min="0" max="100" value="${Math.round(((lc.spliceChance != null ? lc.spliceChance : 0.35)||0)*100)}"/></div>
      <div class="settings-cell"><span>拼字最少片数</span><input type="number" id="cs-splice-min" min="2" max="6" value="${lc.spliceMin != null ? lc.spliceMin : 2}"/></div>
      <div class="settings-cell"><span>拼字最多片数</span><input type="number" id="cs-splice-max" min="2" max="8" value="${lc.spliceMax != null ? lc.spliceMax : 4}"/></div>
      <div class="settings-cell"><span>朋友圈发动态 %</span><input type="number" id="cs-moments" step="1" min="0" max="100" value="${Math.round((lc.momentsChance||0)*100)}"/></div>
      <div class="settings-cell"><span>评论朋友圈回复 %</span><input type="number" id="cs-moment-comment" step="1" min="0" max="100" value="${Math.round(((lc.momentCommentChance != null ? lc.momentCommentChance : 0.65)||0)*100)}"/></div>
      <div class="settings-cell"><span>主动拍一拍 %</span><input type="number" id="cs-poke" step="1" min="0" max="100" value="${Math.round((lc.pokeChance||0)*100)}"/></div>
      <div class="settings-cell"><span>主动发消息间隔(分钟)</span><input type="number" id="cs-proactive" min="0" max="10080" value="${lc.proactiveIntervalMin == null ? 30 : lc.proactiveIntervalMin}"/></div>
      <div class="settings-section-title" style="padding-top:0">间隔为 0 则关闭主动发消息</div>
      <div class="settings-section-title">头像池 · 提问</div>
      <div class="settings-cell" id="cs-avatar-pool"><span>对方头像池</span><span class="val">›</span></div>
      <div class="settings-cell" id="cs-user-avatar-pool"><span>我的头像池</span><span class="val">›</span></div>
      <div class="settings-cell"><span>头像随机更换 %</span><input type="number" id="cs-av-swap" step="1" min="0" max="100" value="${Math.round(((lc.avatarSwapChance != null ? lc.avatarSwapChance : 0.08)||0)*100)}"/></div>
      <div class="settings-cell"><span>查岗提问 %</span><input type="number" id="cs-ask-chance" step="1" min="0" max="100" value="${Math.round(((lc.askChance != null ? lc.askChance : 0.1)||0)*100)}"/></div>
      <div class="settings-cell"><span>回答问卷/提问最短(秒)</span><input type="number" id="cs-ask-min" step="0.5" min="0.5" max="120" value="${lc.askMinDelay != null ? lc.askMinDelay : 2}"/></div>
      <div class="settings-cell"><span>回答问卷/提问最长(秒)</span><input type="number" id="cs-ask-max" step="0.5" min="0.5" max="300" value="${lc.askMaxDelay != null ? lc.askMaxDelay : 8}"/></div>
      <div style="padding:16px"><button class="btn-primary" id="cs-save" style="width:100%">保存</button></div>`;
    page.classList.remove('hidden');

    $('#cs-avatar-pool')?.addEventListener('click', () => openAvatarPoolModal('contact'));
    $('#cs-user-avatar-pool')?.addEventListener('click', () => openAvatarPoolModal('user'));
    $('#cs-avatar')?.addEventListener('click', () => {
      state.currentContactId = c.id;
      $('#file-avatar')?.click();
    });
    $('#cs-bg')?.addEventListener('click', () => {
      state.currentContactId = c.id;
      openBgModal();
    });
    $('#cs-search')?.addEventListener('click', () => {
      $('#chat-settings-page')?.classList.add('hidden');
      openChatSearch();
    });
    $('#cs-pin')?.addEventListener('click', () => {
      togglePin('contact', c.id);
      alert(isPinned('contact', c.id) ? '已置顶' : '已取消置顶');
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
      // 界面为百分比 0~100，内部存 0~1
      const pct01 = (id, defPct) => {
        const v = parseFloat($(id)?.value);
        const pct = isNaN(v) ? defPct : v;
        return Math.max(0, Math.min(1, pct / 100));
      };
      let spliceMin = Math.max(2, Math.min(6, parseInt($('#cs-splice-min')?.value, 10) || 2));
      let spliceMax = Math.max(spliceMin, Math.min(8, parseInt($('#cs-splice-max')?.value, 10) || 4));
      c.listenConfig = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {}, {
        pauseChance: pct01('#cs-pause', 18),
        favoriteChance: pct01('#cs-fav', 12),
        lyricFavoriteChance: pct01('#cs-lyric-fav', 20),
        listenInviteChance: pct01('#cs-listen-invite', 18),
        pauseDurationMax: Math.max(1, Math.min(30, num('#cs-pdur', 6))),
        momentsChance: pct01('#cs-moments', 15),
        replyChance: pct01('#cs-reply', 92),
        readNoReplyChance: pct01('#cs-noreply', 8),
        pokeChance: pct01('#cs-poke', 10),
        proactiveIntervalMin: Math.max(0, Math.min(10080, num('#cs-proactive', 30))),
        avatarSwapChance: pct01('#cs-av-swap', 8),
        askChance: pct01('#cs-ask-chance', 10),
        askMinDelay: Math.max(0.5, Math.min(120, num('#cs-ask-min', 2))),
        askMaxDelay: (function () {
          var amin = Math.max(0.5, Math.min(120, num('#cs-ask-min', 2)));
          var amax = Math.max(0.5, Math.min(300, num('#cs-ask-max', 8)));
          return Math.max(amin, amax);
        })(),
        spliceChance: pct01('#cs-splice', 35),
        spliceMin,
        spliceMax,
        momentsSticker: (c.listenConfig && c.listenConfig.momentsSticker) !== false,
        momentCommentChance: pct01('#cs-moment-comment', 65)
      });
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
      const imgs = (m.images && m.images.length) ? m.images : (m.imageData ? [m.imageData] : []);
      const grid = imgs.map(src => `<img src="${src}" alt="图片"/>`).join('');
      const cap = m.text ? `<div class="msg-photo-cap">${escapeHtml(m.text)}</div>` : '';
      return `<div class="msg-bubble msg-photo ${imgs.length > 1 ? 'multi' : ''}" style="padding:4px;background:transparent;box-shadow:none"><div class="msg-photo-grid n${Math.min(imgs.length, 9)}">${grid}</div>${cap}</div>`;
    }
    if (m.type === 'survey' || m.type === 'ask') {
      const done = !!m.answered;
      const qs = m.questions || [];
      let html = `<div class="msg-bubble msg-survey" data-survey-id="${m.id}"><div class="sv-title">${escapeHtml(m.title || (m.type === 'ask' ? '提问' : '问卷'))}</div>`;
      qs.forEach((q, qi) => {
        const typeLabel = q.type === 'multi' ? '多选' : (q.type === 'text' ? '简答' : '单选');
        html += `<div class="sv-q">${qi + 1}. ${escapeHtml(q.text)}<span class="sv-q-type">·${typeLabel}</span></div>`;
        if (done) {
          const ans = (m.answers && m.answers[qi]) || '';
          html += `<div class="sv-answer">答：${escapeHtml(Array.isArray(ans) ? ans.join('、') : String(ans))}</div>`;
        } else if (q.type === 'text') {
          // 对方发来的问卷：用户填写；用户发出的：等待对方
          if (m.from === 'contact') {
            html += `<input class="sv-text" data-qi="${qi}" placeholder="填写回答…"/>`;
          } else {
            html += `<div class="sv-done">等待对方回答…</div>`;
          }
        } else {
          const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
          const name = `sv_${m.id}_${qi}`;
          (q.options || []).forEach((opt, oi) => {
            if (m.from === 'contact') {
              html += `<label class="sv-opt"><input type="${inputType}" name="${name}" value="${escapeHtml(opt)}" data-qi="${qi}"/> ${escapeHtml(opt)}</label>`;
            } else {
              html += `<div class="sv-opt">${escapeHtml(opt)}</div>`;
            }
          });
        }
      });
      if (!done && m.from === 'contact') {
        html += `<button type="button" class="sv-submit" data-survey-submit>提交回答</button>`;
      } else if (done) {
        html += `<div class="sv-done">已回答</div>`;
      }
      html += `</div>`;
      return html;
    }
    if (m.type === 'listen_invite') {
      const st = m.status || 'pending';
      let actions = '';
      if (st === 'pending' && m.from === 'contact') {
        actions = `<div class="li-actions">
          <button type="button" class="li-accept" data-li-act="accept">接受</button>
          <button type="button" class="li-reject" data-li-act="reject">拒绝</button>
        </div>`;
      } else if (st === 'accepted') {
        actions = `<div class="li-song">已接受</div>`;
      } else if (st === 'rejected') {
        actions = `<div class="li-song">已拒绝</div>`;
      }
      return `<div class="msg-bubble msg-listen-invite" data-li-id="${m.id}">
        <div class="li-title">邀请你一起听</div>
        <div class="li-song">♪ ${escapeHtml(m.songTitle || '')}${m.songArtist ? ' · ' + escapeHtml(m.songArtist) : ''}</div>
        ${actions}
      </div>`;
    }
    if (m.type === 'transfer' || m.type === 'redpacket') {
      const st = m.moneyStatus || (m.opened ? 'accepted' : 'pending');
      const isTf = m.type === 'transfer';
      let label;
      if (st === 'accepted') label = isTf ? '已收款' : '已领取';
      else if (st === 'returned') label = '已退还';
      else if (m.from === 'user') label = isTf ? '转账给对方' : (m.note || '红包');
      else label = isTf ? '转账给你' : (m.note || '红包');
      let extra = '';
      if (st === 'pending' && m.from === 'contact') {
        extra = `<div class="msg-money-actions">
          <button type="button" class="btn-accept" data-money-act="accept">接收</button>
          <button type="button" class="btn-return" data-money-act="return">退还</button>
        </div>`;
      } else if (st === 'pending' && m.from === 'user') {
        extra = `<div class="tf-note" style="opacity:.85;font-size:11px">等待对方处理…</div>`;
      }
      if (isTf) {
        return `<div class="msg-bubble msg-transfer ${st}" data-money-id="${m.id}"><div class="tf-label">${label}</div><div class="tf-amount">${m.amount}<span class="tf-unit"> 星币</span></div>${m.note && st==='pending'?`<div class="tf-note">${escapeHtml(m.note)}</div>`:''}${extra}</div>`;
      }
      return `<div class="msg-bubble msg-redpacket ${st}" data-money-id="${m.id}"><div class="rp-icon">🧧</div><div class="rp-body"><div class="rp-title">${escapeHtml(label)}</div><div class="rp-amount">${m.amount} 星币</div>${extra}</div></div>`;
    }
    let q = '';
    if (m.quote) {
      const qf = m.quote.from === 'user' ? '我' : (state.contacts.find(c=>c.id===state.chatContactId)?.name||'对方');
      q = `<div class="msg-quote"><div class="msg-quote-from">${escapeHtml(qf)}</div><div>${escapeHtml(truncate(m.quote.text||'',40))}</div></div>`;
    }
    return `<div class="msg-bubble">${q}${escapeHtml(m.text||'')}</div>`;
  }

  function refreshMoneyRow(msgId) {
    if (!state.chatContactId) return;
    const row = messageList?.querySelector(`.msg-row[data-id="${msgId}"]`);
    const msgs = state.chats[state.chatContactId] || [];
    const m = msgs.find(x => x.id === msgId);
    if (!row || !m) return;
    const av = row.querySelector('.msg-avatar');
    const avHtml = av ? av.outerHTML : msgAvatarHtml(m.from);
    const cls = m.from === 'user' ? 'user' : 'contact';
    const body = `<div class="msg-col">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div>${readStatusHtml(m)}</div>`;
    row.innerHTML = cls === 'contact' ? avHtml + body : body + avHtml;
    bindMsgRowEvents(row);
  }

  function settleMoney(msg, action, contactOpt) {
    // action: accept | return
    if (!msg || (msg.moneyStatus && msg.moneyStatus !== 'pending')) return;
    const contactId = msg._contactId || contactOpt?.id || state.chatContactId;
    const c = contactOpt || state.contacts.find(x => x.id === contactId);
    if (!c) return;
    ensureContactShape(c);
    const amt = Number(msg.amount) || 0;
    if (action === 'accept') {
      msg.moneyStatus = 'accepted';
      msg.opened = true;
      if (msg.from === 'contact') {
        state.userBalance = Math.round((state.userBalance + amt) * 100) / 100;
      } else {
        c.balance = Math.round((c.balance + amt) * 100) / 100;
      }
    } else {
      msg.moneyStatus = 'returned';
      msg.opened = true;
      if (msg.from === 'contact') {
        c.balance = Math.round((c.balance + amt) * 100) / 100;
      } else {
        state.userBalance = Math.round((state.userBalance + amt) * 100) / 100;
      }
    }
    const ub = $('#user-balance');
    if (ub) ub.textContent = state.userBalance;
    saveData();
    if (state.chatContactId === c.id) {
      refreshMoneyRow(msg.id);
      // 整表重绘更稳妥
      renderMessages();
    }
    if (msg.type === 'redpacket' && action === 'accept' && msg.from === 'contact' && state.chatContactId === c.id) {
      const overlay = $('#rp-open-overlay');
      if (overlay) {
        $('#rp-open-amount').textContent = amt;
        $('#rp-open-note').textContent = msg.note || '恭喜发财';
        overlay.classList.remove('hidden');
      }
    }
  }

  function scheduleContactMoneyResponse(msg, contact) {
    if (!msg || !contact) return;
    msg._contactId = contact.id;
    const delay = randomDelay(1.2, 3.5);
    state.pendingTimers.push(setTimeout(() => {
      if (!msg || msg.moneyStatus !== 'pending') return;
      const act = Math.random() < 0.72 ? 'accept' : 'return';
      settleMoney(msg, act, contact);
      // 系统提示一条
      if (state.chatContactId === contact.id) {
        const tip = {
          id: genId('m'), from: 'system', type: 'system',
          text: act === 'accept'
            ? `${contact.name}已收款`
            : `${contact.name}已退还转账/红包`,
          time: Date.now()
        };
        pushMsg(tip);
        appendMessage(tip);
      } else {
        if (!state.chats[contact.id]) state.chats[contact.id] = [];
        state.chats[contact.id].push({
          id: genId('m'), from: 'system', type: 'system',
          text: act === 'accept' ? `${contact.name}已收款` : `${contact.name}已退还`,
          time: Date.now()
        });
        saveData();
      }
    }, delay * 1000));
  }

  function tryContactSendMoney(contact) {
    ensureContactShape(contact);
    // 可能向系统申请星币
    if (Math.random() < 0.15) {
      const grant = Math.floor(Math.random() * 500000) + 1;
      contact.balance = Math.round((contact.balance + grant) * 100) / 100;
      saveData();
    }
    if (contact.balance < 1) return;
    if (Math.random() > 0.12) return; // 低概率发钱
    const kind = Math.random() < 0.5 ? 'redpacket' : 'transfer';
    const maxAmt = Math.min(contact.balance, 200);
    const amount = Math.round((Math.random() * maxAmt * 0.8 + 1) * 100) / 100;
    contact.balance = Math.round((contact.balance - amount) * 100) / 100;
    const msg = {
      id: genId('m'), from: 'contact', type: kind, amount,
      note: kind === 'redpacket' ? '恭喜发财' : '',
      time: Date.now(), moneyStatus: 'pending', opened: false
    };
    if (!state.chats[contact.id]) state.chats[contact.id] = [];
    state.chats[contact.id].push(msg);
    saveData();
    if (state.chatContactId === contact.id) appendMessage(msg);
    else renderChatList();
  }

  function bindMoneyOpen(row) {
    const el = row.querySelector('[data-money-id]');
    if (!el) return;
    el.querySelectorAll('[data-money-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = el.getAttribute('data-money-id');
        const msgs = state.chats[state.chatContactId] || [];
        const m = msgs.find(x => x.id === id);
        if (!m) return;
        settleMoney(m, btn.getAttribute('data-money-act'));
      });
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
      return `<div class="msg-row system" data-id="${m.id}">${renderMsgBubble(m)}</div>`;
    }
    const cls = m.from === 'user' ? 'user' : 'contact';
    const av = msgAvatarHtml(m.from);
    const spliceTag = (m.spliced && m.from === 'contact')
      ? `<div class="msg-splice-tag" title="${escapeHtml((m.pieces || []).join(' · '))}">自主拼字</div>`
      : '';
    const body = `<div class="msg-col">${renderMsgBubble(m)}${spliceTag}<div class="msg-time">${formatTime(m.time)}</div>${readStatusHtml(m)}</div>`;
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
    let html = '';
    msgs.forEach((m, i) => {
      const prev = i > 0 ? msgs[i - 1] : null;
      if (shouldShowTimeDivider(prev, m)) {
        html += `<div class="msg-time-divider"><span>${escapeHtml(formatTimeDivider(m.time))}</span></div>`;
      }
      html += buildMsgRowHtml(m);
    });
    messageList.innerHTML = html;
    messageList.querySelectorAll('.msg-row').forEach(bindMsgRowEvents);
    requestAnimationFrame(() => { messageList.scrollTop = messageList.scrollHeight; });
  }
  function appendMessage(msg) {
    const typing = messageList.querySelector('.typing-row'); if (typing) typing.remove();
    const list = state.chats[state.chatContactId] || [];
    const prev = list.length >= 2 ? list[list.length - 2] : null;
    if (shouldShowTimeDivider(prev, msg)) {
      const div = document.createElement('div');
      div.className = 'msg-time-divider';
      div.innerHTML = `<span>${escapeHtml(formatTimeDivider(msg.time))}</span>`;
      messageList.appendChild(div);
    }
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
  function pushMsg(msg, contactId) {
    const cid = contactId || state.chatContactId;
    if (!cid) return;
    if (!state.chats[cid]) state.chats[cid] = [];
    state.chats[cid].push(msg);
    if (msg && msg.from === 'contact') notifyContactMessage(cid, msg);
    saveData();
  }
  function clearPendingTimers() { state.pendingTimers.forEach(clearTimeout); state.pendingTimers = []; }
  function getContactCardPool(contact) {
    if (contact.cardGroups) {
      const all = Object.values(contact.cardGroups).flat().filter(Boolean);
      if (all.length) return all;
    }
    return contact.cards || [];
  }

  /** 拼字卡：返回 { text, spliced, pieces }；未触发拼字时 spliced=false */
  function composeSplicedCard(contact) {
    const pool = getContactCardPool(contact).filter(Boolean);
    if (!pool.length) return null;
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const chance = Number(lc.spliceChance != null ? lc.spliceChance : 0.35);
    if (!rollChance(chance)) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      return { text: t, spliced: false, pieces: [t] };
    }
    const minN = Math.max(2, Math.min(6, parseInt(lc.spliceMin, 10) || 2));
    const maxN = Math.max(minN, Math.min(8, parseInt(lc.spliceMax, 10) || 4));
    const n = minN + Math.floor(Math.random() * (maxN - minN + 1));
    // 优先用较短字卡更像「词片」
    const sorted = pool.slice().sort((a, b) => String(a).length - String(b).length);
    const short = sorted.filter(t => String(t).length <= 24);
    const src = short.length >= n ? short : pool;
    const picked = [];
    const used = new Set();
    for (let i = 0; i < n && i < src.length; i++) {
      let guard = 0;
      while (guard++ < 20) {
        const t = src[Math.floor(Math.random() * src.length)];
        const key = String(t);
        if (!used.has(key)) {
          used.add(key);
          picked.push(String(t).trim());
          break;
        }
      }
    }
    if (picked.length < 2) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      return { text: t, spliced: false, pieces: [t] };
    }
    // 片与片之间用空格或逗号隔开（随机，更像随手拼）
    const sep = Math.random() < 0.55 ? ' ' : '，';
    return { text: picked.join(sep), spliced: true, pieces: picked };
  }

  function deliverContactMsg(contact, msg) {
    if (!contact || !msg) return;
    if (!state.chats[contact.id]) state.chats[contact.id] = [];
    const arr = state.chats[contact.id];
    if (!arr.find(x => x.id === msg.id)) arr.push(msg);
    saveData();
    if (state.chatContactId === contact.id) {
      appendMessage(msg);
      hideTyping();
    } else {
      notifyContactMessage(contact.id, msg);
      maybeBrowserNotify(contact, msg);
    }
    if (state.listenContactId === contact.id) {
      try { renderListenChatMsgs(); } catch (_) {}
    }
    renderChatList();
    updateTabDots();
  }

  function scheduleReplies(contact, forceCount) {
    // 只清「本联系人」相关的旧定时器，避免打断其它会话的待发消息
    clearPendingTimers();
    const s = contact.settings || DEFAULT_SETTINGS;
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const minD = Math.max(0.5, s.minDelay || 1.5);
    const maxD = Math.max(minD, s.maxDelay || 4);
    const contactId = contact.id;

    const readDelay = randomDelay(
      Math.min(0.5, minD * 0.35),
      Math.min(2.2, Math.max(0.8, minD * 0.85))
    );

    const willNoreply = !forceCount && rollChance(lc.readNoReplyChance);
    const willSkipReply = !forceCount && !willNoreply &&
      !rollChance(lc.replyChance == null ? 1 : lc.replyChance);

    state.pendingTimers.push(setTimeout(() => {
      markUserMsgsRead(contactId, willNoreply || willSkipReply);
    }, readDelay * 1000));

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
        // 仅当前正在看该会话时显示“正在输入”
        if (state.chatContactId === contactId) showTyping();
      }, Math.max(0, (cum - d * 0.6) * 1000)));
      state.pendingTimers.push(setTimeout(() => {
        markUserMsgsRead(contactId, false);
        let msg;
        if (sendSticker) {
          const st = stickers[Math.floor(Math.random() * stickers.length)];
          msg = { id: genId('m'), from: 'contact', type: 'sticker', stickerId: st.id, stickerData: st.data, time: Date.now() };
        } else if (pool.length) {
          const composed = composeSplicedCard(contact);
          const text = (composed && composed.text) || pool[Math.floor(Math.random() * pool.length)];
          msg = {
            id: genId('m'), from: 'contact', type: 'text', text, time: Date.now(),
            spliced: !!(composed && composed.spliced),
            pieces: (composed && composed.pieces) || undefined
          };
        } else return;
        deliverContactMsg(contact, msg);
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
      // 切走界面也要回拍/回复，写入聊天记录
      if (rollChance(lc.pokeChance != null ? lc.pokeChance : 0.1)) {
        const acts = c.interactionCards?.length ? c.interactionCards : DEFAULT_INTERACTION;
        const back = {
          id: genId('m'), from: 'system', type: 'poke',
          text: `${c.name}${acts[Math.floor(Math.random() * acts.length)]}你`,
          time: Date.now()
        };
        if (!state.chats[c.id]) state.chats[c.id] = [];
        state.chats[c.id].push(back);
        saveData();
        if (state.chatContactId === c.id) appendMessage(back);
        else { notifyContactMessage(c.id, back); maybeBrowserNotify(c, back); }
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

  async function sendChatPhotos(files, caption) {
    if (!files?.length || !state.chatContactId) return;
    const c = state.contacts.find(x => x.id === state.chatContactId); if (!c) return;
    const imgs = [];
    for (const f of Array.from(files).slice(0, 9)) {
      try {
        const imageData = await compressImage(f, 720, 0.72);
        if (imageData) imgs.push(imageData);
      } catch (_) {}
    }
    if (!imgs.length) { alert('图片发送失败'); return; }
    const text = (caption || '').trim();
    if (imgs.length === 1 && !text) {
      const msg = { id: genId('m'), from: 'user', type: 'image', imageData: imgs[0], time: Date.now(), read: false };
      pushMsg(msg); appendMessage(msg);
    } else {
      const msg = {
        id: genId('m'), from: 'user', type: 'image',
        imageData: imgs[0], images: imgs, text: text || '',
        time: Date.now(), read: false
      };
      pushMsg(msg); appendMessage(msg);
    }
    hideAttachPanel();
    scheduleReplies(c);
  }
  async function sendChatPhoto(file) {
    return sendChatPhotos(file ? [file] : [], '');
  }

  function openChatPhotoComposer() {
    if (!state.chatContactId) return;
    state.modalMode = 'chat-photos';
    state._photoDraft = [];
    modalTitle.textContent = '发送图片';
    modalBody.innerHTML = `
      <div class="form-row"><label>文字说明（可选）</label>
        <textarea id="photo-caption" rows="2" placeholder="配一句说明…"></textarea>
      </div>
      <div class="toolbar-row" style="margin:8px 0">
        <button type="button" class="btn-xs" id="photo-pick">选择图片（可多选，最多9张）</button>
        <span id="photo-count" style="font-size:12px;color:var(--muted)">未选</span>
      </div>
      <div id="photo-preview-row" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <p style="font-size:11px;color:var(--muted);margin-top:8px">点「确定」发送</p>`;
    modalOverlay.classList.remove('hidden');
    hideAttachPanel();
    $('#photo-pick')?.addEventListener('click', () => {
      const inp = $('#file-chat-photo');
      if (inp) { inp.multiple = true; inp.click(); }
    });
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
    const groups = Object.keys(c.cardGroups);
    if (!groups.includes(state.activeCardGroup)) state.activeCardGroup = groups[0] || '默认';
    const gName = state.activeCardGroup;
    let list = c.cardGroups[gName] || [];
    const cardQ = (state.cardSearchQuery || '').trim().toLowerCase();
    if (cardQ) {
      list = list.map((t, i) => ({ t, i })).filter(x => String(x.t).toLowerCase().includes(cardQ));
    } else {
      list = list.map((t, i) => ({ t, i }));
    }
    // list items are {t, i} for stable index when filtering
    const selectMode = !!state.cardSelectMode;
    const selected = state.cardSelected || new Set();
    const mk = (text, idx, type) => {
      const checked = selected.has(type + ':' + idx) ? 'checked' : '';
      const selCls = selected.has(type + ':' + idx) ? ' selected' : '';
      const check = selectMode && type === 'normal'
        ? `<input type="checkbox" class="card-check" data-i="${idx}" data-t="${type}" ${checked}/>`
        : '';
      const actions = selectMode ? '' : `<div class="card-actions"><button class="card-btn edit" data-i="${idx}" data-t="${type}">✎</button><button class="card-btn delete" data-i="${idx}" data-t="${type}">✕</button></div>`;
      return `<div class="card-item ${type === 'interaction' ? 'interaction' : ''}${selectMode ? ' select-mode' : ''}${selCls}" data-i="${idx}" data-t="${type}">${check}<div class="card-text">${escapeHtml(text)}</div>${actions}</div>`;
    };
    const favSongs = (c.favorites || []).map(fid => state.songs.find(s => s.id === fid)).filter(Boolean);
    cardsPanel.innerHTML = `
      <div class="cards-header"><h2>${escapeHtml(c.name)}</h2>
        <button class="btn-xs" id="btn-open-chat">去聊天</button>
      </div>
      <div class="settings-summary">状态 <strong>${escapeHtml(c.currentStatus || '')}</strong> · 本组 ${list.length} 条</div>
      <div class="card-search-bar">
        <input type="search" id="card-search-input" class="search-input" placeholder="搜索本联系人字卡…" value="${escapeHtml(state.cardSearchQuery || '')}" autocomplete="off"/>
      </div>
      <div class="section-title">字卡分组</div>
      <div class="group-tabs" id="group-tabs">
        ${groups.map(g => `<button class="group-tab ${g === gName ? 'active' : ''}" data-g="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('')}
        <button class="group-tab" id="btn-add-group">+组</button>
      </div>
      <div class="toolbar-row" style="flex-wrap:wrap">
        <button class="btn-xs" id="btn-add-card">+ 字卡</button>
        <button class="btn-xs" id="btn-batch-cards">批量导入</button>
        <button class="btn-xs" id="btn-file-cards">文件导入</button>
        <button class="btn-xs" id="btn-dedup-cards">去重</button>
        <button class="btn-xs" id="btn-export-cards">导出</button>
        <button class="btn-xs" id="btn-select-cards">${selectMode ? '取消多选' : '多选整理'}</button>
      </div>
      ${selectMode ? `<div class="card-batch-bar">
        <button class="btn-xs" id="btn-sel-all">全选</button>
        <button class="btn-xs" id="btn-sel-del">删除所选</button>
        <button class="btn-xs" id="btn-sel-move">移到分组</button>
        <span style="font-size:12px;color:var(--muted)">已选 ${[...selected].filter(k => k.startsWith('normal:')).length}</span>
      </div>` : ''}
      <div class="card-list">${list.map(({ t, i }) => mk(t, i, 'normal')).join('') || '<div class="empty-state small"><p>' + (cardQ ? '无匹配字卡' : '暂无字卡') + '</p></div>'}</div>
      <div class="section-title">互动字卡 <button class="btn-add" id="btn-add-inter" style="margin-left:8px">+</button></div>
      <div class="card-list">${(c.interactionCards || []).map((t, i) => mk(t, i, 'interaction')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">查岗提问题库 <button class="btn-add" id="btn-add-askq" style="margin-left:8px">+</button></div>
      <div class="settings-summary" style="margin-top:0">对方按「查岗提问概率」随机出题；可自建单选/简答及回复</div>
      <div class="card-list" id="askq-list">${(c.askQuestions || []).map((q, i) => {
        const tip = q.type === 'single'
          ? `单选 · ${(q.options || []).map(o => o.t).join(' / ')}`
          : `简答 · 回复：${q.reply || '…'}`;
        return `<div class="card-item interaction" data-askqi="${i}">
          <div class="card-text"><strong>${escapeHtml(q.text || '')}</strong><div style="font-size:11px;color:var(--muted);margin-top:4px">${escapeHtml(tip)}</div></div>
          <div class="card-actions">
            <button class="card-btn edit" data-ask-edit="${i}">✎</button>
            <button class="card-btn delete" data-ask-del="${i}">✕</button>
          </div>
        </div>`;
      }).join('') || '<div class="empty-state small"><p>暂无查岗题。点 + 添加后，对方才会按概率向你提问</p></div>'}</div>
      <div class="cards-fav-block">
        <div class="section-title cards-fav-toggle" id="btn-toggle-fav-songs" style="cursor:pointer;user-select:none">
          TA 收藏的歌 · ${favSongs.length} 首 <span class="fav-caret">${state._favSongsOpen ? '▾' : '▸'}</span>
        </div>
        <div id="fav-songs-wrap" class="${state._favSongsOpen ? '' : 'hidden'}">
          ${favSongs.length ? favSongs.map(sg => `<div class="fav-song-item" data-sid="${sg.id}">
            <div class="song-cover" style="${sg.cover ? `background-image:url(${sg.cover})` : ''}">${sg.cover ? '' : '🎵'}</div>
            <div class="song-info"><div class="song-title">${escapeHtml(sg.title)}</div><div class="song-artist">${escapeHtml(sg.artist || '')}</div></div>
            <button type="button" class="btn-xs" data-fav-play="${sg.id}">听</button>
            <button type="button" class="btn-xs" data-fav-del="${sg.id}">删</button>
          </div>`).join('') : '<div class="empty-state small"><p>暂无收藏歌曲</p></div>'}
        </div>
        <div class="section-title cards-fav-toggle" id="btn-toggle-fav-lyrics" style="cursor:pointer;user-select:none">
          TA 收藏的歌词 · ${(c.favoriteLyrics||[]).length} 句 <span class="fav-caret">${state._favLyricsOpen ? '▾' : '▸'}</span>
        </div>
        <div id="fav-lyrics-wrap" class="card-list ${state._favLyricsOpen ? '' : 'hidden'}">
          ${(c.favoriteLyrics || []).length ? (c.favoriteLyrics || []).slice().reverse().map((line, ri) => {
            const realIdx = (c.favoriteLyrics.length - 1 - ri);
            return `<div class="card-item fav-lyric-item">
              <div class="card-text">${escapeHtml(line)}</div>
              <div class="card-actions"><button class="card-btn delete" data-lyric-del="${realIdx}">✕</button></div>
            </div>`;
          }).join('') : '<div class="empty-state small"><p>一起听时可能会收藏歌词</p></div>'}
        </div>
      </div>`;

    $('#group-tabs')?.querySelectorAll('.group-tab[data-g]').forEach(btn => {
      btn.addEventListener('click', () => { state.activeCardGroup = btn.dataset.g; state.cardSelected = new Set(); renderCardsPanel(); });
    });
    $('#btn-add-group')?.addEventListener('click', () => {
      const name = prompt('新分组名称');
      if (!name || !name.trim()) return;
      if (c.cardGroups[name.trim()]) { alert('已存在'); return; }
      c.cardGroups[name.trim()] = [];
      state.activeCardGroup = name.trim();
      saveData(); renderCardsPanel();
    });
    $('#card-search-input')?.addEventListener('input', (e) => {
      state.cardSearchQuery = e.target.value || '';
      // 防抖渲染
      clearTimeout(renderCardsPanel._st);
      renderCardsPanel._st = setTimeout(() => renderCardsPanel(), 180);
    });
    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add', 'normal'));
    $('#btn-add-inter')?.addEventListener('click', () => openCardModal('add', 'interaction'));
    $('#btn-add-askq')?.addEventListener('click', () => openAskQuestionEditor(null));
    $('#btn-toggle-fav-songs')?.addEventListener('click', () => {
      state._favSongsOpen = !state._favSongsOpen;
      renderCardsPanel();
    });
    $('#btn-toggle-fav-lyrics')?.addEventListener('click', () => {
      state._favLyricsOpen = !state._favLyricsOpen;
      renderCardsPanel();
    });

    cardsPanel.querySelectorAll('[data-fav-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sid = btn.getAttribute('data-fav-del');
        if (!confirm('从 TA 的收藏中移除这首歌？')) return;
        c.favorites = (c.favorites || []).filter(id => id !== sid);
        saveData();
        renderCardsPanel();
      });
    });
    cardsPanel.querySelectorAll('[data-fav-play]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openListenWithContact(btn.getAttribute('data-fav-play'), c.id);
      });
    });
    cardsPanel.querySelectorAll('[data-lyric-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = +btn.getAttribute('data-lyric-del');
        if (!confirm('删除这句收藏歌词？')) return;
        if (Array.isArray(c.favoriteLyrics) && i >= 0 && i < c.favoriteLyrics.length) {
          c.favoriteLyrics.splice(i, 1);
          saveData();
          renderCardsPanel();
        }
      });
    });

    cardsPanel.querySelectorAll('[data-ask-edit]').forEach(btn => {
      btn.addEventListener('click', () => openAskQuestionEditor(+btn.dataset.askEdit));
    });
    cardsPanel.querySelectorAll('[data-ask-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.askDel;
        if (!confirm('删除这道查岗题？')) return;
        c.askQuestions.splice(i, 1);
        saveData();
        renderCardsPanel();
      });
    });
    $('#btn-batch-cards')?.addEventListener('click', openBatchCardModal);
    $('#btn-file-cards')?.addEventListener('click', () => document.getElementById('file-cards-txt')?.click());
    $('#btn-dedup-cards')?.addEventListener('click', () => {
      const arr = c.cardGroups[gName] || [];
      const seen = new Set();
      const next = [];
      let removed = 0;
      arr.forEach(t => {
        const key = String(t).trim();
        if (!key || seen.has(key)) { removed++; return; }
        seen.add(key);
        next.push(t);
      });
      c.cardGroups[gName] = next;
      c.cards = Object.values(c.cardGroups).flat();
      saveData(); renderCardsPanel();
      alert(removed ? `已去除 ${removed} 条重复字卡` : '当前分组没有重复');
    });
    $('#btn-export-cards')?.addEventListener('click', () => {
      const arr = c.cardGroups[gName] || [];
      const blob = new Blob([arr.join('\n')], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${c.name}-${gName}-字卡.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#btn-select-cards')?.addEventListener('click', () => {
      state.cardSelectMode = !state.cardSelectMode;
      state.cardSelected = new Set();
      renderCardsPanel();
    });
    $('#btn-sel-all')?.addEventListener('click', () => {
      state.cardSelected = new Set(list.map((_, i) => 'normal:' + i));
      renderCardsPanel();
    });
    $('#btn-sel-del')?.addEventListener('click', () => {
      const idxs = [...(state.cardSelected || [])]
        .filter(k => k.startsWith('normal:'))
        .map(k => +k.split(':')[1])
        .sort((a, b) => b - a);
      if (!idxs.length) { alert('请先选择字卡'); return; }
      if (!confirm(`删除选中的 ${idxs.length} 条？`)) return;
      const arr = (c.cardGroups[gName] || []).slice();
      idxs.forEach(i => arr.splice(i, 1));
      c.cardGroups[gName] = arr;
      c.cards = Object.values(c.cardGroups).flat();
      state.cardSelected = new Set();
      saveData(); renderCardsPanel();
    });
    $('#btn-sel-move')?.addEventListener('click', () => {
      const idxs = [...(state.cardSelected || [])]
        .filter(k => k.startsWith('normal:'))
        .map(k => +k.split(':')[1])
        .sort((a, b) => b - a);
      if (!idxs.length) { alert('请先选择字卡'); return; }
      const target = prompt('移动到哪个分组？\n现有：' + groups.join('、'));
      if (!target || !target.trim()) return;
      const tg = target.trim();
      if (!c.cardGroups[tg]) c.cardGroups[tg] = [];
      const arr = (c.cardGroups[gName] || []).slice();
      const moved = [];
      idxs.forEach(i => { moved.push(arr[i]); arr.splice(i, 1); });
      c.cardGroups[gName] = arr;
      c.cardGroups[tg] = c.cardGroups[tg].concat(moved.reverse());
      c.cards = Object.values(c.cardGroups).flat();
      state.cardSelected = new Set();
      state.cardSelectMode = false;
      state.activeCardGroup = tg;
      saveData(); renderCardsPanel();
      alert(`已移动 ${moved.length} 条到「${tg}」`);
    });
    $('#btn-open-chat')?.addEventListener('click', () => {
      switchPage('chat');
      enterChat(c.id);
    });
    cardsPanel.querySelectorAll('.card-check').forEach(ck => {
      ck.addEventListener('change', () => {
        if (!state.cardSelected) state.cardSelected = new Set();
        const key = ck.dataset.t + ':' + ck.dataset.i;
        if (ck.checked) state.cardSelected.add(key);
        else state.cardSelected.delete(key);
        renderCardsPanel();
      });
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
      <div class="form-row"><label>一起听·暂停概率 %</label><input type="number" id="set-pause" step="1" min="0" max="100" value="${Math.round((lc.pauseChance||0)*100)}"/></div>
      <div class="form-row"><label>一起听·收藏概率 %</label><input type="number" id="set-fav" step="1" min="0" max="100" value="${Math.round((lc.favoriteChance||0)*100)}"/></div>
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

  function setListenDuoAvatars(contact) {
    const me = $('#listen-av-me');
    const ta = $('#listen-av-ta');
    if (me) {
      if (state.userAvatar) {
        me.style.backgroundImage = `url(${state.userAvatar})`;
        me.textContent = '';
      } else {
        me.style.backgroundImage = '';
        me.textContent = (state.userName || '我').charAt(0);
      }
    }
    if (ta && contact) {
      if (contact.avatarImg) {
        ta.style.backgroundImage = `url(${contact.avatarImg})`;
        ta.textContent = '';
      } else {
        ta.style.backgroundImage = '';
        ta.style.background = contact.avatarColor || 'var(--accent)';
        ta.textContent = (contact.name || '?').charAt(0);
      }
    }
  }

  function openListenWithContact(songId, contactId) {
    const song = state.songs.find(s => s.id === songId);
    const contact = state.contacts.find(c => c.id === contactId);
    if (!song || !contact) return;
    state.listenContactId = contactId;
    state.listenQueue = state.songs.map(s => s.id);
    state.listenIndex = Math.max(0, state.listenQueue.indexOf(songId));
    if (state.listenIndex < 0) {
      state.listenQueue.unshift(songId);
      state.listenIndex = 0;
    }
    if (listenWithName) listenWithName.textContent = `和 ${contact.name} 一起听`;
    setListenDuoAvatars(contact);
    updatePlayModeBtn();
    loadListenTrack(songId, true);
    listenPage.classList.remove('hidden');
    hideFloatPlayer();
    startListenSimulation();
    $('#listen-chat-panel')?.classList.add('hidden');
    renderListenChatMsgs();
  }

  function renderListenChatMsgs() {
    const box = $('#listen-chat-msgs');
    if (!box || !state.listenContactId) return;
    const msgs = (state.chats[state.listenContactId] || []).slice(-40);
    box.innerHTML = msgs.map(m => {
      if (m.from === 'system' || m.type === 'system' || m.type === 'poke') {
        return `<div class="listen-chat-bubble contact" style="align-self:center;opacity:.7;font-size:11px;background:transparent">${escapeHtml(m.text || '')}</div>`;
      }
      const cls = m.from === 'user' ? 'user' : 'contact';
      let text = m.text || '';
      if (m.type === 'sticker') text = '[表情]';
      else if (m.type === 'image') text = '[图片]';
      else if (m.type === 'listen_invite') text = '[一起听邀请]';
      else if (!text) text = getPreviewText(m) || '…';
      return `<div class="listen-chat-bubble ${cls}">${escapeHtml(text)}</div>`;
    }).join('') || '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px">还没有消息，打个招呼吧</div>';
    box.scrollTop = box.scrollHeight;
  }

  function sendListenChat() {
    const input = $('#listen-chat-input');
    const text = (input?.value || '').trim();
    if (!text || !state.listenContactId) return;
    const c = state.contacts.find(x => x.id === state.listenContactId);
    if (!c) return;
    const msg = { id: genId('m'), from: 'user', type: 'text', text, time: Date.now(), read: false };
    if (!state.chats[c.id]) state.chats[c.id] = [];
    state.chats[c.id].push(msg);
    saveData();
    if (input) input.value = '';
    renderListenChatMsgs();
    if (state.chatContactId === c.id) appendMessage(msg);
    scheduleReplies(c);
    const check = setInterval(() => {
      if (state.listenContactId === c.id) renderListenChatMsgs();
    }, 900);
    setTimeout(() => clearInterval(check), 25000);
  }

  function toggleListenChatPanel(forceOpen) {
    const panel = $('#listen-chat-panel');
    if (!panel) return;
    if (forceOpen === true) panel.classList.remove('hidden');
    else if (forceOpen === false) panel.classList.add('hidden');
    else panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) renderListenChatMsgs();
  }

  function tryContactListenInvite(contact) {
    if (!contact || !(state.songs || []).length) return false;
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const chance = Number(lc.listenInviteChance != null ? lc.listenInviteChance : 0.18);
    if (!rollChance(chance)) return false;
    if (state.listenContactId === contact.id && listenPage && !listenPage.classList.contains('hidden')) return false;
    const song = state.songs[Math.floor(Math.random() * state.songs.length)];
    if (!song) return false;
    const msg = {
      id: genId('m'), from: 'contact', type: 'listen_invite',
      songId: song.id, songTitle: song.title || '未知歌曲', songArtist: song.artist || '',
      text: `想和你一起听《${song.title || '这首歌'}》`,
      status: 'pending', time: Date.now()
    };
    if (!state.chats[contact.id]) state.chats[contact.id] = [];
    state.chats[contact.id].push(msg);
    saveData();
    if (state.chatContactId === contact.id) appendMessage(msg);
    else {
      notifyContactMessage(contact.id, msg);
      maybeBrowserNotify(contact, msg);
      renderChatList();
    }
    return true;
  }

  function acceptListenInvite(msg, contactId) {
    if (!msg || msg.status === 'accepted') return;
    msg.status = 'accepted';
    const tip = { id: genId('m'), from: 'system', type: 'system', text: '你接受了一起听邀请', time: Date.now() };
    if (!state.chats[contactId]) state.chats[contactId] = [];
    state.chats[contactId].push(tip);
    saveData();
    if (state.chatContactId === contactId) renderMessages();
    openListenWithContact(msg.songId, contactId);
    toggleListenChatPanel(true);
  }

  function rejectListenInvite(msg, contactId) {
    if (!msg || msg.status === 'rejected') return;
    msg.status = 'rejected';
    const tip = { id: genId('m'), from: 'system', type: 'system', text: '你拒绝了一起听邀请', time: Date.now() };
    if (!state.chats[contactId]) state.chats[contactId] = [];
    state.chats[contactId].push(tip);
    saveData();
    if (state.chatContactId === contactId) renderMessages();
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

  function pickCurrentOrRandomLyric() {
    const lines = (state.listenLyrics || []).filter(x => x && x.text && String(x.text).trim());
    if (!lines.length) return null;
    // 优先当前高亮行，否则随机
    const idx = typeof state.listenLyricIdx === 'number' ? state.listenLyricIdx : -1;
    if (idx >= 0 && idx < lines.length) return String(lines[idx].text).trim();
    // listenLyrics 可能与过滤后不同：用时间匹配
    try {
      const t = listenAudio && isFinite(listenAudio.currentTime) ? listenAudio.currentTime : 0;
      let cur = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time <= t) cur = lines[i];
        else break;
      }
      if (cur) return String(cur.text).trim();
    } catch (_) {}
    return String(lines[Math.floor(Math.random() * lines.length)].text).trim();
  }

  function collectLyricLine(contact, line) {
    if (!contact || !line) return false;
    if (!contact.favoriteLyrics) contact.favoriteLyrics = [];
    if (contact.favoriteLyrics.includes(line)) return false;
    contact.favoriteLyrics.push(line);
    if (contact.favoriteLyrics.length > 80) contact.favoriteLyrics = contact.favoriteLyrics.slice(-80);
    return true;
  }

  function pushSystemTip(contactId, text) {
    if (!contactId || !text) return;
    const msg = { id: genId('m'), from: 'system', type: 'system', text, time: Date.now() };
    if (!state.chats[contactId]) state.chats[contactId] = [];
    state.chats[contactId].push(msg);
    saveData();
    if (state.chatContactId === contactId) {
      try { appendMessage(msg); } catch (_) {}
    }
    if (state.listenContactId === contactId) {
      try { renderListenChatMsgs(); } catch (_) {}
    }
  }

  function startListenSimulation() {
    stopListenSimulation();
    const contact = state.contacts.find(c => c.id === state.listenContactId);
    if (!contact) return;
    ensureContactShape(contact);
    const cfg = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    state.listenInterval = setInterval(() => {
      if (listenAudio.paused) return;
      // 三段互斥；若总和>1 则按比例归一化，保证设置可同时生效
      let pPause = Math.max(0, Number(cfg.pauseChance) || 0);
      let pSong = Math.max(0, Number(cfg.favoriteChance) || 0);
      let pLyric = Math.max(0, Number(cfg.lyricFavoriteChance != null ? cfg.lyricFavoriteChance : 0.2) || 0);
      const sum = pPause + pSong + pLyric;
      if (sum > 1) {
        pPause /= sum; pSong /= sum; pLyric /= sum;
      }
      const r = Math.random();
      if (r < pPause) {
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
      } else if (r < pPause + pSong) {
        if (!contact.favorites) contact.favorites = [];
        if (state.listenSongId && !contact.favorites.includes(state.listenSongId)) {
          contact.favorites.push(state.listenSongId);
          saveData();
          const song = state.songs.find(s => s.id === state.listenSongId);
          const title = song ? song.title : '一首歌';
          showListenToast(`${contact.name} 收藏了这首歌`);
          pushSystemTip(contact.id, `${contact.name} 收藏了歌曲「${title}」`);
        } else {
          showListenToast(`${contact.name} 又听了一遍这首歌`);
        }
      } else if (r < pPause + pSong + pLyric) {
        const line = pickCurrentOrRandomLyric();
        if (line && collectLyricLine(contact, line)) {
          saveData();
          showListenToast(`${contact.name} 收藏了歌词「${truncate(line, 18)}」`);
          pushSystemTip(contact.id, `${contact.name} 收藏了歌词「${truncate(line, 24)}」`);
        } else if (line) {
          showListenToast(`${contact.name} 又念了句「${truncate(line, 14)}」`);
        }
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
      const amount = parseFloat($('#money-amount')?.value) || 0;
      const note = ($('#money-note')?.value || '').trim();
      if (amount <= 0) { alert('金额无效'); return; }
      if (state.userBalance < amount) { alert('星币不足'); return; }
      state.userBalance = Math.round((state.userBalance - amount) * 100) / 100;
      const ub = $('#user-balance'); if (ub) ub.textContent = state.userBalance;
      const c = state.contacts.find(x => x.id === state.chatContactId);
      const msg = {
        id: genId('m'), from: 'user', type: state.modalMode, text: '',
        amount, note: note || (state.modalMode === 'redpacket' ? '恭喜发财' : ''),
        time: Date.now(), moneyStatus: 'pending', opened: false,
        _contactId: c?.id || null
      };
      pushMsg(msg); appendMessage(msg); saveData(); closeModal();
      if (c) {
        scheduleContactMoneyResponse(msg, c);
      }
      return;
    }
    if (state.modalMode === 'chat-photos') {
      const caption = ($('#photo-caption')?.value || '').trim();
      const imgs = state._photoDraft || [];
      if (!imgs.length) { alert('请先选择图片'); return; }
      const c = state.contacts.find(x => x.id === state.chatContactId);
      const msg = {
        id: genId('m'), from: 'user', type: 'image',
        imageData: imgs[0], images: imgs.slice(), text: caption,
        time: Date.now(), read: false
      };
      pushMsg(msg); appendMessage(msg);
      state._photoDraft = [];
      closeModal();
      if (c) scheduleReplies(c);
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
        pauseChance: isNaN(pc)?0.18:Math.max(0,Math.min(1,pc/100)),
        favoriteChance: isNaN(fc)?0.12:Math.max(0,Math.min(1,fc/100)),
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
    if (state.modalMode === 'contact-avatar-pool' || state.modalMode === 'user-avatar-pool') {
      if (state.modalMode === 'contact-avatar-pool') {
        const c = state.contacts.find(x => x.id === (state.poolContactId || state.chatContactId));
        if (c) {
          ensureContactShape(c);
          const v = parseFloat($('#pool-chance')?.value);
          if (!isNaN(v)) c.listenConfig.avatarSwapChance = Math.max(0, Math.min(1, v / 100));
        }
      }
      saveData();
      closeModal();
      return;
    }
    if (state.modalMode === 'ask-question-edit') {
      const c = state.contacts.find(x => x.id === state.currentContactId);
      if (!c) { closeModal(); return; }
      ensureContactShape(c);
      const text = ($('#askq-text')?.value || '').trim();
      if (!text) { alert('请填写题目'); return; }
      const type = $('#askq-type')?.value || 'text';
      let q;
      if (type === 'single') {
        const lines = ($('#askq-opts')?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const options = lines.map(line => {
          const parts = line.split('|');
          return { t: (parts[0] || '').trim(), reply: (parts[1] || '嗯').trim() || '嗯' };
        }).filter(o => o.t);
        if (options.length < 2) { alert('单选题至少 2 个选项（格式：选项|回复）'); return; }
        q = { type: 'single', text, options };
      } else {
        q = { type: 'text', text, reply: ($('#askq-reply')?.value || '').trim() || '嗯，我记下了' };
      }
      if (!Array.isArray(c.askQuestions)) c.askQuestions = [];
      const idx = state._askQEditIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < c.askQuestions.length) c.askQuestions[idx] = q;
      else c.askQuestions.push(q);
      saveData();
      closeModal();
      renderCardsPanel();
      alert('查岗题已保存');
      return;
    }
    if (state.modalMode === 'quick-ask') {
      const text = ($('#ask-text')?.value || '').trim();
      if (!text) { alert('请输入问题'); return; }
      const type = $('#ask-type')?.value || 'text';
      const opts = ($('#ask-opts')?.value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (type === 'single' && opts.length < 2) { alert('单选题至少 2 个选项'); return; }
      const msg = {
        id: genId('m'), from: 'user', type: 'ask',
        title: text,
        questions: [{ id: genId('sq'), type, text, options: type === 'single' ? opts : [] }],
        answered: false, answers: {}, time: Date.now()
      };
      pushMsg(msg); appendMessage(msg); closeModal();
      scheduleContactAnswerSurvey(msg);
      return;
    }
    if (state.modalMode === 'survey-editor') {
      syncSurveyDraftFromDom();
      const d = state._surveyDraft;
      if (!d || !(d.title || '').trim()) { alert('请填写标题'); return; }
      d.questions = (d.questions || []).filter(q => (q.text || '').trim());
      if (!d.questions.length) { alert('至少一题'); return; }
      ensureQuestionnaires();
      const idx = state.questionnaires.findIndex(x => x.id === d.id);
      if (idx >= 0) state.questionnaires[idx] = d;
      else state.questionnaires.push(d);
      state._surveyDraft = null;
      saveData();
      closeModal();
      openSurveyPickerModal();
      return;
    }
    if (state.modalMode === 'mailbox-settings') {
      state.mailboxConfig = {
        enabled: !!$('#mb-on')?.checked,
        minIntervalH: parseFloat($('#mb-min-h')?.value) || 6,
        maxIntervalH: parseFloat($('#mb-max-h')?.value) || 36,
        minWords: parseInt($('#mb-min-w')?.value, 10) || 20,
        maxWords: parseInt($('#mb-max-w')?.value, 10) || 120,
        // UI 为百分比
        replyChance: Math.max(0, Math.min(1, (parseFloat($('#mb-reply')?.value) || 55) / 100)),
        replyMinMin: Math.max(0.2, parseFloat($('#mb-reply-min')?.value) || 1),
        replyMaxMin: Math.max(0.2, parseFloat($('#mb-reply-max')?.value) || 30)
      };
      if (state.mailboxConfig.replyMaxMin < state.mailboxConfig.replyMinMin) {
        state.mailboxConfig.replyMaxMin = state.mailboxConfig.replyMinMin;
      }
      if (state.mailboxConfig.maxIntervalH < state.mailboxConfig.minIntervalH) {
        state.mailboxConfig.maxIntervalH = state.mailboxConfig.minIntervalH;
      }
      saveData();
      scheduleLetterSystem();
      closeModal();
      alert('信箱设置已保存');
      return;
    }
    if (state.modalMode === 'moments-settings') {
      (state.contacts || []).forEach(c => {
        ensureContactShape(c);
        const ch = modalBody.querySelector(`input[data-cid="${c.id}"][data-k="momentsChance"]`);
        const cc = modalBody.querySelector(`input[data-cid="${c.id}"][data-k="momentCommentChance"]`);
        const st = modalBody.querySelector(`input[data-cid="${c.id}"][data-k="momentsSticker"]`);
        if (ch) {
          const v = parseFloat(ch.value);
          if (!isNaN(v)) c.listenConfig.momentsChance = Math.max(0, Math.min(1, v / 100));
        }
        if (cc) {
          const v = parseFloat(cc.value);
          if (!isNaN(v)) c.listenConfig.momentCommentChance = Math.max(0, Math.min(1, v / 100));
        }
        if (st) c.listenConfig.momentsSticker = !!st.checked;
      });
      saveData();
      closeModal();
      alert('朋友圈设置已保存');
      return;
    }
    if (state.modalMode === 'new-group') {
      const name = ($('#group-name')?.value || '').trim() || '未命名群聊';
      const ids = [...modalBody.querySelectorAll('input[data-gc]:checked')].map(i => i.value);
      if (ids.length < 1) { alert('至少选择一位联系人'); return; }
      if (!state.groups) state.groups = [];
      const g = { id: genId('g'), name, memberIds: ids, messages: [] };
      ensureGroupShape(g);
      g.createdAt = Date.now(); state.groups.push(g);
      saveData();
      closeModal();
      openGroupPage();
      enterGroup(g.id);
      return;
    }
    if (state.modalMode === 'group-settings') {
      const g = (state.groups || []).find(x => x.id === state.activeGroupId);
      if (!g) { closeModal(); return; }
      ensureGroupShape(g);
      const num = (id, def) => {
        const v = parseFloat($(id)?.value);
        return isNaN(v) ? def : v;
      };
      g.name = ($('#gs-name')?.value || '').trim() || g.name;
      g.chatBgColor = $('#gs-bg-color')?.value || g.chatBgColor || null;
      let min = Math.max(0.5, Math.min(30, num('#gs-min', 1.5)));
      let max = Math.max(min, Math.min(60, num('#gs-max', 4)));
      g.settings = {
        minDelay: min,
        maxDelay: max,
        maxReplies: Math.max(1, Math.min(5, parseInt($('#gs-count')?.value, 10) || 2))
      };
      g.listenConfig.replyChance = Math.max(0, Math.min(1, num('#gs-reply', 85) / 100));
      saveData();
      $('#group-title').textContent = g.name;
      applyGroupChatBg(g);
      renderGroupList();
      closeModal();
      alert('群聊设置已保存');
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
        // 概率发红包/转账
        tryContactSendMoney(c);
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
    const list = state.memorials || [];
    // 兼容 pinInChat 为 true / 1 / 'true'
    const m = list.find(x => x && x.contactId === contactId && (x.pinInChat === true || x.pinInChat === 1 || x.pinInChat === 'true'));
    if (!m) {
      el.classList.add('hidden');
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    const label = memorialLabel(m);
    el.innerHTML = `<span class="pin-ico">📌</span><span class="pin-text">${escapeHtml(m.title || '纪念')} · ${escapeHtml(label)}</span>`;
    el.classList.remove('hidden');
    el.style.display = 'flex';
    // 确保在详情视图里可见
    if (chatDetailView && !chatDetailView.classList.contains('hidden')) {
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    }
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
    // 按各自 momentsChance 加权抽联系人
    const candidates = (state.contacts || []).filter(c => {
      ensureContactShape(c);
      const ch = (c.listenConfig && c.listenConfig.momentsChance != null)
        ? Number(c.listenConfig.momentsChance) : 0.15;
      return ch > 0 && rollChance(ch);
    });
    const poolC = candidates.length ? candidates : (state.contacts || []);
    const c = poolC[Math.floor(Math.random() * poolC.length)];
    if (!c) return null;
    ensureContactShape(c);
    const pool = getContactCardPool(c);
    const text = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '今天天气不错。';
    let stickerData = null, stickerId = null;
    const allowSticker = c.listenConfig?.momentsSticker !== false;
    if (allowSticker && (state.stickers || []).length && Math.random() < 0.35) {
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
    // 用户评论后：按「评论回复概率」决定联系人是否回复
    let c = state.contacts.find(x => x.id === m.contactId);
    if (!c && m.contactId === 'me') {
      // 用户自己的动态：随机抽一个联系人回复
      const poolC = state.contacts || [];
      c = poolC[Math.floor(Math.random() * poolC.length)];
    }
    if (!c) return;
    ensureContactShape(c);
    const chance = c.listenConfig?.momentCommentChance != null
      ? Number(c.listenConfig.momentCommentChance) : 0.65;
    if (!rollChance(chance)) return;
    const allowSticker = c.listenConfig?.momentsSticker !== false;
    setTimeout(() => {
      if (!m.comments) m.comments = [];
      const pool = getContactCardPool(c);
      if (allowSticker && (state.stickers || []).length && Math.random() < 0.3) {
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
    // 仅首次空列表时种子，删除后不再自动补回
    if (!state.moments.length && !state._momentsSeeded) {
      for (let i = 0; i < 2; i++) {
        const m = genRandomMoment();
        if (m) state.moments.unshift(m);
      }
      state._momentsSeeded = true;
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
              <button class="moment-del" data-act="del" type="button">删除</button>
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
      // 删除由全局委托处理，避免重复绑定
    });
  }

  function openMomentsSettings() {
    try {
      if (!modalOverlay || !modalBody || !modalTitle) {
        alert('弹层未就绪，请刷新页面');
        return;
      }
      state.modalMode = 'moments-settings';
      modalTitle.textContent = '朋友圈设置';
      const rows = (state.contacts || []).map(c => {
        ensureContactShape(c);
        const lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
        return `<div class="survey-editor-q">
          <strong>${escapeHtml(c.name)}</strong>
          <div class="form-row"><label>发动态概率 %</label>
            <input type="number" data-cid="${c.id}" data-k="momentsChance" min="0" max="100" step="1" value="${Math.round(((lc.momentsChance != null ? lc.momentsChance : 0.15)||0)*100)}"/>
          </div>
          <div class="form-row"><label>回复你评论的概率 %</label>
            <input type="number" data-cid="${c.id}" data-k="momentCommentChance" min="0" max="100" step="1" value="${Math.round(((lc.momentCommentChance != null ? lc.momentCommentChance : 0.65)||0)*100)}"/>
          </div>
          <label style="font-size:13px;display:flex;align-items:center;gap:8px;margin-top:6px">
            <input type="checkbox" data-cid="${c.id}" data-k="momentsSticker" ${lc.momentsSticker !== false ? 'checked' : ''}/>
            发动态 / 评论时可带表情包
          </label>
        </div>`;
      }).join('') || '<p style="color:var(--muted)">暂无联系人</p>';
      modalBody.innerHTML = `<p style="font-size:12px;color:var(--muted);margin-bottom:8px">为每位联系人单独设置。点「确定」保存。</p>${rows}`;
      modalOverlay.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      alert('打开设置失败：' + (err && err.message));
    }
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
    if (!Array.isArray(state.stickers)) state.stickers = [];
    state.modalMode = 'sticker-manage';
    modalTitle.textContent = '表情包管理';
    const list = state.stickers;
    modalBody.innerHTML = [
      '<div class="toolbar-row" style="gap:8px;margin-bottom:10px">',
      '<button type="button" class="btn-primary" id="sm-add" style="flex:1">＋ 添加表情</button>',
      '</div>',
      '<div class="sticker-panel" style="max-height:280px;display:flex;flex-wrap:wrap;gap:8px">',
      list.map(s => (
        '<div class="sticker-item sm-item" data-id="' + s.id + '" style="position:relative;width:64px;height:64px">' +
        '<img src="' + s.data + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>' +
        '<button type="button" class="sm-del" data-id="' + s.id + '" style="position:absolute;top:-4px;right:-4px;width:18px;height:18px;border:none;border-radius:50%;background:#c45c5c;color:#fff;font-size:10px;cursor:pointer">✕</button></div>'
      )).join('') || '<div style="color:var(--muted);font-size:13px;padding:12px">暂无表情，点上方添加</div>',
      '</div>',
      '<div style="font-size:12px;color:var(--muted);margin-top:8px">支持多选图片导入；聊天与群聊中可发送</div>'
    ].join('');
    modalOverlay.classList.remove('hidden');
    const addBtn = document.getElementById('sm-add');
    if (addBtn) {
      addBtn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const inp = document.getElementById('file-stickers');
        if (!inp) { alert('文件选择器缺失，请刷新'); return; }
        inp.value = '';
        inp.click();
      };
    }
    modalBody.querySelectorAll('.sm-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.stickers = (state.stickers || []).filter(function (s) { return s.id !== btn.dataset.id; });
        saveData();
        openStickerManager();
      });
    });
  }

  function exportBackup() {
    try {
      const payload = buildPersistPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zijian-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      alert('备份已开始下载');
    } catch (err) {
      alert('导出失败：' + (err && err.message));
    }
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

  /**
   * 压缩图片：严格保持宽高比，不拉伸。
   * 聊天背景建议 maxSize≥1080、q≥0.82，避免糊和比例观感差。
   */
  function compressImage(file, maxSize = 720, q = 0.72) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => {
        const img = new Image();
        img.onload = () => {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('invalid image')); return; }
          const maxEdge = Math.max(w, h);
          if (maxEdge > maxSize) {
            const scale = maxSize / maxEdge;
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
          }
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          // 禁止浏览器默认平滑导致的奇怪缩放观感时仍保持比例绘制
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          // PNG 若本身透明且较小可保留；背景统一 jpeg 更省空间
          resolve(cv.toDataURL('image/jpeg', q));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /**
   * 聊天背景：尽量保留原图比例与清晰度。
   * 仅当边长过大或文件过大时等比缩小，绝不拉伸变形。
   */
  function compressChatBg(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = reject;
      r.onload = () => {
        const dataUrl = r.result;
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) { resolve(dataUrl); return; }
          // 仅限制最长边，保持宽高比
          const maxEdge = 1600;
          const needScale = Math.max(w, h) > maxEdge || (file.size && file.size > 1.8 * 1024 * 1024);
          if (!needScale && typeof dataUrl === 'string' && dataUrl.length < 2.5e6) {
            resolve(dataUrl); // 原图直存
            return;
          }
          const scale = maxEdge / Math.max(w, h);
          w = Math.max(1, Math.round(w * Math.min(1, scale)));
          h = Math.max(1, Math.round(h * Math.min(1, scale)));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          // 保留 PNG 透明；否则 jpeg
          const isPng = (file.type || '').includes('png') || (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png'));
          resolve(cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.9));
        };
        img.src = dataUrl;
      };
      r.readAsDataURL(file);
    });
  }

  /** 读取文本文件：自动尝试 UTF-8 / GBK，避免中文乱码 */
  function readTextFileSmart(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('read fail'));
      r.onload = () => {
        const buf = r.result;
        if (!(buf instanceof ArrayBuffer)) {
          resolve(String(buf || ''));
          return;
        }
        const bytes = new Uint8Array(buf);
        // 去掉 UTF-8 BOM
        let start = 0;
        if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) start = 3;

        const tryDecode = (label) => {
          try {
            return new TextDecoder(label, { fatal: false }).decode(bytes.subarray(start));
          } catch (_) {
            return null;
          }
        };

        const utf8 = tryDecode('utf-8') || '';
        // 粗略检测：大量替换符 或 典型 GBK 被当成 UTF-8 的乱码特征
        const badCount = (utf8.match(/\uFFFD/g) || []).length;
        const looksMojibake = /Ã.|Â.|ä.|å.|æ.|ç.|è.|é.|ð.|ñ.|ò./.test(utf8) && /[\u0080-\u00ff]{2,}/.test(utf8);
        const mostlyGarbled = utf8.length > 0 && badCount / Math.max(1, utf8.length) > 0.02;

        if (!mostlyGarbled && !looksMojibake && utf8.trim()) {
          resolve(utf8);
          return;
        }
        const gbk = tryDecode('gbk') || tryDecode('gb18030') || tryDecode('gb2312');
        if (gbk && gbk.trim()) {
          resolve(gbk);
          return;
        }
        resolve(utf8 || '');
      };
      r.readAsArrayBuffer(file);
    });
  }

  /** 把文件内容解析成字卡行：支持纯文本一行一条、JSON 数组 */
  function parseCardsFromText(raw, fileName) {
    const name = (fileName || '').toLowerCase();
    let text = String(raw || '').replace(/^\uFEFF/, '');
    if (name.endsWith('.json') || (text.trim().startsWith('[') || text.trim().startsWith('{'))) {
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          return data.map(x => {
            if (typeof x === 'string') return x.trim();
            if (x && typeof x.text === 'string') return x.text.trim();
            if (x && typeof x.content === 'string') return x.content.trim();
            return '';
          }).filter(Boolean);
        }
        if (data && Array.isArray(data.cards)) {
          return data.cards.map(x => (typeof x === 'string' ? x : (x.text || ''))).map(s => String(s).trim()).filter(Boolean);
        }
      } catch (_) { /* fall through to line mode */ }
    }
    // 一行一条；也兼容用 ---- 或空行分段的短段落
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return lines;
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



  // ===== 全局搜索 =====
  function runGlobalSearch(q) {
    q = (q || '').trim().toLowerCase();
    const box = $('#search-results');
    if (!box) return;
    if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const hits = [];
    (state.contacts || []).forEach(c => {
      if ((c.name || '').toLowerCase().includes(q)) {
        hits.push({ type: '联系人', title: c.name, sub: c.currentStatus || '', act: () => { switchPage('contacts'); state.currentContactId = c.id; renderContactsList(); renderCardsPanel(); } });
      }
      const cards = getContactCardPool(c) || [];
      cards.forEach((text, i) => {
        if (String(text).toLowerCase().includes(q)) {
          hits.push({ type: '字卡', title: truncate(text, 40), sub: c.name, act: () => { switchPage('contacts'); state.currentContactId = c.id; renderContactsList(); renderCardsPanel(); } });
        }
      });
      const msgs = state.chats[c.id] || [];
      msgs.forEach(m => {
        if (m.text && String(m.text).toLowerCase().includes(q)) {
          hits.push({ type: '聊天', title: truncate(m.text, 36), sub: c.name + ' · ' + formatTime(m.time), act: () => { enterChat(c.id); setTimeout(() => jumpToMessage(m.id), 200); } });
        }
      });
    });
    (state.groups || []).forEach(g => {
      if ((g.name || '').toLowerCase().includes(q)) {
        hits.push({ type: '群聊', title: g.name, sub: '', act: () => openGroupFromChatList(g.id) });
      }
      (g.messages || []).forEach(m => {
        if (m.text && String(m.text).toLowerCase().includes(q)) {
          hits.push({ type: '群消息', title: truncate(m.text, 36), sub: g.name, act: () => openGroupFromChatList(g.id) });
        }
      });
    });
    box.innerHTML = hits.slice(0, 40).map((h, i) =>
      `<div class="search-hit" data-i="${i}"><span class="sh-type">${h.type}</span>${escapeHtml(h.title)}<div style="font-size:11px;color:var(--muted)">${escapeHtml(h.sub || '')}</div></div>`
    ).join('') || '<div class="search-hit">无结果</div>';
    box.classList.remove('hidden');
    box._hits = hits;
    box.querySelectorAll('.search-hit[data-i]').forEach(el => {
      el.addEventListener('click', () => {
        const h = hits[+el.dataset.i];
        if (h && h.act) h.act();
        box.classList.add('hidden');
        const inp = $('#global-search'); if (inp) inp.value = '';
      });
    });
  }

  function jumpToMessage(msgId) {
    const row = messageList?.querySelector(`[data-id="${msgId}"]`);
    if (!row) { alert('未找到该消息（可能已被裁剪）'); return; }
    row.classList.add('msg-hit');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => row.classList.remove('msg-hit'), 1500);
  }

  function openChatSearch() {
    const bar = $('#chat-search-bar');
    if (!bar) return;
    bar.classList.remove('hidden');
    $('#chat-search-input')?.focus();
  }

  function runChatSearch() {
    const q = ($('#chat-search-input')?.value || '').trim().toLowerCase();
    if (!q || !state.chatContactId) return;
    const msgs = state.chats[state.chatContactId] || [];
    const found = [...msgs].reverse().find(m => m.text && String(m.text).toLowerCase().includes(q));
    if (!found) { alert('本聊天中没有匹配消息'); return; }
    jumpToMessage(found.id);
  }

  // ===== 信箱 =====
  function scheduleLetterSystem() {
    if (state.letterTimer) clearTimeout(state.letterTimer);
    const cfg = Object.assign({}, DEFAULT_MAILBOX, state.mailboxConfig || {});
    if (!cfg.enabled) return;
    const minH = Math.max(0.05, Number(cfg.minIntervalH) || 6);
    const maxH = Math.max(minH, Number(cfg.maxIntervalH) || 36);
    // 开发体验：用分钟缩放 — 实际按小时；此处用小时
    const delayH = minH + Math.random() * (maxH - minH);
    const delayMs = delayH * 3600 * 1000;
    // 若间隔过长，也允许最短 30s 检查一次（首次）
    const wait = Math.min(delayMs, Math.max(15000, delayMs));
    state.letterTimer = setTimeout(() => {
      tryDeliverLetter();
      scheduleLetterSystem();
    }, Math.min(wait, 120000)); // 最长 2 分钟轮询一次是否该写信（按 lastLetterAt 判断）
  }

  function tryDeliverLetter() {
    const cfg = Object.assign({}, DEFAULT_MAILBOX, state.mailboxConfig || {});
    if (!cfg.enabled) return;
    const contacts = state.contacts || [];
    if (!contacts.length) return;
    const minH = Math.max(0.05, Number(cfg.minIntervalH) || 6);
    const maxH = Math.max(minH, Number(cfg.maxIntervalH) || 36);
    const now = Date.now();
    const candidates = contacts.filter(c => {
      const last = (state.lastLetterAt || {})[c.id] || 0;
      const need = (minH + Math.random() * (maxH - minH)) * 3600 * 1000;
      // 演示：将“小时”映射，若用户设很小也能较快收到；正常按小时
      return now - last >= Math.min(need, need);
    });
    if (!candidates.length) return;
    // 随机一个联系人
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    const pool = getContactCardPool(c);
    if (!pool.length) return;
    const minW = Math.max(5, Number(cfg.minWords) || 20);
    const maxW = Math.max(minW, Number(cfg.maxWords) || 120);
    // 拼几条字卡凑字数
    let text = '';
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    for (const line of shuffled) {
      text = text ? (text + '\n' + line) : line;
      if (text.length >= minW) break;
    }
    if (text.length > maxW) text = text.slice(0, maxW) + '…';
    if (!text.trim()) return;
    if (!state.letters) state.letters = [];
    state.letters.unshift({
      id: genId('lt'),
      contactId: c.id,
      from: 'contact',
      name: c.name,
      text,
      time: now,
      favorite: false,
      read: false,
      replies: []
    });
    if (state.letters.length > 80) state.letters.length = 80;
    if (!state.lastLetterAt) state.lastLetterAt = {};
    state.lastLetterAt[c.id] = now;
    state.mailboxUnread = (state.mailboxUnread || 0) + 1;
    syncMailboxUnread();
    saveData();
    updateTabDots();
    showInAppPopup({
      title: c.name || '来信',
      body: (text || '').slice(0, 40) || '给你写了一封信',
      contactId: c.id,
      kind: 'mailbox'
    });
  }

  function syncMailboxUnread() {
    const n = (state.letters || []).filter(L => L && L.read === false).length;
    state.mailboxUnread = n;
    return n;
  }

  function renderMailbox() {
    const list = $('#mailbox-list');
    const empty = $('#mailbox-empty');
    if (!list) return;
    syncMailboxUnread();
    updateTabDots();
    const letters = state.letters || [];
    if (!letters.length) {
      list.innerHTML = '';
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    list.innerHTML = letters.map(L => {
      const unread = L.read === false;
      const contactName = L.name || (state.contacts.find(c => c.id === L.contactId) || {}).name || '对方';
      const repliesHtml = (L.replies || []).map(r => {
        const isContact = r.from === 'contact';
        const who = isContact ? contactName : '我';
        const cls = isContact ? 'letter-reply contact' : 'letter-reply me';
        return `<div class="${cls}"><div class="letter-reply-who">${escapeHtml(who)}</div><div class="letter-reply-text">${escapeHtml(r.text || '')}</div><div class="letter-time">${formatTime(r.time)}</div></div>`;
      }).join('');
      return `<div class="letter-card ${unread ? 'unread' : ''}" data-lid="${L.id}">
        <div class="letter-from">${escapeHtml(contactName)}${L.favorite ? ' <span class="letter-fav">★</span>' : ''}${unread ? ' <span class="letter-unread-dot">未读</span>' : ''}</div>
        <div class="letter-time">${formatTime(L.time)}</div>
        <div class="letter-body">${escapeHtml(L.text)}</div>
        ${repliesHtml}
        <div class="letter-actions">
          <button type="button" class="btn-xs" data-lact="read">${unread ? '标为已读' : '已读'}</button>
          <button type="button" class="btn-xs" data-lact="fav">${L.favorite ? '取消收藏' : '收藏'}</button>
          <button type="button" class="btn-xs" data-lact="reply">回信</button>
          <button type="button" class="btn-xs" data-lact="del">删除</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.letter-card').forEach(card => {
      const id = card.dataset.lid;
      const L = (state.letters || []).find(x => x.id === id);
      if (!L) return;
      // 点开卡片即已读
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-lact]')) return;
        if (L.read === false) {
          L.read = true;
          syncMailboxUnread();
          saveData();
          updateTabDots();
          card.classList.remove('unread');
          const dot = card.querySelector('.letter-unread-dot');
          if (dot) dot.remove();
        }
      });
      card.querySelectorAll('[data-lact]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = btn.dataset.lact;
          if (act === 'read') {
            L.read = true;
            syncMailboxUnread();
          } else if (act === 'fav') {
            L.favorite = !L.favorite;
          } else if (act === 'del') {
            if (!confirm('删除这封信？')) return;
            state.letters = state.letters.filter(x => x.id !== id);
            syncMailboxUnread();
          } else if (act === 'reply') {
            const text = prompt('回信内容：');
            if (!text || !text.trim()) return;
            if (!L.replies) L.replies = [];
            L.replies.push({ text: text.trim(), time: Date.now(), from: 'user' });
            L.read = true;
            syncMailboxUnread();
            saveData();
            renderMailbox();
            // 对方回信：延迟更长，且标注 from:contact + 对方名字
            const cfg = Object.assign({}, DEFAULT_MAILBOX, state.mailboxConfig || {});
            // 对齐 mochi：replyProb% + 回信延迟分钟区间
            if (rollChance(cfg.replyChance != null ? cfg.replyChance : 0.55)) {
              const c = state.contacts.find(x => x.id === L.contactId);
              const pool = c ? getContactCardPool(c) : [];
              if (pool.length) {
                const minM = Math.max(0.2, Number(cfg.replyMinMin) || 1);
                const maxM = Math.max(minM, Number(cfg.replyMaxMin) || 30);
                const delay = (minM + Math.random() * (maxM - minM)) * 60 * 1000;
                setTimeout(() => {
                  if (!state.letters.find(x => x.id === L.id)) return;
                  L.replies.push({
                    text: pool[Math.floor(Math.random() * pool.length)],
                    time: Date.now(),
                    from: 'contact'
                  });
                  L.read = false;
                  syncMailboxUnread();
                  saveData();
                  updateTabDots();
                  if ($('#mailbox-subpage') && !$('#mailbox-subpage').classList.contains('hidden')) renderMailbox();
                  showInAppPopup({
                    title: (c && c.name) || L.name || '来信',
                    body: '回了你的信',
                    kind: 'mailbox',
                    contactId: L.contactId
                  });
                }, delay);
              }
            }
            return;
          }
          saveData();
          updateTabDots();
          renderMailbox();
        });
      });
    });
  }

  function openMailboxSettings() {
    const cfg = Object.assign({}, DEFAULT_MAILBOX, state.mailboxConfig || {});
    state.modalMode = 'mailbox-settings';
    modalTitle.textContent = '信箱设置';
    modalBody.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input type="checkbox" id="mb-on" ${cfg.enabled ? 'checked' : ''}/> 启用随机来信
      </label>
      <div class="form-row"><label>来信间隔最少（小时）</label><input type="number" id="mb-min-h" step="0.5" min="0.1" value="${cfg.minIntervalH}"/></div>
      <div class="form-row"><label>来信间隔最多（小时）</label><input type="number" id="mb-max-h" step="0.5" min="0.1" value="${cfg.maxIntervalH}"/></div>
      <div class="form-row"><label>信件最少字数</label><input type="number" id="mb-min-w" min="5" value="${cfg.minWords}"/></div>
      <div class="form-row"><label>信件最多字数</label><input type="number" id="mb-max-w" min="10" value="${cfg.maxWords}"/></div>
      <div class="form-row"><label>对方回信概率 %</label><input type="number" id="mb-reply" step="1" min="0" max="100" value="${Math.round((cfg.replyChance||0)*100)}"/></div>
      <div class="form-row"><label>对方回信最少延迟（分钟）</label><input type="number" id="mb-reply-min" step="0.5" min="0.2" value="${cfg.replyMinMin != null ? cfg.replyMinMin : 1}"/></div>
      <div class="form-row"><label>对方回信最多延迟（分钟）</label><input type="number" id="mb-reply-max" step="0.5" min="0.2" value="${cfg.replyMaxMin != null ? cfg.replyMaxMin : 30}"/></div>
      <p style="font-size:11px;color:var(--muted)">对齐 mochi：回信概率为百分比；对方回信在设定分钟区间后送达。信件内容来自字卡库拼接。</p>`;
    modalOverlay.classList.remove('hidden');
  }

  function openMailboxPage() {
    document.querySelector('.discover-list')?.classList.add('hidden');
    $('#music-subpage')?.classList.add('hidden');
    $('#memorial-subpage')?.classList.add('hidden');
    $('#mailbox-subpage')?.classList.remove('hidden');
    pageTitle.textContent = '信箱';
    renderMailbox();
  }

  function ensureMeMenu() {
    const host = document.querySelector('#page-me .me-content');
    if (!host) return;
    let menu = document.getElementById('me-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'me-menu';
      menu.id = 'me-menu';
      menu.innerHTML = [
        '<button class="me-menu-item" id="btn-manage-stickers" type="button"><span class="mm-icon">😊</span><span class="mm-text">表情包管理</span><span class="mm-arrow">›</span></button>',
        '<button class="me-menu-item" id="btn-moments-cover" type="button"><span class="mm-icon">🖼️</span><span class="mm-text">朋友圈封面</span><span class="mm-arrow">›</span></button>',
        '<button class="me-menu-item" id="btn-export-data" type="button"><span class="mm-icon">📦</span><span class="mm-text">导出全部数据</span><span class="mm-arrow">›</span></button>',
        '<button class="me-menu-item" id="btn-import-data" type="button"><span class="mm-icon">📥</span><span class="mm-text">导入备份数据</span><span class="mm-arrow">›</span></button>',
        '<button class="me-menu-item" id="btn-toggle-notify" type="button"><span class="mm-icon">🔔</span><span class="mm-text">通知：未开启</span><span class="mm-arrow">›</span></button>'
      ].join('');
      const theme = host.querySelector('.theme-section');
      if (theme) host.insertBefore(menu, theme);
      else host.appendChild(menu);
    } else if (!document.getElementById('btn-toggle-notify')) {
      const b = document.createElement('button');
      b.className = 'me-menu-item';
      b.id = 'btn-toggle-notify';
      b.type = 'button';
      b.innerHTML = '<span class="mm-icon">🔔</span><span class="mm-text">通知：未开启</span><span class="mm-arrow">›</span>';
      menu.appendChild(b);
    }
    const stickers = document.getElementById('btn-manage-stickers');
    const cover = document.getElementById('btn-moments-cover');
    const exp = document.getElementById('btn-export-data');
    const imp = document.getElementById('btn-import-data');
    const ntf = document.getElementById('btn-toggle-notify');
    if (stickers && !stickers._bound) {
      stickers._bound = true;
      stickers.addEventListener('click', function (e) { e.preventDefault(); openStickerManager(); });
    }
    if (cover && !cover._bound) {
      cover._bound = true;
      cover.addEventListener('click', function () { document.getElementById('file-moments-cover')?.click(); });
    }
    if (exp && !exp._bound) {
      exp._bound = true;
      exp.addEventListener('click', function () { exportBackup(); });
    }
    if (imp && !imp._bound) {
      imp._bound = true;
      imp.addEventListener('click', function () { document.getElementById('file-backup')?.click(); });
    }
    if (ntf && !ntf._bound) {
      ntf._bound = true;
      ntf.addEventListener('click', function () {
        if (state.notifyEnabled) {
          state.notifyEnabled = false;
          saveData();
          updateNotifyUI();
          alert('已关闭系统通知');
        } else {
          requestNotifyPermission();
        }
      });
    }
    updateNotifyUI();
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
    state.questionnaires = data.questionnaires || [];
    state.groups = data.groups || [];
    state.unread = data.unread || {};
    state.groupUnread = data.groupUnread || {};
    state.pinned = Array.isArray(data.pinned) ? data.pinned : [];
    state.letters = Array.isArray(data.letters) ? data.letters : [];
    state.mailboxConfig = Object.assign({}, DEFAULT_MAILBOX, data.mailboxConfig || {});
    state.mailboxUnread = data.mailboxUnread || 0;
    state.momentNotifs = data.momentNotifs || 0;
    state.lastLetterAt = data.lastLetterAt || {};
    state.userBalance = data.userBalance; state.theme = data.theme;
    state.playMode = data.playMode || 'order';
    state.userAvatar = data.userAvatar || null;
    state.userAvatarPool = Array.isArray(data.userAvatarPool) ? data.userAvatarPool : [];
    state.userName = data.userName || '昕';
    state.lastProactiveAt = data.lastProactiveAt || {};
    state.momentsCover = data.momentsCover || null;
    state.notifyEnabled = !!data.notifyEnabled;
    applyTheme(state.theme);
    startStatusRotation();
    scheduleProactiveMessages();
    enableFloatDrag();
    updateMeAvatarUI();

    $$('.tab-item').forEach(t => t.addEventListener('click', () => switchPage(t.dataset.page)));
    function handleAppBack(e) {
      if (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      }
      // 设置页优先关闭
      const settings = $('#chat-settings-page');
      if (settings && !settings.classList.contains('hidden')) {
        settings.classList.add('hidden');
        return;
      }
      // 听歌全屏
      const listen = $('#listen-page');
      if (listen && !listen.classList.contains('hidden')) {
        try { closeListenPage(); } catch (_) {}
        return;
      }
      // 朋友圈全屏
      const moments = $('#moments-page');
      if (moments && !moments.classList.contains('hidden')) {
        moments.classList.add('hidden');
        return;
      }
      // 群聊返回
      if (state.activeGroupId) {
        const view = $('#group-chat-view');
        if (view && !view.classList.contains('hidden') && view.style.display !== 'none') {
          state.activeGroupId = null;
          view.classList.add('hidden');
          view.style.display = 'none';
          $('#group-list')?.classList.remove('hidden');
          $('#group-title').textContent = '群聊';
          $('#group-settings')?.classList.add('hidden');
          $('#group-new')?.classList.remove('hidden');
          if (btnBack) btnBack.classList.add('hidden');
          pageTitle.textContent = '联系人';
          document.getElementById('app')?.classList.remove('chat-detail-open');
          try { renderGroupList(); } catch (_) {}
          renderChatList();
          return;
        }
        state.activeGroupId = null;
      }
      // 聊天详情 → 列表
      leaveChat();
    }
    // 暴露到全局，便于 inline / 调试
    window.__zijianBack = handleAppBack;

    if (btnBack) {
      btnBack.onclick = handleAppBack;
      ['click', 'pointerup'].forEach(ev => {
        btnBack.addEventListener(ev, handleAppBack, true);
      });
    }
    // 聊天设置页自己的返回
    $('#chat-settings-back')?.addEventListener('click', (e) => {
      e.preventDefault();
      $('#chat-settings-page')?.classList.add('hidden');
    });
    // 标题单击返回（聊天详情时）
    pageTitle.addEventListener('click', () => {
      if (state.chatContactId) handleAppBack();
    });
    // 一起听邀请接受/拒绝
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-li-act]');
      if (!btn) return;
      const bubble = btn.closest('[data-li-id]');
      if (!bubble) return;
      const id = bubble.getAttribute('data-li-id');
      const cid = state.chatContactId;
      if (!cid) return;
      const msg = (state.chats[cid] || []).find(x => x.id === id);
      if (!msg) return;
      if (btn.getAttribute('data-li-act') === 'accept') acceptListenInvite(msg, cid);
      else rejectListenInvite(msg, cid);
    });
    $('#listen-chat-toggle')?.addEventListener('click', () => toggleListenChatPanel());
    $('#listen-chat-close')?.addEventListener('click', () => toggleListenChatPanel(false));
    $('#listen-chat-send')?.addEventListener('click', sendListenChat);
    $('#listen-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendListenChat(); }
    });


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
        if (state.uploadTarget === 'group-avatar') {
          const g = (state.groups || []).find(x => x.id === state.groupUploadId);
          if (g) {
            g.avatarImg = dataUrl;
            saveData();
            const prev = $('#gs-av-preview');
            if (prev) prev.style.backgroundImage = `url(${dataUrl})`;
            renderGroupList();
          }
          state.uploadTarget = null;
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
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        if (state.uploadTarget === 'group-bg') {
          const g = (state.groups || []).find(x => x.id === state.groupUploadId);
          if (g) {
            g.chatBgImg = await compressChatBg(f);
            g.chatBgColor = null;
            saveData();
            applyGroupChatBg(g);
            alert('群聊背景已更新');
          }
          state.uploadTarget = null;
          return;
        }
        const c = state.contacts.find(x => x.id === state.currentContactId); if (!c) return;
        c.chatBgImg = await compressChatBg(f);
        c.chatBgColor = null;
        if (!saveData()) alert('背景已应用，但存储空间不足，建议删除部分歌曲后再保存');
        closeModal();
        if (state.chatContactId === c.id) applyContactChatBg(c.id);
      } catch (_) { alert('图片失败'); }
    });

    btnSend.addEventListener('click', sendMessage);
    msgInput.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMessage(); }});
    btnAttach.addEventListener('click', () => {
      if (attachPanel.classList.contains('hidden')) { attachPanel.classList.remove('hidden'); btnAttach.classList.add('active'); }
      else hideAttachPanel();
    });
    attachPanel.querySelectorAll('.attach-btn').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.action;
      if (act === 'photo') {
        openChatPhotoComposer();
        return;
      }
      if (act === 'ask') {
        hideAttachPanel();
        openQuickAskModal();
        return;
      }
      if (act === 'survey') {
        hideAttachPanel();
        openSurveyPickerModal();
        return;
      }
      openMoneyModal(act);
    }));
    $('#file-chat-photo')?.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      // 多图选择器：若在照片发送弹层中，只预览；否则直接发送
      if (state.modalMode === 'chat-photos') {
        state._photoDraft = state._photoDraft || [];
        for (const f of files.slice(0, 9 - state._photoDraft.length)) {
          try {
            const url = await compressImage(f, 720, 0.72);
            if (url) state._photoDraft.push(url);
          } catch (_) {}
        }
        const row = $('#photo-preview-row');
        const cnt = $('#photo-count');
        if (row) row.innerHTML = state._photoDraft.map(src => `<img src="${src}" style="width:56px;height:56px;object-fit:cover;border-radius:8px"/>`).join('');
        if (cnt) cnt.textContent = `已选 ${state._photoDraft.length} 张`;
        return;
      }
      sendChatPhotos(files, '');
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
    // 事件委托：朋友圈 / 群聊 / 表情
    document.addEventListener('click', e => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('#moments-settings')) {
        e.preventDefault();
        openMomentsSettings();
        return;
      }
      if (t.closest('#moments-cover-btn') || (t.id === 'moments-cover')) {
        e.preventDefault();
        $('#file-moments-cover')?.click();
        return;
      }
      if (t.closest('#btn-manage-stickers')) {
        e.preventDefault();
        openStickerManager();
        return;
      }
      if (t.closest('#sm-add')) {
        e.preventDefault();
        e.stopPropagation();
        const inp = document.getElementById('file-stickers');
        if (inp) { inp.value = ''; inp.click(); }
        return;
      }
      // 朋友圈 ··· 菜单
      const more = t.closest('[data-act="menu"], .moment-more');
      if (more && more.closest('.moment-card')) {
        e.preventDefault();
        e.stopPropagation();
        const card = more.closest('.moment-card');
        const bar = card.querySelector('[data-bar]');
        document.querySelectorAll('.moment-action-bar').forEach(b => {
          if (b !== bar) b.classList.add('hidden');
        });
        bar?.classList.toggle('hidden');
        return;
      }
      const likeBtn = t.closest('[data-act="like"]');
      if (likeBtn && likeBtn.closest('.moment-card')) {
        e.preventDefault();
        e.stopPropagation();
        const card = likeBtn.closest('.moment-card');
        const mid = card?.dataset?.id;
        const m = (state.moments || []).find(x => x.id === mid);
        if (!m) return;
        if (!m.likes) m.likes = [];
        if (m.likes.includes('me')) m.likes = m.likes.filter(x => x !== 'me');
        else m.likes.push('me');
        saveData();
        renderMoments();
        return;
      }
      const cmtBtn = t.closest('[data-act="comment"]');
      if (cmtBtn && cmtBtn.closest('.moment-card')) {
        e.preventDefault();
        e.stopPropagation();
        const card = cmtBtn.closest('.moment-card');
        const mid = card?.dataset?.id;
        card.querySelector('[data-bar]')?.classList.add('hidden');
        showMomentCommentBar(mid);
        return;
      }
      const del = t.closest('.moment-del, [data-act="del"]');
      if (del && del.closest('.moment-card')) {
        e.preventDefault();
        e.stopPropagation();
        const card = del.closest('.moment-card');
        const mid = card?.dataset?.id;
        if (!mid) return;
        if (!confirm('删除这条朋友圈？')) return;
        state.moments = (state.moments || []).filter(x => x.id !== mid);
        state._momentsSeeded = true;
        saveData();
        renderMoments();
        return;
      }
      if (t.closest('#btn-goto-group')) {
        e.preventDefault();
        openGroupPage();
        return;
      }
      // 点击空白关闭朋友圈菜单
      if (!t.closest('.moment-action-bar') && !t.closest('.moment-more')) {
        document.querySelectorAll('.moment-action-bar').forEach(b => b.classList.add('hidden'));
      }
    });
    $('#group-back')?.addEventListener('click', () => {
      const view = $('#group-chat-view');
      if (state.activeGroupId && view && !view.classList.contains('hidden')) {
        state.activeGroupId = null;
        view.classList.add('hidden');
        view.style.display = 'none';
        $('#group-list')?.classList.remove('hidden');
        $('#group-title').textContent = '群聊';
        $('#group-settings')?.classList.add('hidden');
        $('#group-new')?.classList.remove('hidden');
        renderGroupList();
        return;
      }
      closeGroupPage();
    });
    $('#group-new')?.addEventListener('click', openNewGroupModal);
    $('#group-settings')?.addEventListener('click', openGroupSettings);
    $('#group-send')?.addEventListener('click', () => sendGroupMessage());
    $('#group-sticker-btn')?.addEventListener('click', toggleGroupStickerPanel);
    $('#group-quote-close')?.addEventListener('click', () => {
      state.groupQuoting = null;
      $('#group-quote-bar')?.classList.add('hidden');
    });
    $('#group-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendGroupMessage(); }
    });
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
    $('#btn-goto-mailbox')?.addEventListener('click', openMailboxPage);
    $('#btn-mailbox-back')?.addEventListener('click', () => {
      $('#mailbox-subpage')?.classList.add('hidden');
      document.querySelector('.discover-list')?.classList.remove('hidden');
      pageTitle.textContent = '互动';
    });
    $('#btn-mailbox-settings')?.addEventListener('click', openMailboxSettings);
    $('#btn-goto-moment-notifs')?.addEventListener('click', () => {
      state.momentNotifs = 0;
      saveData();
      updateTabDots();
      openMomentsPage();
    });
    $('#global-search')?.addEventListener('input', e => runGlobalSearch(e.target.value));
    $('#btn-open-search')?.addEventListener('click', () => runGlobalSearch($('#global-search')?.value));
    $('#chat-search-go')?.addEventListener('click', runChatSearch);
    $('#chat-search-close')?.addEventListener('click', () => $('#chat-search-bar')?.classList.add('hidden'));
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
    $('#file-cards-txt')?.addEventListener('change', async e => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      const c = state.contacts.find(x => x.id === state.currentContactId);
      if (!c) { alert('请先选择联系人'); return; }
      const lower = (f.name || '').toLowerCase();
      if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
        alert('暂不支持 Word(.doc/.docx)。请另存为「UTF-8 或 ANSI 的 .txt」，一行一条字卡后再导入。');
        return;
      }
      try {
        const raw = await readTextFileSmart(f);
        const lines = parseCardsFromText(raw, f.name);
        if (!lines.length) {
          alert('没有解析到字卡。请确认：TXT 一行一条，或 JSON 字符串数组。若仍乱码，用记事本另存为 UTF-8 再试。');
          return;
        }
        ensureContactShape(c);
        if (!c.cardGroups[state.activeCardGroup]) c.cardGroups[state.activeCardGroup] = [];
        // 去重追加
        const set = new Set(c.cardGroups[state.activeCardGroup]);
        let added = 0;
        lines.forEach(line => {
          if (!set.has(line)) {
            set.add(line);
            c.cardGroups[state.activeCardGroup].push(line);
            added++;
          }
        });
        c.cards = Object.values(c.cardGroups).flat();
        saveData();
        renderCardsPanel();
        alert(`已导入 ${added} 条字卡（共解析 ${lines.length} 行，重复已跳过）`);
      } catch (err) {
        alert('导入失败：' + (err && err.message ? err.message : '请换 UTF-8 的 txt'));
      }
    });
    $('#btn-manage-stickers')?.addEventListener('click', openStickerManager);
    $('#me-avatar')?.addEventListener('click', () => {
      state.uploadTarget = 'user';
      $('#file-avatar')?.click();
    });
    const stickerInput = document.getElementById('file-stickers');
    if (stickerInput) {
      stickerInput.addEventListener('change', async e => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        if (!Array.isArray(state.stickers)) state.stickers = [];
        let ok = 0;
        for (const f of files.slice(0, 40)) {
          try {
            // 表情保留透明通道优先用原图 dataURL，过大再压缩
            let data;
            if (f.size < 120 * 1024) {
              data = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(f);
              });
            } else {
              data = await compressImage(f, 240, 0.8);
            }
            if (data && typeof data === 'string' && data.startsWith('data:')) {
              state.stickers.push({ id: genId('st'), data });
              ok++;
            }
          } catch (err) {
            console.warn('sticker fail', err);
            try {
              const data = await compressImage(f, 160, 0.65);
              if (data) { state.stickers.push({ id: genId('st'), data }); ok++; }
            } catch (_) {}
          }
        }
        saveData();
        if (state.modalMode === 'sticker-manage') openStickerManager();
        alert(ok ? `已导入 ${ok} 个表情，当前共 ${state.stickers.length} 个` : '导入失败，请使用 JPG/PNG 图片重试');
      });
    }
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
    wireAvatarPoolFiles();
    wireAskSurvey();
    ensureMeMenu();
    scheduleLetterSystem();
    updateTabDots();
    updateNotifyUI();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        document.title = '字笺 · ZiJian';
      }
    });
  }

  // ========== 头像池随机更换（灵感：Mochi 字卡 · 小红书@言序）==========
  function getContactAvatarPool(c) {
    ensureContactShape(c);
    if (!Array.isArray(c.avatarPool)) c.avatarPool = [];
    return c.avatarPool;
  }
  function getUserAvatarPool() {
    if (!Array.isArray(state.userAvatarPool)) state.userAvatarPool = [];
    return state.userAvatarPool;
  }

  function tryRandomAvatarSwap(contact) {
    if (!contact) return;
    ensureContactShape(contact);
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const chance = lc.avatarSwapChance != null ? Number(lc.avatarSwapChance) : 0.08;
    if (!rollChance(chance)) return;

    const pool = getContactAvatarPool(contact);
    const mePool = getUserAvatarPool();
    let changed = false;
    const sysMsgs = [];

    if (pool.length >= 1) {
      const candidates = pool.filter(x => x && x !== contact.avatarImg);
      if (candidates.length) {
        contact.avatarImg = candidates[Math.floor(Math.random() * candidates.length)];
        changed = true;
        sysMsgs.push({
          id: genId('m'), from: 'system', type: 'system',
          text: `${contact.name} 更换了头像`, time: Date.now()
        });
      }
    }
    if (mePool.length >= 1 && Math.random() < 0.55) {
      const candidates = mePool.filter(x => x && x !== state.userAvatar);
      if (candidates.length) {
        state.userAvatar = candidates[Math.floor(Math.random() * candidates.length)];
        changed = true;
        sysMsgs.push({
          id: genId('m'), from: 'system', type: 'system',
          text: `${contact.name} 给你更换了头像`, time: Date.now()
        });
      }
    }
    if (!changed) return;
    if (!state.chats[contact.id]) state.chats[contact.id] = [];
    sysMsgs.forEach(m => state.chats[contact.id].push(m));
    saveData();
    updateMeAvatarUI();
    if (state.chatContactId === contact.id) {
      sysMsgs.forEach(m => appendMessage(m));
      const ha = $('#header-avatar');
      if (ha && contact.avatarImg) {
        ha.style.backgroundImage = `url(${contact.avatarImg})`;
        ha.textContent = '';
      }
      renderMessages();
    } else {
      renderChatList();
    }
  }

  // ========== 查岗提问（灵感：Mochi 查岗卡）==========
  function openAskQuestionEditor(index) {
    const c = state.contacts.find(x => x.id === state.currentContactId);
    if (!c) { alert('请先选择联系人'); return; }
    ensureContactShape(c);
    if (!Array.isArray(c.askQuestions)) c.askQuestions = [];
    const editing = (index != null && index >= 0) ? c.askQuestions[index] : null;
    state.modalMode = 'ask-question-edit';
    state._askQEditIndex = (index != null && index >= 0) ? index : -1;
    modalTitle.textContent = editing ? '编辑查岗题' : '添加查岗题';
    const type = editing ? (editing.type || 'text') : 'single';
    const optsText = editing && editing.type === 'single' && Array.isArray(editing.options)
      ? editing.options.map(o => `${o.t || ''}|${Array.isArray(o.reply) ? o.reply[0] : (o.reply || '')}`).join('\n')
      : '在想你|就知道你会这样说\n在忙|忙完记得找我';
    modalBody.innerHTML = `
      <div class="form-row"><label>题目</label><input type="text" id="askq-text" value="${escapeHtml(editing?.text || '')}" placeholder="例如：你在干嘛呀？"/></div>
      <div class="form-row"><label>类型</label>
        <select id="askq-type">
          <option value="single" ${type === 'single' ? 'selected' : ''}>单选题</option>
          <option value="text" ${type === 'text' ? 'selected' : ''}>简答题</option>
        </select>
      </div>
      <div class="form-row" id="askq-opts-row"><label>选项（每行：选项文字|对方回复）</label>
        <textarea id="askq-opts" rows="5" placeholder="选项A|回复A">${escapeHtml(optsText)}</textarea>
      </div>
      <div class="form-row" id="askq-reply-row"><label>简答后对方回复</label>
        <input type="text" id="askq-reply" value="${escapeHtml(editing?.reply || '嗯，我记下了')}" placeholder="嗯，我记下了"/>
      </div>
      <p style="font-size:11px;color:var(--muted)">单选至少 2 个选项。有自定义题库时优先用自定义，不再用系统默认题。</p>`;
    modalOverlay.classList.remove('hidden');
    const syncRows = () => {
      const t = $('#askq-type')?.value;
      const opts = $('#askq-opts-row');
      const rep = $('#askq-reply-row');
      if (opts) opts.style.display = t === 'single' ? '' : 'none';
      if (rep) rep.style.display = t === 'text' ? '' : 'none';
    };
    $('#askq-type')?.addEventListener('change', syncRows);
    syncRows();
  }

  // 系统默认查岗题已移除：仅使用联系人自定义 askQuestions

  function tryContactAsk(contact) {
    if (!contact || state.chatContactId !== contact.id) return;
    const lc = Object.assign({}, DEFAULT_LISTEN, contact.listenConfig || {});
    const chance = lc.askChance != null ? Number(lc.askChance) : 0.1;
    if (!rollChance(chance)) return;
    if (messageList.querySelector('.ask-card')) return;

    // 仅使用用户自定义查岗题；无自定义则不出题（已移除系统默认题）
    const qs = (contact.askQuestions && contact.askQuestions.length) ? contact.askQuestions : [];
    if (!qs.length) return;
    const q = qs[Math.floor(Math.random() * qs.length)];
    if (!q) return;

    const wrap = document.createElement('div');
    wrap.className = 'msg-row contact';
    const av = msgAvatarHtml('contact');
    let body = `<div class="msg-col"><div class="ask-card"><div class="ask-card-q">${escapeHtml(q.text)}</div>`;
    if (q.type === 'single' && q.options) {
      body += `<div class="ask-card-opts">${q.options.map((o, i) =>
        `<button type="button" data-oi="${i}">${escapeHtml(o.t)}</button>`).join('')}</div>`;
    } else {
      body += `<div class="ask-card-text"><input type="text" placeholder="输入回答…"/><button type="button" class="btn-xs" data-text-send>发送</button></div>`;
    }
    body += `</div><div class="msg-time">${formatTime(Date.now())}</div></div>`;
    wrap.innerHTML = av + body;
    messageList.appendChild(wrap);
    messageList.scrollTop = messageList.scrollHeight;

    const card = wrap.querySelector('.ask-card');
    const finish = (answerText, replyText) => {
      card.innerHTML = `<div class="ask-card-q">${escapeHtml(q.text)}</div><div style="font-size:12px;color:var(--muted);margin-top:6px">你：${escapeHtml(answerText)}</div>`;
      const reply = {
        id: genId('m'), from: 'contact', type: 'text',
        text: replyText || '嗯，收到了', time: Date.now()
      };
      pushMsg(reply);
      setTimeout(() => appendMessage(reply), 600 + Math.random() * 800);
    };
    card.querySelectorAll('[data-oi]').forEach(btn => {
      btn.addEventListener('click', () => {
        const oi = +btn.dataset.oi;
        const opt = q.options[oi];
        finish(opt.t, Array.isArray(opt.reply) ? opt.reply[0] : opt.reply);
      });
    });
    card.querySelector('[data-text-send]')?.addEventListener('click', () => {
      const inp = card.querySelector('input');
      const t = (inp?.value || '').trim();
      if (!t) return;
      finish(t, q.reply || '嗯，我记下了');
    });
  }

  // ========== 提问 / 问卷（用户向联系人） ==========
  function ensureQuestionnaires() {
    if (!Array.isArray(state.questionnaires)) state.questionnaires = [];
    return state.questionnaires;
  }

  function openQuickAskModal() {
    if (!state.chatContactId) { alert('请先进入聊天'); return; }
    state.modalMode = 'quick-ask';
    modalTitle.textContent = '向对方提问';
    modalBody.innerHTML = [
      '<div class="form-row"><label>问题</label><input type="text" id="ask-text" placeholder="例如：今天过得怎么样？"/></div>',
      '<div class="form-row"><label>类型</label>',
      '<select id="ask-type">',
      '<option value="text">简答题（对方用字卡回复）</option>',
      '<option value="single">单选题</option>',
      '</select></div>',
      '<div class="form-row" id="ask-opts-row" style="display:none">',
      '<label>选项（每行一个）</label>',
      '<textarea id="ask-opts" rows="4" placeholder="选项A&#10;选项B"></textarea></div>'
    ].join('');
    modalOverlay.classList.remove('hidden');
    $('#ask-type')?.addEventListener('change', function () {
      $('#ask-opts-row').style.display = $('#ask-type').value === 'single' ? 'block' : 'none';
    });
  }

  function openSurveyPickerModal() {
    if (!state.chatContactId) { alert('请先进入聊天'); return; }
    ensureQuestionnaires();
    state.modalMode = 'survey-picker';
    modalTitle.textContent = '发送问卷';
    var list = state.questionnaires;
    var items = list.length ? list.map(function (s) {
      return '<div class="settings-cell" data-sid="' + s.id + '" style="cursor:pointer"><span>' +
        escapeHtml(s.title) + '</span><span class="val">' + (s.questions || []).length + ' 题 ›</span></div>';
    }).join('') : '<p style="font-size:13px;color:var(--muted)">还没有问卷，请先新建</p>';
    modalBody.innerHTML = '<div class="toolbar-row" style="margin-bottom:10px">' +
      '<button type="button" class="btn-xs" id="btn-new-survey">＋ 新建问卷</button>' +
      '<button type="button" class="btn-xs" id="btn-manage-survey">管理</button></div>' +
      '<div id="survey-pick-list">' + items + '</div>';
    modalOverlay.classList.remove('hidden');
    $('#btn-new-survey')?.addEventListener('click', function () { openSurveyEditor(null); });
    $('#btn-manage-survey')?.addEventListener('click', openSurveyManager);
    modalBody.querySelectorAll('[data-sid]').forEach(function (el) {
      el.addEventListener('click', function () {
        var s = state.questionnaires.find(function (x) { return x.id === el.dataset.sid; });
        if (s) sendSurveyMessage(s);
      });
    });
  }

  function openSurveyManager() {
    ensureQuestionnaires();
    state.modalMode = 'survey-manager';
    modalTitle.textContent = '管理问卷';
    var rows = state.questionnaires.map(function (s) {
      return '<div class="settings-cell"><span>' + escapeHtml(s.title) + '（' + (s.questions || []).length +
        '题）</span><span><button type="button" class="btn-xs" data-edit="' + s.id +
        '">编辑</button> <button type="button" class="btn-xs" data-del="' + s.id + '">删除</button></span></div>';
    }).join('') || '<p style="color:var(--muted);font-size:13px">暂无</p>';
    modalBody.innerHTML = '<button type="button" class="btn-xs" id="btn-new-survey2">＋ 新建</button><div style="margin-top:10px">' + rows + '</div>';
    modalOverlay.classList.remove('hidden');
    $('#btn-new-survey2')?.addEventListener('click', function () { openSurveyEditor(null); });
    modalBody.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openSurveyEditor(b.dataset.edit); });
    });
    modalBody.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('删除该问卷？')) return;
        state.questionnaires = state.questionnaires.filter(function (x) { return x.id !== b.dataset.del; });
        saveData();
        openSurveyManager();
      });
    });
  }

  function openSurveyEditor(id) {
    ensureQuestionnaires();
    var existing = id ? state.questionnaires.find(function (x) { return x.id === id; }) : null;
    state.modalMode = 'survey-editor';
    state._surveyDraft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: genId('sv'), title: '未命名问卷', questions: [{ id: genId('sq'), type: 'single', text: '', options: ['选项1', '选项2'] }] };
    renderSurveyEditor();
    modalOverlay.classList.remove('hidden');
  }

  function renderSurveyEditor() {
    var d = state._surveyDraft;
    if (!d) return;
    modalTitle.textContent = '编辑问卷';
    var qHtml = (d.questions || []).map(function (q, qi) {
      var opts = q.type !== 'text'
        ? '<textarea data-qopts="' + qi + '" rows="3" placeholder="选项，每行一个">' + escapeHtml((q.options || []).join('\n')) + '</textarea>'
        : '<p style="font-size:11px;color:var(--muted)">简答题：对方将从字卡库随机回复</p>';
      return '<div class="survey-editor-q" data-qi="' + qi + '">' +
        '<div style="display:flex;justify-content:space-between"><strong>第 ' + (qi + 1) + ' 题</strong>' +
        '<button type="button" class="btn-xs" data-rm-q="' + qi + '">删除题</button></div>' +
        '<select data-type="' + qi + '">' +
        '<option value="single"' + (q.type === 'single' ? ' selected' : '') + '>单选题</option>' +
        '<option value="multi"' + (q.type === 'multi' ? ' selected' : '') + '>多选题</option>' +
        '<option value="text"' + (q.type === 'text' ? ' selected' : '') + '>简答题（字卡回复）</option>' +
        '</select>' +
        '<input type="text" data-qtext="' + qi + '" placeholder="题目内容" value="' + escapeHtml(q.text || '') + '"/>' +
        opts + '</div>';
    }).join('');
    modalBody.innerHTML = '<div class="form-row"><label>问卷标题</label><input type="text" id="sv-title" value="' +
      escapeHtml(d.title || '') + '"/></div><div id="sv-q-list">' + qHtml +
      '</div><button type="button" class="btn-xs" id="sv-add-q">＋ 添加题目</button>' +
      '<p style="font-size:11px;color:var(--muted);margin-top:8px">点「确定」保存问卷</p>';
    $('#sv-title')?.addEventListener('input', function (e) { d.title = e.target.value; });
    modalBody.querySelectorAll('[data-type]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        syncSurveyDraftFromDom();
        d.questions[+sel.dataset.type].type = sel.value;
        if (sel.value !== 'text' && !(d.questions[+sel.dataset.type].options || []).length) {
          d.questions[+sel.dataset.type].options = ['选项1', '选项2'];
        }
        renderSurveyEditor();
      });
    });
    modalBody.querySelectorAll('[data-rm-q]').forEach(function (b) {
      b.addEventListener('click', function () {
        syncSurveyDraftFromDom();
        d.questions.splice(+b.dataset.rmQ, 1);
        if (!d.questions.length) d.questions.push({ id: genId('sq'), type: 'text', text: '' });
        renderSurveyEditor();
      });
    });
    $('#sv-add-q')?.addEventListener('click', function () {
      syncSurveyDraftFromDom();
      d.questions.push({ id: genId('sq'), type: 'single', text: '', options: ['选项1', '选项2'] });
      renderSurveyEditor();
    });
  }

  function syncSurveyDraftFromDom() {
    var d = state._surveyDraft;
    if (!d) return;
    d.title = ($('#sv-title') && $('#sv-title').value) || d.title;
    (d.questions || []).forEach(function (q, qi) {
      var t = modalBody.querySelector('[data-qtext="' + qi + '"]');
      if (t) q.text = t.value;
      var o = modalBody.querySelector('[data-qopts="' + qi + '"]');
      if (o) q.options = o.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      var ty = modalBody.querySelector('[data-type="' + qi + '"]');
      if (ty) q.type = ty.value;
    });
  }

  function sendSurveyMessage(survey) {
    if (!state.chatContactId || !survey) return;
    var msg = {
      id: genId('m'), from: 'user', type: 'survey',
      title: survey.title || '问卷',
      questions: (survey.questions || []).map(function (q) {
        return { id: q.id || genId('sq'), type: q.type || 'text', text: q.text || '', options: q.options ? q.options.slice() : [] };
      }),
      answered: false, answers: {}, time: Date.now()
    };
    pushMsg(msg); appendMessage(msg); closeModal();
    scheduleContactAnswerSurvey(msg);
  }

  function scheduleContactAnswerSurvey(msg, contactOpt) {
    var c = contactOpt || state.contacts.find(function (x) { return x.id === state.chatContactId; });
    if (!c || !msg) return;
    msg._contactId = c.id;
    var lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
    var minD = Math.max(0.5, Number(lc.askMinDelay) || 2);
    var maxD = Math.max(minD, Number(lc.askMaxDelay) || 8);
    state.pendingTimers.push(setTimeout(function () {
      autoAnswerSurveyAsContact(msg, c);
    }, randomDelay(minD, maxD) * 1000));
  }

  function autoAnswerSurveyAsContact(msg, contact) {
    if (!msg || msg.answered) return;
    var pool = getContactCardPool(contact);
    var answers = {};
    (msg.questions || []).forEach(function (q, qi) {
      if (q.type === 'text') {
        answers[qi] = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '嗯……';
      } else if (q.type === 'multi') {
        var opts = q.options || [];
        var n = Math.max(1, Math.min(opts.length, 1 + Math.floor(Math.random() * Math.min(2, opts.length))));
        answers[qi] = opts.slice().sort(function () { return Math.random() - 0.5; }).slice(0, n);
      } else {
        var opts2 = q.options || ['好的'];
        answers[qi] = opts2[Math.floor(Math.random() * opts2.length)];
      }
    });
    msg.answered = true;
    msg.answers = answers;
    saveData();
    // 切走页面也要落库；在当前会话则刷新 UI
    if (state.chatContactId === contact.id) {
      renderMessages();
    } else {
      notifyContactMessage(contact.id, { from: 'contact', type: 'text', text: '[已填写问卷/提问]' });
      maybeBrowserNotify(contact, { type: 'text', text: '填写了你的问卷/提问' });
    }
    if (pool.length) {
      var follow = { id: genId('m'), from: 'contact', type: 'text', text: pool[Math.floor(Math.random() * pool.length)], time: Date.now() };
      deliverContactMsg(contact, follow);
    }
  }

  function bindSurveySubmit(row) {
    var btn = row.querySelector('[data-survey-submit]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var bubble = row.querySelector('[data-survey-id]');
      var id = bubble && bubble.getAttribute('data-survey-id');
      var msgs = state.chats[state.chatContactId] || [];
      var m = msgs.find(function (x) { return x.id === id; });
      if (!m || m.answered) return;
      var answers = {};
      (m.questions || []).forEach(function (q, qi) {
        if (q.type === 'text') {
          var inp = bubble.querySelector('.sv-text[data-qi="' + qi + '"]');
          answers[qi] = (inp && inp.value.trim()) || '（未填）';
        } else {
          var name = 'sv_' + m.id + '_' + qi;
          var selected = Array.prototype.slice.call(bubble.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; });
          answers[qi] = q.type === 'multi' ? selected : (selected[0] || '');
        }
      });
      m.answered = true;
      m.answers = answers;
      saveData();
      renderMessages();
      var c = state.contacts.find(function (x) { return x.id === state.chatContactId; });
      if (c) scheduleReplies(c, 1);
    });
  }

  var _bindMsgRowEventsOrig = bindMsgRowEvents;
  bindMsgRowEvents = function (row) {
    _bindMsgRowEventsOrig(row);
    bindSurveySubmit(row);
  };

  function wireAskSurvey() {}



  // ========== 群聊（轻量） ==========
  function openGroupPage() {
    const page = $('#group-page');
    if (!page) return;
    page.classList.remove('hidden');
    $('#group-chat-view')?.classList.add('hidden');
    if ($('#group-chat-view')) $('#group-chat-view').style.display = 'none';
    $('#group-list')?.classList.remove('hidden');
    $('#group-title').textContent = '群聊';
    renderGroupList();
  }
  function closeGroupPage() {
    $('#group-page')?.classList.add('hidden');
    state.activeGroupId = null;
  }
  function renderGroupList() {
    const list = $('#group-list');
    if (!list) return;
    if (!state.groups) state.groups = [];
    if (!state.groups.length) {
      list.innerHTML = '<div class="empty-state small"><p>还没有群聊</p><p class="hint">点右上角新建</p></div>';
      return;
    }
    list.innerHTML = state.groups.map(g => {
      const names = (g.memberIds || []).map(id => state.contacts.find(c => c.id === id)?.name || '?').join('、');
      const last = (g.messages || [])[(g.messages || []).length - 1];
      const prev = last ? (last.text || '[消息]') : '暂无消息';
      return `<div class="group-item" data-gid="${g.id}">
        <div class="g-av" style="${g.avatarImg ? 'background-image:url('+g.avatarImg+');background-size:cover' : ''}">${g.avatarImg ? '' : '群'}</div>
        <div style="flex:1;min-width:0">
          <div class="g-name">${escapeHtml(g.name)}</div>
          <div class="g-meta">${escapeHtml(names)} · ${escapeHtml(truncate(prev, 24))}</div>
        </div>
        <button class="btn-xs" data-gdel="${g.id}">删</button>
      </div>`;
    }).join('');
    list.querySelectorAll('.group-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-gdel]')) return;
        enterGroup(el.dataset.gid);
      });
    });
    list.querySelectorAll('[data-gdel]').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('删除该群聊？')) return;
        state.groups = state.groups.filter(x => x.id !== b.dataset.gdel);
        saveData();
        renderGroupList();
      });
    });
  }
  function openNewGroupModal() {
    if (!(state.contacts || []).length) { alert('请先添加联系人'); return; }
    state.modalMode = 'new-group';
    modalTitle.textContent = '新建群聊';
    modalBody.innerHTML = `<div class="form-row"><label>群名称</label><input type="text" id="group-name" placeholder="例如：周末小队"/></div>
      <p style="font-size:13px;margin:8px 0">选择成员</p>
      ${(state.contacts || []).map(c => `<label class="eqz-opt"><input type="checkbox" data-gc value="${c.id}"/> ${escapeHtml(c.name)}</label>`).join('')}`;
    modalOverlay.classList.remove('hidden');
  }
  function enterGroup(gid) {
    const g = (state.groups || []).find(x => x.id === gid);
    if (!g) return;
    state.activeGroupId = gid;
    clearUnread('group', gid);
    ensureGroupShape(g);
    $('#group-list')?.classList.add('hidden');
    const view = $('#group-chat-view');
    if (view) { view.classList.remove('hidden'); view.style.display = 'flex'; }
    $('#group-title').textContent = g.name;
    pageTitle.textContent = g.name || '群聊';
    $('#group-settings')?.classList.remove('hidden');
    $('#group-new')?.classList.add('hidden');
    btnBack.classList.remove('hidden');
    renderGroupMessages();
    applyGroupChatBg(g);
  }

  function ensureGroupShape(g) {
    if (!g.settings) {
      g.settings = { minDelay: 1.5, maxDelay: 4, maxReplies: 2 };
    }
    if (!g.listenConfig) {
      g.listenConfig = {
        replyChance: 0.85,
        readNoReplyChance: 0.05,
        askChance: 0.08,
        proactiveIntervalMin: 0
      };
    }
    if (!Array.isArray(g.messages)) g.messages = [];
    if (!Array.isArray(g.memberIds)) g.memberIds = [];
    return g;
  }

  function openGroupSettings() {
    const g = (state.groups || []).find(x => x.id === state.activeGroupId);
    if (!g) { alert('请先进入群聊'); return; }
    ensureGroupShape(g);
    const s = g.settings;
    const lc = g.listenConfig;
    state.modalMode = 'group-settings';
    state.poolContactId = g.id; // 复用上传目标
    modalTitle.textContent = '群聊设置 · ' + (g.name || '');
    const memberNames = (g.memberIds || []).map(id => state.contacts.find(c => c.id === id)?.name || id).join('、');
    const avStyle = g.avatarImg ? `background-image:url(${g.avatarImg})` : '';
    modalBody.innerHTML = `
      <div class="form-row"><label>群名称</label><input type="text" id="gs-name" value="${escapeHtml(g.name || '')}"/></div>
      <p style="font-size:12px;color:var(--muted);margin:6px 0">成员：${escapeHtml(memberNames)}</p>
      <div class="form-row"><label>群头像</label>
        <div class="group-avatar-preview" id="gs-av-preview" style="${avStyle}"></div>
        <button type="button" class="btn-xs" id="gs-pick-av">上传头像</button>
      </div>
      <div class="form-row"><label>聊天背景色</label><input type="color" id="gs-bg-color" value="${g.chatBgColor || '#1a1a22'}"/></div>
      <div class="form-row"><label>聊天背景图</label>
        <button type="button" class="btn-xs" id="gs-pick-bg">上传背景图</button>
        <button type="button" class="btn-xs" id="gs-clear-bg">清除背景图</button>
      </div>
      <div class="form-row"><label>回复最小延迟(秒)</label><input type="number" id="gs-min" step="0.5" value="${s.minDelay}"/></div>
      <div class="form-row"><label>回复最大延迟(秒)</label><input type="number" id="gs-max" step="0.5" value="${s.maxDelay}"/></div>
      <div class="form-row"><label>每次最多回复人数</label><input type="number" id="gs-count" min="1" max="5" value="${s.maxReplies}"/></div>
      <div class="form-row"><label>成员回复概率 %</label><input type="number" id="gs-reply" step="1" min="0" max="100" value="${Math.round((lc.replyChance||0.85)*100)}"/></div>
      <p style="font-size:11px;color:var(--muted)">成员将从各自字卡库中随机回复</p>`;
    modalOverlay.classList.remove('hidden');
    $('#gs-pick-av')?.addEventListener('click', () => {
      state.uploadTarget = 'group-avatar';
      state.groupUploadId = g.id;
      $('#file-avatar')?.click();
    });
    $('#gs-pick-bg')?.addEventListener('click', () => {
      state.uploadTarget = 'group-bg';
      state.groupUploadId = g.id;
      $('#file-bg')?.click();
    });
    $('#gs-clear-bg')?.addEventListener('click', () => {
      g.chatBgImg = null;
      saveData();
      applyGroupChatBg(g);
      alert('已清除背景图');
    });
  }

  function applyGroupChatBg(g) {
    const box = $('#group-messages');
    if (!box || !g) return;
    if (g.chatBgImg) {
      box.style.backgroundImage = `url(${g.chatBgImg})`;
      box.style.backgroundSize = 'cover';
      box.style.backgroundPosition = 'center';
      box.style.backgroundColor = '';
    } else if (g.chatBgColor) {
      box.style.backgroundImage = '';
      box.style.backgroundColor = g.chatBgColor;
    } else {
      box.style.backgroundImage = '';
      box.style.backgroundColor = '';
    }
  }
  function renderGroupMessages() {
    const box = $('#group-messages');
    const g = (state.groups || []).find(x => x.id === state.activeGroupId);
    if (!box || !g) return;
    const msgs = g.messages || [];
    box.innerHTML = msgs.map(m => {
      const isMe = m.from === 'user';
      const cls = isMe ? 'me' : 'other';
      let body = '';
      if (m.quote) {
        body += `<div class="gm-quote">${escapeHtml(m.quote.fromName || '')}: ${escapeHtml(truncate(m.quote.text || '[消息]', 40))}</div>`;
      }
      if (m.type === 'sticker' && m.stickerData) {
        body += `<div class="gm-sticker"><img src="${m.stickerData}" alt="表情"/></div>`;
      } else {
        body += escapeHtml(m.text || '');
      }
      const name = isMe ? '' : `<span class="gm-name">${escapeHtml(m.name || '')}</span>`;
      return `<div class="group-msg-row ${cls}" data-gmid="${m.id}">
        ${name}
        <div class="gm-bubble">${body}</div>
        <div class="gm-time">${formatTime(m.time)}</div>
      </div>`;
    }).join('') || '<div class="empty-state small"><p>开始群聊吧</p></div>';
    box.scrollTop = box.scrollHeight;
    // 长按引用
    box.querySelectorAll('.group-msg-row').forEach(row => {
      let timer = null;
      const start = () => { timer = setTimeout(() => {
        const id = row.dataset.gmid;
        const msg = (g.messages || []).find(x => x.id === id);
        if (!msg) return;
        state.groupQuoting = {
          id: msg.id,
          text: msg.text || (msg.type === 'sticker' ? '[表情]' : ''),
          fromName: msg.from === 'user' ? (state.userName || '我') : (msg.name || '')
        };
        const bar = $('#group-quote-bar');
        const tx = $('#group-quote-text');
        if (tx) tx.textContent = `${state.groupQuoting.fromName}: ${truncate(state.groupQuoting.text, 36)}`;
        bar?.classList.remove('hidden');
      }, 480); };
      const end = () => { if (timer) clearTimeout(timer); };
      row.addEventListener('touchstart', start, { passive: true });
      row.addEventListener('mousedown', start);
      row.addEventListener('touchend', end);
      row.addEventListener('mouseup', end);
      row.addEventListener('mouseleave', end);
    });
  }
  function sendGroupMessage(extra) {
    const g = (state.groups || []).find(x => x.id === state.activeGroupId);
    const input = $('#group-input');
    const text = (extra && extra.text != null) ? extra.text : (input?.value || '').trim();
    const isSticker = extra && extra.type === 'sticker';
    if (!g) return;
    if (!isSticker && !text) return;
    ensureGroupShape(g);
    const msg = {
      id: genId('gm'), from: 'user', time: Date.now(),
      text: isSticker ? '' : text,
      type: isSticker ? 'sticker' : 'text',
      stickerData: isSticker ? extra.stickerData : null
    };
    if (state.groupQuoting) {
      msg.quote = state.groupQuoting;
      state.groupQuoting = null;
      $('#group-quote-bar')?.classList.add('hidden');
    }
    g.messages.push(msg);
    if (input && !isSticker) input.value = '';
    saveData();
    renderGroupMessages();
    triggerGroupReplies(g);
  }
  function triggerGroupReplies(g) {
    const members = (g.memberIds || []).map(id => state.contacts.find(c => c.id === id)).filter(Boolean);
    const s = g.settings || { minDelay: 1.5, maxDelay: 4, maxReplies: 2 };
    const replyChance = g.listenConfig?.replyChance != null ? g.listenConfig.replyChance : 0.85;
    const maxN = Math.min(members.length, s.maxReplies || 2);
    const shuffled = members.slice().sort(() => Math.random() - 0.5);
    let replied = 0;
    shuffled.forEach(c => {
      if (replied >= maxN) return;
      if (!rollChance(replyChance)) return;
      replied++;
      const delay = randomDelay(s.minDelay || 1.5, s.maxDelay || 4);
      setTimeout(() => {
        const pool = getContactCardPool(c);
        const stickers = state.stickers || [];
        let m;
        if (stickers.length && Math.random() < 0.22) {
          const st = stickers[Math.floor(Math.random() * stickers.length)];
          m = { id: genId('gm'), from: 'contact', contactId: c.id, name: c.name, type: 'sticker', stickerData: st.data, text: '', time: Date.now() };
        } else if (pool.length) {
          m = { id: genId('gm'), from: 'contact', contactId: c.id, name: c.name, type: 'text', text: pool[Math.floor(Math.random() * pool.length)], time: Date.now() };
        } else return;
        g.messages.push(m);
        if (state.activeGroupId !== g.id) {
          addUnread('group', g.id, 1);
          renderChatList();
        }
        saveData();
        if (state.activeGroupId === g.id) renderGroupMessages();
      }, delay * 1000);
    });
  }
  function toggleGroupStickerPanel() {
    const panel = $('#group-sticker-panel');
    if (!panel) return;
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    const list = state.stickers || [];
    if (!list.length) { alert('请先在「我」页面导入表情包'); return; }
    panel.innerHTML = list.map(st => `<button type="button" class="sticker-item" data-sid="${st.id}"><img src="${st.data}"/></button>`).join('');
    panel.classList.remove('hidden');
    panel.querySelectorAll('[data-sid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const st = list.find(x => x.id === btn.dataset.sid);
        if (!st) return;
        panel.classList.add('hidden');
        sendGroupMessage({ type: 'sticker', stickerData: st.data, text: '' });
      });
    });
  }


  function openAvatarPoolModal(kind) {
    const isUser = kind === 'user';
    const c = state.contacts.find(x => x.id === (state.chatContactId || state.currentContactId));
    if (!isUser && !c) { alert('请先选择联系人'); return; }
    const pool = isUser ? getUserAvatarPool() : getContactAvatarPool(c);
    state.modalMode = isUser ? 'user-avatar-pool' : 'contact-avatar-pool';
    modalTitle.textContent = isUser ? '我的头像池' : `${c.name} 的头像池`;
    modalBody.innerHTML = `
      <p style="font-size:12px;color:var(--muted);margin-bottom:8px">上传多张后，对方有概率随机更换头像（聊天内会提示）。灵感参考 Mochi 字卡。</p>
      <div class="avatar-pool-grid" id="pool-grid">
        ${pool.map((src, i) => `<div class="avatar-pool-item" style="background-image:url(${src})"><button type="button" data-del="${i}">✕</button></div>`).join('')}
        <button type="button" class="avatar-pool-add" id="pool-add">＋</button>
      </div>
      ${!isUser ? `<div class="form-row" style="margin-top:12px"><label>随机更换概率 %</label>
        <input type="number" id="pool-chance" min="0" max="100" step="1" value="${Math.round(((c.listenConfig && c.listenConfig.avatarSwapChance != null) ? c.listenConfig.avatarSwapChance : 0.08)*100)}"/></div>` : ''}`;
    modalOverlay.classList.remove('hidden');
    $('#pool-add')?.addEventListener('click', () => {
      state.uploadTarget = isUser ? 'user-pool' : 'contact-pool';
      if (!isUser) state.poolContactId = c.id;
      $(isUser ? '#file-user-avatar-pool' : '#file-avatar-pool')?.click();
    });
    modalBody.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        pool.splice(+btn.dataset.del, 1);
        if (!isUser) {
          const v = parseFloat($('#pool-chance')?.value);
          if (!isNaN(v)) {
            ensureContactShape(c);
            c.listenConfig.avatarSwapChance = Math.max(0, Math.min(1, v / 100));
          }
        }
        saveData();
        openAvatarPoolModal(kind);
      });
    });
  }

  function wireAvatarPoolFiles() {
    const handlePool = async (files, isUser) => {
      if (!files?.length) return;
      let target;
      if (isUser) target = getUserAvatarPool();
      else {
        const c = state.contacts.find(x => x.id === state.poolContactId);
        target = c ? getContactAvatarPool(c) : null;
      }
      if (!target) return;
      for (const f of files) {
        try {
          const url = await compressImage(f, 200, 0.65);
          if (url) target.push(url);
        } catch (_) {}
      }
      saveData();
      openAvatarPoolModal(isUser ? 'user' : 'contact');
    };
    $('#file-avatar-pool')?.addEventListener('change', e => {
      const files = [...(e.target.files || [])]; e.target.value = '';
      handlePool(files, false);
    });
    $('#file-user-avatar-pool')?.addEventListener('change', e => {
      const files = [...(e.target.files || [])]; e.target.value = '';
      handlePool(files, true);
    });
  }

  // 注意：联系人设置保存统一走 openChatSettings 内 #cs-save（百分比→0~1）
  // 此处不再二次写入，避免把「10%」误存成 1.0（100%）

  // 扩展 proactive：头像更换 + 查岗
  const _sp = scheduleProactiveMessages;
  scheduleProactiveMessages = function () {
    if (state.proactiveTimer) clearInterval(state.proactiveTimer);
    if (!state.lastProactiveAt) state.lastProactiveAt = {};
    state.proactiveTimer = setInterval(() => {
      const now = Date.now();
      state.contacts.forEach(c => {
        tryRandomAvatarSwap(c);
        const lc = Object.assign({}, DEFAULT_LISTEN, c.listenConfig || {});
        const intervalMin = Number(lc.proactiveIntervalMin);
        if (!intervalMin || intervalMin <= 0) return;
        const last = state.lastProactiveAt[c.id] || 0;
        if (now - last < intervalMin * 60 * 1000) return;
        state.lastProactiveAt[c.id] = now;
        tryContactSendMoney(c);
        if (state.chatContactId === c.id) tryContactAsk(c);
        // 有概率邀请一起听（有歌曲时）
        if ((state.songs || []).length && tryContactListenInvite(c)) {
          /* 本轮已发邀请，可再发文字也可跳过 */
        }
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
  };

  // persist userAvatarPool
  const _serialize = (typeof serializeState === 'function') ? null : null;
  // patch via wrapping existing save path: inject into contacts already have avatarPool field on contact object

  // load userAvatarPool
  const origLoadNormalize = normalizeLoaded;
  // handled in init path after load

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

