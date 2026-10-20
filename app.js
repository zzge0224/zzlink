/**
 * 字笺 · ZiJian
 * 聊天 + 字卡 + 音乐库 + 一起听模拟
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'zijian_data_v6';
  const DEFAULT_SETTINGS = { minDelay: 1.5, maxDelay: 4, maxReplies: 2 };
  const DEFAULT_INTERACTION = ['轻轻拍了拍', '重重拍了拍', '拍了拍', '戳了戳', '碰了碰'];
  const DEFAULT_LISTEN = { pauseChance: 0.15, pauseDurationMax: 5, favoriteChance: 0.1 };
  const THEMES = ['classic', 'dark', 'cream', 'lavender'];

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
      listenConfig: { pauseChance: 0.2, pauseDurationMax: 4, favoriteChance: 0.12 }
    }
  ];

  let state = {
    contacts: [], chats: {}, musicLibrary: [],
    userBalance: 888, theme: 'classic',
    currentContactId: null, chatContactId: null,
    editingCardIndex: null, editingCardType: 'normal',
    modalMode: null, pendingTimers: [],
    quotingMsg: null, longPressMsg: null, uploadTarget: null,
    // listen
    listenContactId: null, listenSongId: null,
    listenLrc: [], listenTimer: null, listenPausedByContact: false
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ========== Storage ==========
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p.contacts) && p.contacts.length) {
          p.contacts.forEach((c) => {
            if (!c.settings) c.settings = { ...DEFAULT_SETTINGS };
            if (!c.interactionCards) c.interactionCards = [...DEFAULT_INTERACTION];
            if (!c.favorites) c.favorites = [];
            if (!c.listenConfig) c.listenConfig = { ...DEFAULT_LISTEN };
            if (c.avatarImg === undefined) c.avatarImg = null;
            if (c.chatBgColor === undefined) c.chatBgColor = null;
            if (c.chatBgImg === undefined) c.chatBgImg = null;
          });
          return {
            contacts: p.contacts,
            chats: p.chats || {},
            musicLibrary: Array.isArray(p.musicLibrary) ? p.musicLibrary : [],
            userBalance: typeof p.userBalance === 'number' ? p.userBalance : 888,
            theme: THEMES.includes(p.theme) ? p.theme : 'classic'
          };
        }
      }
    } catch (e) { console.warn(e); }
    return {
      contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)),
      chats: {}, musicLibrary: [], userBalance: 888, theme: 'classic'
    };
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        contacts: state.contacts, chats: state.chats,
        musicLibrary: state.musicLibrary,
        userBalance: state.userBalance, theme: state.theme
      }));
    } catch (e) {
      console.error(e);
      alert('保存失败，数据可能过大');
    }
  }

  function resetToDefault() {
    if (!confirm('确定重置？所有数据将恢复默认。')) return;
    clearPendingTimers();
    stopListenSession();
    state.contacts = JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
    state.chats = {}; state.musicLibrary = [];
    state.userBalance = 888; state.theme = 'classic';
    state.currentContactId = null; state.chatContactId = null;
    applyTheme('classic'); saveData();
    renderContactsList(); renderCardsPanel(); renderChatList();
    renderSongList(); showChatListView(); updateStats(); updateBalanceUI(); updateThemeUI();
  }

  // ========== DOM ==========
  const app = $('#app');
  const pageTitle = $('#page-title');
  const btnBack = $('#btn-back');
  const headerAvatar = $('#header-avatar');
  const contactsList = $('#contacts-list');
  const cardsPanel = $('#cards-panel');
  const modalOverlay = $('#modal-overlay');
  const modalTitle = $('#modal-title');
  const modalBody = $('#modal-body');
  const modalCancel = $('#modal-cancel');
  const modalConfirm = $('#modal-confirm');
  const btnReset = $('#btn-reset-data');
  const statContacts = $('#stat-contacts');
  const statCards = $('#stat-cards');
  const statSongs = $('#stat-songs');
  const userBalanceEl = $('#user-balance');
  const btnEditBalance = $('#btn-edit-balance');
  const themeGrid = $('#theme-grid');
  const fileAvatar = $('#file-avatar');
  const fileBg = $('#file-bg');
  const chatListView = $('#chat-list-view');
  const chatDetailView = $('#chat-detail-view');
  const chatList = $('#chat-list');
  const chatListEmpty = $('#chat-list-empty');
  const messageList = $('#message-list');
  const msgInput = $('#msg-input');
  const btnSend = $('#btn-send');
  const btnAttach = $('#btn-attach');
  const attachPanel = $('#attach-panel');
  const quoteBar = $('#quote-bar');
  const quoteBarText = $('#quote-bar-text');
  const quoteBarClose = $('#quote-bar-close');
  const msgActionMenu = $('#msg-action-menu');
  const songList = $('#song-list');
  const songListEmpty = $('#song-list-empty');
  const btnImportSong = $('#btn-import-song');
  const btnListenTogether = $('#btn-listen-together');
  const listenPage = $('#listen-page');
  const listenBack = $('#listen-back');
  const listenWithName = $('#listen-with-name');
  const listenModeHint = $('#listen-mode-hint');
  const listenCover = $('#listen-cover');
  const listenTitle = $('#listen-title');
  const listenArtist = $('#listen-artist');
  const listenLrcWrap = $('#listen-lrc-wrap');
  const listenLrc = $('#listen-lrc');
  const listenIframeWrap = $('#listen-iframe-wrap');
  const listenIframe = $('#listen-iframe');
  const listenControls = $('#listen-controls');
  const listenProgress = $('#listen-progress');
  const listenCur = $('#listen-cur');
  const listenDur = $('#listen-dur');
  const btnListenPlay = $('#btn-listen-play');
  const btnManualPlay = $('#btn-manual-play');
  const listenToast = $('#listen-toast');
  const audioEl = $('#audio-el');

  function applyTheme(name) {
    if (!THEMES.includes(name)) name = 'classic';
    state.theme = name;
    app.setAttribute('data-theme', name);
    if (state.chatContactId) applyContactChatBg(state.chatContactId);
  }
  function updateThemeUI() {
    $$('.theme-card').forEach((c) => c.classList.toggle('active', c.dataset.theme === state.theme));
  }

  // ========== Navigation ==========
  function switchPage(pageName) {
    $$('.page').forEach((p) => p.classList.remove('active'));
    $$('.tab-item').forEach((t) => t.classList.remove('active'));
    const page = $(`#page-${pageName}`);
    const tab = $(`.tab-item[data-page="${pageName}"]`);
    if (page) page.classList.add('active');
    if (tab) tab.classList.add('active');
    btnBack.classList.add('hidden');
    headerAvatar.classList.add('hidden');
    hideAttachPanel(); hideMsgMenu();

    if (pageName === 'chat') {
      if (state.chatContactId) enterChat(state.chatContactId);
      else { pageTitle.textContent = '聊天'; showChatListView(); renderChatList(); }
    } else if (pageName === 'contacts') {
      pageTitle.textContent = '联系人'; renderContactsList(); renderCardsPanel();
    } else if (pageName === 'music') {
      pageTitle.textContent = '音乐'; renderSongList();
    } else if (pageName === 'me') {
      pageTitle.textContent = '我'; updateStats(); updateBalanceUI(); updateThemeUI();
    }
  }

  // ========== Utils ==========
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  function truncate(str, n) { if (!str) return ''; return str.length > n ? str.slice(0, n) + '…' : str; }
  function formatTime(ts) {
    const d = new Date(ts), now = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }
  function formatSec(s) {
    s = Math.floor(s || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function randomDelay(min, max) { return min + Math.random() * (max - min); }
  function genId(prefix) { return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  function clearPendingTimers() { state.pendingTimers.forEach(clearTimeout); state.pendingTimers = []; }

  // ========== Chat (keep core) ==========
  function getPreviewText(msg) {
    if (!msg) return '暂无消息，点击开始聊天';
    if (msg.type === 'system' || msg.type === 'poke') return msg.text;
    if (msg.type === 'transfer') return `[转账] ${msg.amount} 星币`;
    if (msg.type === 'redpacket') return `[红包] ${msg.note || '恭喜发财'}`;
    return (msg.from === 'user' ? '我: ' : '') + (msg.text || '');
  }
  function renderAvatarEl(c) {
    if (c.avatarImg) return `<div class="avatar" style="background-image:url(${c.avatarImg})"></div>`;
    return `<div class="avatar" style="background:${c.avatarColor}">${c.name.charAt(0)}</div>`;
  }
  function renderChatList() {
    const items = state.contacts.map((c) => {
      const msgs = state.chats[c.id] || [];
      return { contact: c, last: msgs.length ? msgs[msgs.length - 1] : null };
    });
    items.sort((a, b) => (b.last?.time || 0) - (a.last?.time || 0));
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
    chatList.querySelectorAll('.chat-item').forEach((el) => {
      el.addEventListener('click', () => enterChat(el.dataset.id));
    });
  }
  function showChatListView() {
    chatListView.classList.remove('hidden'); chatDetailView.classList.add('hidden');
    btnBack.classList.add('hidden'); headerAvatar.classList.add('hidden');
    pageTitle.textContent = '聊天'; state.quotingMsg = null; updateQuoteBar();
    messageList.style.backgroundImage = ''; messageList.style.backgroundColor = '';
  }
  function applyContactChatBg(contactId) {
    const c = state.contacts.find((x) => x.id === contactId);
    if (!c) return;
    if (c.chatBgImg) { messageList.style.backgroundImage = `url(${c.chatBgImg})`; messageList.style.backgroundColor = ''; }
    else if (c.chatBgColor) { messageList.style.backgroundImage = ''; messageList.style.backgroundColor = c.chatBgColor; }
    else { messageList.style.backgroundImage = ''; messageList.style.backgroundColor = ''; }
  }
  function enterChat(contactId) {
    const c = state.contacts.find((x) => x.id === contactId);
    if (!c) return;
    state.chatContactId = contactId;
    chatListView.classList.add('hidden'); chatDetailView.classList.remove('hidden');
    btnBack.classList.remove('hidden'); pageTitle.textContent = c.name;
    headerAvatar.classList.remove('hidden');
    if (c.avatarImg) { headerAvatar.style.backgroundImage = `url(${c.avatarImg})`; headerAvatar.style.backgroundColor = ''; headerAvatar.textContent = ''; }
    else { headerAvatar.style.backgroundImage = ''; headerAvatar.style.background = c.avatarColor; headerAvatar.textContent = c.name.charAt(0); }
    applyContactChatBg(contactId);
    if (!state.chats[contactId]) state.chats[contactId] = [];
    renderMessages(); msgInput.value = ''; hideAttachPanel();
    state.quotingMsg = null; updateQuoteBar(); msgInput.focus();
  }
  function leaveChat() {
    clearPendingTimers();
    const typing = messageList.querySelector('.typing-row');
    if (typing) typing.remove();
    state.chatContactId = null; state.quotingMsg = null;
    showChatListView(); renderChatList();
  }

  function renderMsgBubble(m) {
    if (m.type === 'system' || m.type === 'poke') return `<div class="msg-system">${escapeHtml(m.text)}</div>`;
    if (m.type === 'transfer') return `<div class="msg-bubble msg-transfer"><div class="tf-label">${m.from === 'user' ? '转账给对方' : '收到转账'}</div><div class="tf-amount">${m.amount}<span class="tf-unit">星币</span></div>${m.note ? `<div class="tf-note">${escapeHtml(m.note)}</div>` : ''}</div>`;
    if (m.type === 'redpacket') return `<div class="msg-bubble msg-redpacket"><div class="rp-icon">🧧</div><div class="rp-body"><div class="rp-title">${escapeHtml(m.note || '恭喜发财，大吉大利')}</div><div class="rp-amount">${m.amount} 星币</div></div></div>`;
    let q = '';
    if (m.quote) {
      const qFrom = m.quote.from === 'user' ? '我' : (state.contacts.find((c) => c.id === state.chatContactId)?.name || '对方');
      q = `<div class="msg-quote"><div class="msg-quote-from">${escapeHtml(qFrom)}</div><div>${escapeHtml(truncate(m.quote.text || getPreviewText(m.quote), 40))}</div></div>`;
    }
    return `<div class="msg-bubble">${q}${escapeHtml(m.text || '')}</div>`;
  }
  function renderMessages() {
    const msgs = state.chats[state.chatContactId] || [];
    messageList.innerHTML = msgs.map((m) => {
      let cls = m.from; if (m.type === 'system' || m.type === 'poke') cls = 'system';
      return `<div class="msg-row ${cls}" data-id="${m.id}">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div></div>`;
    }).join('');
    messageList.querySelectorAll('.msg-row:not(.system)').forEach(bindLongPress);
    requestAnimationFrame(() => { messageList.scrollTop = messageList.scrollHeight; });
  }
  function appendMessage(msg) {
    const typing = messageList.querySelector('.typing-row'); if (typing) typing.remove();
    let cls = msg.from; if (msg.type === 'system' || msg.type === 'poke') cls = 'system';
    const row = document.createElement('div');
    row.className = `msg-row ${cls}`; row.dataset.id = msg.id;
    row.innerHTML = `${renderMsgBubble(msg)}<div class="msg-time">${formatTime(msg.time)}</div>`;
    messageList.appendChild(row);
    if (cls !== 'system') bindLongPress(row);
    messageList.scrollTop = messageList.scrollHeight;
  }
  function showTypingIndicator() {
    if (messageList.querySelector('.typing-row')) return;
    const row = document.createElement('div');
    row.className = 'msg-row contact typing-row';
    row.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    messageList.appendChild(row); messageList.scrollTop = messageList.scrollHeight;
  }
  function bindLongPress(row) {
    let timer = null;
    const start = () => { timer = setTimeout(() => {
      const msg = (state.chats[state.chatContactId] || []).find((m) => m.id === row.dataset.id);
      if (msg) showMsgMenu(msg, row);
    }, 500); };
    const cancel = () => { if (timer) clearTimeout(timer); };
    row.addEventListener('touchstart', start, { passive: true });
    row.addEventListener('touchend', cancel); row.addEventListener('touchmove', cancel);
    row.addEventListener('mousedown', start); row.addEventListener('mouseup', cancel); row.addEventListener('mouseleave', cancel);
  }
  function showMsgMenu(msg, row) {
    state.longPressMsg = msg;
    const rect = row.getBoundingClientRect();
    msgActionMenu.style.left = Math.min(rect.left + 20, window.innerWidth - 120) + 'px';
    msgActionMenu.style.top = (rect.top - 48) + 'px';
    msgActionMenu.classList.remove('hidden');
  }
  function hideMsgMenu() { msgActionMenu.classList.add('hidden'); state.longPressMsg = null; }
  function startQuote() {
    if (!state.longPressMsg) return;
    state.quotingMsg = state.longPressMsg; updateQuoteBar(); hideMsgMenu(); msgInput.focus();
  }
  function updateQuoteBar() {
    if (state.quotingMsg) {
      quoteBarText.textContent = truncate(state.quotingMsg.text || getPreviewText(state.quotingMsg), 30);
      quoteBar.classList.remove('hidden');
    } else quoteBar.classList.add('hidden');
  }
  function clearQuote() { state.quotingMsg = null; updateQuoteBar(); }

  function doPoke() {
    const c = state.contacts.find((x) => x.id === state.chatContactId); if (!c) return;
    const pokeMsg = { id: genId('m'), from: 'system', type: 'poke', text: `你拍了拍 ${c.name}`, time: Date.now() };
    pushMsg(pokeMsg); appendMessage(pokeMsg);
    const t = setTimeout(() => {
      if (state.chatContactId !== c.id) return;
      if (Math.random() < 0.7) {
        const actions = c.interactionCards?.length ? c.interactionCards : DEFAULT_INTERACTION;
        const back = { id: genId('m'), from: 'system', type: 'poke', text: `${c.name}${actions[Math.floor(Math.random() * actions.length)]}你`, time: Date.now() };
        pushMsg(back); appendMessage(back);
      }
      scheduleReplies(c, 1);
    }, randomDelay(0.8, 2.2) * 1000);
    state.pendingTimers.push(t);
  }

  function sendMessage() {
    const text = msgInput.value.trim(); if (!text || !state.chatContactId) return;
    const c = state.contacts.find((x) => x.id === state.chatContactId); if (!c) return;
    const msg = { id: genId('m'), from: 'user', type: state.quotingMsg ? 'quote' : 'text', text, time: Date.now() };
    if (state.quotingMsg) msg.quote = { id: state.quotingMsg.id, from: state.quotingMsg.from, text: state.quotingMsg.text || getPreviewText(state.quotingMsg), type: state.quotingMsg.type };
    pushMsg(msg); appendMessage(msg); msgInput.value = ''; autoResizeInput(); clearQuote(); hideAttachPanel();
    scheduleReplies(c);
  }
  function pushMsg(msg) {
    if (!state.chats[state.chatContactId]) state.chats[state.chatContactId] = [];
    state.chats[state.chatContactId].push(msg); saveData();
  }
  function scheduleReplies(contact, forceCount) {
    clearPendingTimers();
    const settings = contact.settings || DEFAULT_SETTINGS;
    const maxR = Math.min(3, Math.max(1, settings.maxReplies || 2));
    const count = forceCount || (Math.floor(Math.random() * maxR) + 1);
    if (!contact.cards?.length) {
      const fb = { id: genId('m'), from: 'contact', type: 'text', text: '（对方还没有设置字卡）', time: Date.now() };
      state.pendingTimers.push(setTimeout(() => { if (state.chatContactId !== contact.id) return; pushMsg(fb); appendMessage(fb); }, randomDelay(settings.minDelay, settings.maxDelay) * 1000));
      return;
    }
    const selected = [];
    for (let i = 0; i < count; i++) selected.push(contact.cards[Math.floor(Math.random() * contact.cards.length)]);
    let cum = 0;
    selected.forEach((text) => {
      const d = randomDelay(settings.minDelay, settings.maxDelay); cum += d;
      state.pendingTimers.push(setTimeout(() => { if (state.chatContactId !== contact.id) return; showTypingIndicator(); }, Math.max(0, (cum - d * 0.6) * 1000)));
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        const msg = { id: genId('m'), from: 'contact', type: 'text', text, time: Date.now() };
        pushMsg(msg); appendMessage(msg);
      }, cum * 1000));
    });
  }

  function openMoneyModal(kind) {
    state.modalMode = kind;
    modalTitle.textContent = kind === 'transfer' ? '转账' : '发红包';
    modalBody.innerHTML = `<div class="form-row"><label>金额（星币）</label><input type="number" id="money-amount" min="1" value="8.88" /></div>
      <div class="form-row"><label>备注</label><input type="text" id="money-note" placeholder="${kind === 'redpacket' ? '恭喜发财' : '备注'}" /></div>
      <div class="form-row" style="font-size:12px;color:var(--muted)">余额：${state.userBalance}</div>`;
    modalOverlay.classList.remove('hidden'); hideAttachPanel();
  }
  function confirmMoney() {
    const amount = parseFloat($('#money-amount')?.value) || 0;
    const note = ($('#money-note')?.value || '').trim();
    if (amount <= 0) { alert('请输入有效金额'); return; }
    const kind = state.modalMode;
    const msg = { id: genId('m'), from: 'user', type: kind, text: '', amount, note: note || (kind === 'redpacket' ? '恭喜发财，大吉大利' : ''), time: Date.now() };
    if (state.userBalance >= amount) { state.userBalance = Math.round((state.userBalance - amount) * 100) / 100; updateBalanceUI(); }
    pushMsg(msg); appendMessage(msg); saveData(); closeModal();
    const c = state.contacts.find((x) => x.id === state.chatContactId);
    if (c) {
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId !== c.id) return;
        if (Math.random() < 0.35) {
          const back = { id: genId('m'), from: 'contact', type: Math.random() < 0.5 ? 'transfer' : 'redpacket', amount: Math.round((Math.random() * 20 + 1) * 100) / 100, note: '谢谢', time: Date.now() };
          pushMsg(back); appendMessage(back);
        } else scheduleReplies(c, 1);
      }, randomDelay(1.2, 3) * 1000));
    }
  }
  function toggleAttachPanel() {
    if (attachPanel.classList.contains('hidden')) { attachPanel.classList.remove('hidden'); btnAttach.classList.add('active'); }
    else hideAttachPanel();
  }
  function hideAttachPanel() { attachPanel.classList.add('hidden'); btnAttach.classList.remove('active'); }
  function autoResizeInput() { msgInput.style.height = 'auto'; msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px'; }

  // ========== Contacts ==========
  function renderContactsList() {
    contactsList.innerHTML = '';
    state.contacts.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'contact-item' + (c.id === state.currentContactId ? ' active' : '');
      item.dataset.id = c.id;
      item.innerHTML = `${renderAvatarEl(c)}<div class="contact-name">${escapeHtml(c.name)}</div>`;
      item.addEventListener('click', () => { state.currentContactId = c.id; renderContactsList(); renderCardsPanel(); });
      contactsList.appendChild(item);
    });
  }
  function renderCardsPanel() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) { cardsPanel.innerHTML = `<div class="empty-state small"><p>选择一位联系人查看字卡库</p></div>`; return; }
    const s = contact.settings || DEFAULT_SETTINGS;
    const makeCard = (text, idx, type) => `<div class="card-item ${type === 'interaction' ? 'interaction' : ''}"><div class="card-text">${escapeHtml(text)}</div><div class="card-actions"><button class="card-btn edit" data-index="${idx}" data-type="${type}">✎</button><button class="card-btn delete" data-index="${idx}" data-type="${type}">✕</button></div></div>`;
    const favSongs = (contact.favorites || []).map((sid) => state.musicLibrary.find((s) => s.id === sid)).filter(Boolean);
    cardsPanel.innerHTML = `
      <div class="cards-header"><h2>${escapeHtml(contact.name)}</h2><button class="btn-settings" id="btn-settings">设置</button></div>
      <div class="settings-summary">回复延迟 <strong>${s.minDelay}~${s.maxDelay}s</strong> · 最多 <strong>${s.maxReplies}</strong> 条</div>
      <div class="contact-custom-bar">
        <button class="btn-custom" id="btn-set-avatar">更换头像</button>
        <button class="btn-custom" id="btn-set-bg">聊天背景</button>
        <button class="btn-custom" id="btn-clear-custom">清除个性化</button>
      </div>
      <div class="section-title">普通字卡 <button class="btn-add" id="btn-add-card" style="margin-left:8px">+ 添加</button></div>
      <div class="card-list">${(contact.cards || []).map((t, i) => makeCard(t, i, 'normal')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">互动字卡 <button class="btn-add" id="btn-add-inter" style="margin-left:8px">+ 添加</button></div>
      <div class="card-list">${(contact.interactionCards || []).map((t, i) => makeCard(t, i, 'interaction')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}</div>
      <div class="section-title">TA 收藏的歌</div>
      <div class="fav-song-list">${favSongs.map((s) => `
        <div class="fav-song-item" data-sid="${s.id}">
          <div class="fav-song-cover" ${s.coverUrl ? `style="background-image:url(${s.coverUrl})"` : ''}>${s.coverUrl ? '' : '🎵'}</div>
          <div class="fav-song-info"><div class="fav-song-title">${escapeHtml(s.title)}</div><div class="fav-song-artist">${escapeHtml(s.artist || '')}</div></div>
        </div>`).join('') || '<div class="empty-state small"><p>暂无收藏</p></div>'}</div>`;
    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add', 'normal'));
    $('#btn-add-inter')?.addEventListener('click', () => openCardModal('add', 'interaction'));
    $('#btn-settings')?.addEventListener('click', openSettingsModal);
    $('#btn-set-avatar')?.addEventListener('click', () => { state.uploadTarget = 'avatar'; fileAvatar.click(); });
    $('#btn-set-bg')?.addEventListener('click', openBgModal);
    $('#btn-clear-custom')?.addEventListener('click', () => {
      if (!confirm('清除该联系人的自定义头像和背景？')) return;
      contact.avatarImg = null; contact.chatBgColor = null; contact.chatBgImg = null;
      saveData(); renderContactsList(); renderCardsPanel();
      if (state.chatContactId === contact.id) { applyContactChatBg(contact.id); enterChat(contact.id); }
    });
    cardsPanel.querySelectorAll('.card-btn.edit').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openCardModal('edit', btn.dataset.type, parseInt(btn.dataset.index, 10)); });
    });
    cardsPanel.querySelectorAll('.card-btn.delete').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteCard(btn.dataset.type, parseInt(btn.dataset.index, 10)); });
    });
    cardsPanel.querySelectorAll('.fav-song-item').forEach((el) => {
      el.addEventListener('click', () => {
        openListenWithContact(contact.id, el.dataset.sid);
      });
    });
  }

  // ========== Music Library ==========
  function parseMusicLink(input) {
    if (!input) return null;
    const str = input.trim();
    // playlist
    let m = str.match(/(?:playlist|歌单)[^\d]{0,20}id[=/:](\d+)/i) || str.match(/\/playlist\/(\d+)/i);
    if (m || (/playlist/i.test(str) && (m = str.match(/[?&#]id=(\d+)/i)))) {
      return { kind: 'playlist', neteaseId: m[1] };
    }
    // song id
    m = str.match(/(?:song|单曲)[^\d]{0,20}id[=/:](\d+)/i) || str.match(/\/song\/(\d+)/i);
    if (m || ((/song|单曲|music\.163/i.test(str)) && (m = str.match(/[?&#]id=(\d+)/i)))) {
      return { kind: 'song', neteaseId: m[1] };
    }
    // pure id
    m = str.match(/^\s*(\d{5,})\s*$/);
    if (m) return { kind: 'song', neteaseId: m[1] };
    // direct audio url
    if (/\.(mp3|m4a|ogg|wav|flac)(\?|$)/i.test(str) || /^https?:\/\/.+\.(mp3|m4a)/i.test(str)) {
      return { kind: 'direct', audioUrl: str };
    }
    return null;
  }

  function renderSongList() {
    if (!state.musicLibrary.length) {
      songList.innerHTML = '';
      songListEmpty.classList.remove('hidden');
      return;
    }
    songListEmpty.classList.add('hidden');
    songList.innerHTML = state.musicLibrary.map((s) => `
      <div class="song-item" data-id="${s.id}">
        <div class="song-cover" ${s.coverUrl ? `style="background-image:url(${escapeHtml(s.coverUrl)})"` : ''}>${s.coverUrl ? '' : '🎵'}</div>
        <div class="song-info">
          <div class="song-title">${escapeHtml(s.title || '未命名')}</div>
          <div class="song-meta">
            <span>${escapeHtml(s.artist || '未知歌手')}</span>
            <span class="song-mode-tag">${s.mode === 'direct' ? '直链' : '嵌入'}</span>
          </div>
        </div>
        <button class="song-del" data-id="${s.id}" title="删除">✕</button>
      </div>`).join('');
    songList.querySelectorAll('.song-del').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('确定删除这首歌？')) return;
        state.musicLibrary = state.musicLibrary.filter((s) => s.id !== btn.dataset.id);
        state.contacts.forEach((c) => { if (c.favorites) c.favorites = c.favorites.filter((id) => id !== btn.dataset.id); });
        saveData(); renderSongList(); updateStats();
      });
    });
  }

  function openImportSongModal() {
    state.modalMode = 'import-song';
    modalTitle.textContent = '导入歌曲';
    modalBody.innerHTML = `
      <div class="form-row"><label>链接（网易云单曲/歌单 或 音频直链）</label>
        <input type="text" id="imp-link" placeholder="粘贴链接或纯数字 ID" /></div>
      <div class="form-row"><label>歌名</label><input type="text" id="imp-title" placeholder="可选，后续可改" /></div>
      <div class="form-row"><label>歌手</label><input type="text" id="imp-artist" placeholder="可选" /></div>
      <div class="form-row"><label>音频直链（direct 模式）</label><input type="text" id="imp-audio" placeholder="https://...mp3" /></div>
      <div class="form-row"><label>封面图 URL</label><input type="text" id="imp-cover" placeholder="可选" /></div>
      <div class="form-row"><label>LRC 歌词（direct 模式）</label><textarea id="imp-lrc" rows="4" placeholder="[00:12.00]歌词内容"></textarea></div>
      <div class="form-row" style="font-size:12px;color:var(--muted)">歌单链接将批量生成嵌入条目，标题可后续补全</div>`;
    modalOverlay.classList.remove('hidden');
  }

  function confirmImportSong() {
    const link = ($('#imp-link')?.value || '').trim();
    const title = ($('#imp-title')?.value || '').trim();
    const artist = ($('#imp-artist')?.value || '').trim();
    const audioUrl = ($('#imp-audio')?.value || '').trim();
    const coverUrl = ($('#imp-cover')?.value || '').trim();
    const lrcText = ($('#imp-lrc')?.value || '').trim();

    const parsed = parseMusicLink(link || audioUrl);
    if (!parsed && !audioUrl) {
      alert('请填写有效链接或音频直链');
      return;
    }

    if (parsed && parsed.kind === 'playlist') {
      // 批量：先只生成一条歌单条目（用户可多次导入单曲补全）
      // 按需求：批量生成 iframe 条目，但歌单只有一个 id，我们生成一条代表歌单的条目
      // 若用户想多首，需分别导入单曲。这里为歌单创建 1 条，标题提示为歌单
      const song = {
        id: genId('song'),
        title: title || `歌单 ${parsed.neteaseId}`,
        artist: artist || '网易云歌单',
        coverUrl: coverUrl || null,
        mode: 'iframe',
        audioUrl: null,
        lrcText: null,
        neteaseId: parsed.neteaseId,
        neteaseType: 0
      };
      state.musicLibrary.push(song);
      // 再提示：歌单内单曲需单独导入
      saveData(); renderSongList(); updateStats(); closeModal();
      alert('已导入歌单条目（嵌入模式）。若要逐首直链，请分别导入单曲。');
      return;
    }

    if (audioUrl || (parsed && parsed.kind === 'direct')) {
      const song = {
        id: genId('song'),
        title: title || '未命名歌曲',
        artist: artist || '未知歌手',
        coverUrl: coverUrl || null,
        mode: 'direct',
        audioUrl: audioUrl || parsed.audioUrl,
        lrcText: lrcText || null,
        neteaseId: null
      };
      state.musicLibrary.push(song);
    } else if (parsed && parsed.kind === 'song') {
      const song = {
        id: genId('song'),
        title: title || `单曲 ${parsed.neteaseId}`,
        artist: artist || '网易云',
        coverUrl: coverUrl || null,
        mode: 'iframe',
        audioUrl: null,
        lrcText: lrcText || null,
        neteaseId: parsed.neteaseId,
        neteaseType: 2
      };
      state.musicLibrary.push(song);
    } else {
      alert('无法识别链接类型');
      return;
    }
    saveData(); renderSongList(); updateStats(); closeModal();
  }

  // ========== 一起听 ==========
  function parseLrc(text) {
    if (!text) return [];
    const lines = [];
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/);
      if (m) {
        const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0);
        lines.push({ time: t, text: m[4].trim() });
      }
    });
    return lines.sort((a, b) => a.time - b.time);
  }

  function openListenPicker() {
    if (!state.musicLibrary.length) { alert('请先导入歌曲'); return; }
    state.modalMode = 'listen-pick';
    modalTitle.textContent = '选择联系人一起听';
    modalBody.innerHTML = `
      <div class="form-row"><label>歌曲</label>
        <select id="pick-song">${state.musicLibrary.map((s) => `<option value="${s.id}">${escapeHtml(s.title)} · ${escapeHtml(s.artist || '')}</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>联系人</label>
        <select id="pick-contact">${state.contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>`;
    modalOverlay.classList.remove('hidden');
  }

  function confirmListenPick() {
    const songId = $('#pick-song')?.value;
    const contactId = $('#pick-contact')?.value;
    closeModal();
    if (songId && contactId) openListenWithContact(contactId, songId);
  }

  function openListenWithContact(contactId, songId) {
    const contact = state.contacts.find((c) => c.id === contactId);
    const song = state.musicLibrary.find((s) => s.id === songId);
    if (!contact || !song) return;

    state.listenContactId = contactId;
    state.listenSongId = songId;
    state.listenPausedByContact = false;

    listenWithName.textContent = `与 ${contact.name} 一起听`;
    listenTitle.textContent = song.title || '未命名';
    listenArtist.textContent = song.artist || '未知歌手';

    if (song.coverUrl) {
      listenCover.style.backgroundImage = `url(${song.coverUrl})`;
      listenCover.textContent = '';
    } else {
      listenCover.style.backgroundImage = '';
      listenCover.textContent = '🎵';
    }

    if (song.mode === 'iframe') {
      listenModeHint.textContent = '嵌入模式：无法同步歌词与对方操作';
      listenLrcWrap.classList.add('hidden');
      listenControls.classList.add('hidden');
      listenIframeWrap.classList.remove('hidden');
      const type = song.neteaseType != null ? song.neteaseType : 2;
      listenIframe.src = `https://music.163.com/outchain/player?type=${type}&id=${song.neteaseId}&auto=0&height=66`;
      listenCover.classList.remove('rotating');
    } else {
      listenModeHint.textContent = '直链模式 · 可同步歌词与互动';
      listenIframeWrap.classList.add('hidden');
      listenIframe.removeAttribute('src');
      listenLrcWrap.classList.remove('hidden');
      listenControls.classList.remove('hidden');
      state.listenLrc = parseLrc(song.lrcText);
      renderLrcLines();
      audioEl.src = song.audioUrl || '';
      audioEl.load();
      btnListenPlay.textContent = '▶';
      listenCover.classList.add('rotating');
      listenCover.classList.add('paused');
      btnManualPlay.classList.add('hidden');
      startContactInteraction(contact);
      // try autoplay
      const p = audioEl.play();
      if (p && p.then) {
        p.then(() => { btnListenPlay.textContent = '❚❚'; listenCover.classList.remove('paused'); })
          .catch(() => { btnManualPlay.classList.remove('hidden'); });
      }
    }

    listenPage.classList.remove('hidden');
  }

  function renderLrcLines() {
    if (!state.listenLrc.length) {
      listenLrc.innerHTML = '<div class="lrc-line">暂无歌词</div>';
      return;
    }
    listenLrc.innerHTML = state.listenLrc.map((l, i) => `<div class="lrc-line" data-i="${i}">${escapeHtml(l.text) || ' '}</div>`).join('');
  }

  function updateLrcHighlight() {
    if (!state.listenLrc.length) return;
    const t = audioEl.currentTime;
    let idx = 0;
    for (let i = 0; i < state.listenLrc.length; i++) {
      if (state.listenLrc[i].time <= t) idx = i; else break;
    }
    const lines = listenLrc.querySelectorAll('.lrc-line');
    lines.forEach((el, i) => el.classList.toggle('active', i === idx));
    if (lines[idx]) {
      const wrapH = listenLrcWrap.clientHeight;
      const lineTop = lines[idx].offsetTop;
      const lineH = lines[idx].offsetHeight;
      listenLrc.style.transform = `translateY(${wrapH / 2 - lineTop - lineH / 2}px)`;
    }
  }

  function startContactInteraction(contact) {
    stopContactInteraction();
    const cfg = contact.listenConfig || DEFAULT_LISTEN;
    state.listenTimer = setInterval(() => {
      if (state.listenPausedByContact) return;
      if (audioEl.paused) return;
      // pause
      if (Math.random() < (cfg.pauseChance || 0.15)) {
        state.listenPausedByContact = true;
        audioEl.pause();
        listenCover.classList.add('paused');
        btnListenPlay.textContent = '▶';
        showListenToast(`${contact.name} 暂停了播放`);
        const dur = (1 + Math.random() * ((cfg.pauseDurationMax || 5) - 1)) * 1000;
        setTimeout(() => {
          if (!state.listenContactId) return;
          state.listenPausedByContact = false;
          audioEl.play().then(() => {
            listenCover.classList.remove('paused');
            btnListenPlay.textContent = '❚❚';
            showListenToast('继续播放');
          }).catch(() => { btnManualPlay.classList.remove('hidden'); });
        }, dur);
        return;
      }
      // favorite
      if (Math.random() < (cfg.favoriteChance || 0.1)) {
        if (!contact.favorites) contact.favorites = [];
        if (!contact.favorites.includes(state.listenSongId)) {
          contact.favorites.push(state.listenSongId);
          saveData();
          showListenToast(`${contact.name} 收藏了这首歌`);
        }
      }
    }, 3000 + Math.random() * 2000);
  }

  function stopContactInteraction() {
    if (state.listenTimer) { clearInterval(state.listenTimer); state.listenTimer = null; }
  }

  function showListenToast(text) {
    listenToast.textContent = text;
    listenToast.classList.remove('hidden');
    setTimeout(() => listenToast.classList.add('hidden'), 2200);
  }

  function stopListenSession() {
    stopContactInteraction();
    audioEl.pause();
    audioEl.removeAttribute('src');
    listenIframe.removeAttribute('src');
    state.listenContactId = null;
    state.listenSongId = null;
    state.listenLrc = [];
    state.listenPausedByContact = false;
    listenPage.classList.add('hidden');
  }

  function toggleListenPlay() {
    if (audioEl.paused) {
      audioEl.play().then(() => {
        btnListenPlay.textContent = '❚❚';
        listenCover.classList.remove('paused');
        btnManualPlay.classList.add('hidden');
      }).catch(() => { btnManualPlay.classList.remove('hidden'); });
    } else {
      audioEl.pause();
      btnListenPlay.textContent = '▶';
      listenCover.classList.add('paused');
    }
  }

  // ========== Modals ==========
  function openCardModal(mode, type, index) {
    state.modalMode = mode === 'edit' ? 'card-edit' : 'card-add';
    state.editingCardType = type;
    state.editingCardIndex = mode === 'edit' ? index : null;
    modalTitle.textContent = (mode === 'edit' ? '编辑' : '添加') + (type === 'interaction' ? '互动字卡' : '字卡');
    modalBody.innerHTML = `<textarea id="modal-input" rows="3" placeholder="输入内容..."></textarea>`;
    const input = $('#modal-input');
    if (mode === 'edit') {
      const c = state.contacts.find((x) => x.id === state.currentContactId);
      const arr = type === 'interaction' ? c.interactionCards : c.cards;
      input.value = arr ? arr[index] : '';
    }
    modalOverlay.classList.remove('hidden'); input.focus();
  }
  function openSettingsModal() {
    const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c) return;
    state.modalMode = 'settings';
    modalTitle.textContent = '回复设置 · ' + c.name;
    const s = c.settings || DEFAULT_SETTINGS;
    const lc = c.listenConfig || DEFAULT_LISTEN;
    modalBody.innerHTML = `
      <div class="form-row"><label>最小回复延迟（秒）</label><input type="number" id="set-min" min="0.5" step="0.5" value="${s.minDelay}" /></div>
      <div class="form-row"><label>最大回复延迟（秒）</label><input type="number" id="set-max" min="0.5" step="0.5" value="${s.maxDelay}" /></div>
      <div class="form-row"><label>每次最多回复条数</label><input type="number" id="set-count" min="1" max="3" value="${s.maxReplies}" /></div>
      <div class="form-row"><label>一起听·暂停概率 (0~1)</label><input type="number" id="set-pause-c" min="0" max="1" step="0.05" value="${lc.pauseChance}" /></div>
      <div class="form-row"><label>一起听·最长暂停秒数</label><input type="number" id="set-pause-d" min="1" max="30" value="${lc.pauseDurationMax}" /></div>
      <div class="form-row"><label>一起听·收藏概率 (0~1)</label><input type="number" id="set-fav-c" min="0" max="1" step="0.05" value="${lc.favoriteChance}" /></div>`;
    modalOverlay.classList.remove('hidden');
  }
  function openBgModal() {
    const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c) return;
    state.modalMode = 'chat-bg';
    modalTitle.textContent = '聊天背景 · ' + c.name;
    modalBody.innerHTML = `<div class="form-row"><label>背景颜色</label><input type="color" id="bg-color" value="${c.chatBgColor || '#141311'}" /></div>
      <div class="form-row"><button class="btn-primary" id="btn-pick-bg-img" style="width:100%">上传背景图片</button></div>`;
    modalOverlay.classList.remove('hidden');
    $('#btn-pick-bg-img')?.addEventListener('click', () => { state.uploadTarget = 'bg'; fileBg.click(); });
  }
  function openBalanceModal() {
    state.modalMode = 'balance';
    modalTitle.textContent = '修改星币余额';
    modalBody.innerHTML = `<div class="form-row"><label>星币数量</label><input type="number" id="set-balance" min="0" value="${state.userBalance}" /></div>`;
    modalOverlay.classList.remove('hidden');
  }
  function closeModal() { modalOverlay.classList.add('hidden'); state.modalMode = null; state.editingCardIndex = null; }

  function confirmModal() {
    if (state.modalMode === 'transfer' || state.modalMode === 'redpacket') { confirmMoney(); return; }
    if (state.modalMode === 'import-song') { confirmImportSong(); return; }
    if (state.modalMode === 'listen-pick') { confirmListenPick(); return; }
    if (state.modalMode === 'balance') {
      const v = parseFloat($('#set-balance')?.value);
      if (!isNaN(v) && v >= 0) { state.userBalance = Math.round(v * 100) / 100; saveData(); updateBalanceUI(); }
      closeModal(); return;
    }
    if (state.modalMode === 'chat-bg') {
      const c = state.contacts.find((x) => x.id === state.currentContactId);
      if (c) { const color = $('#bg-color')?.value; if (color) { c.chatBgColor = color; c.chatBgImg = null; saveData(); if (state.chatContactId === c.id) applyContactChatBg(c.id); } }
      closeModal(); return;
    }
    if (state.modalMode === 'settings') {
      const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c) return;
      let min = parseFloat($('#set-min').value) || 1.5, max = parseFloat($('#set-max').value) || 4, count = parseInt($('#set-count').value, 10) || 2;
      min = Math.max(0.5, Math.min(30, min)); max = Math.max(min, Math.min(60, max)); count = Math.max(1, Math.min(3, count));
      c.settings = { minDelay: min, maxDelay: max, maxReplies: count };
      c.listenConfig = {
        pauseChance: Math.max(0, Math.min(1, parseFloat($('#set-pause-c')?.value) || 0.15)),
        pauseDurationMax: Math.max(1, Math.min(30, parseFloat($('#set-pause-d')?.value) || 5)),
        favoriteChance: Math.max(0, Math.min(1, parseFloat($('#set-fav-c')?.value) || 0.1))
      };
      saveData(); renderCardsPanel(); closeModal(); return;
    }
    const input = $('#modal-input');
    const text = input ? input.value.trim() : '';
    if (!text) { alert('内容不能为空'); return; }
    const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c) return;
    const isInter = state.editingCardType === 'interaction';
    if (!c.interactionCards) c.interactionCards = [];
    const arr = isInter ? c.interactionCards : c.cards;
    if (state.modalMode === 'card-add') arr.push(text);
    else if (state.modalMode === 'card-edit') arr[state.editingCardIndex] = text;
    saveData(); renderCardsPanel(); closeModal();
  }
  function deleteCard(type, index) {
    const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c) return;
    if (!confirm('确定删除？')) return;
    const arr = type === 'interaction' ? c.interactionCards : c.cards;
    arr.splice(index, 1); saveData(); renderCardsPanel();
  }

  function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxSize || h > maxSize) {
            if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
            else { w = Math.round(w * maxSize / h); h = maxSize; }
          }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject; img.src = e.target.result;
      };
      reader.onerror = reject; reader.readAsDataURL(file);
    });
  }
  async function handleImageUpload(file, type) {
    const c = state.contacts.find((x) => x.id === state.currentContactId); if (!c || !file) return;
    try {
      const dataUrl = await compressImage(file, type === 'avatar' ? 200 : 600, 0.65);
      if (type === 'avatar') c.avatarImg = dataUrl;
      else { c.chatBgImg = dataUrl; c.chatBgColor = null; }
      saveData(); renderContactsList(); renderCardsPanel();
      if (state.chatContactId === c.id) enterChat(c.id);
    } catch (e) { alert('图片处理失败'); }
  }

  function updateStats() {
    statContacts.textContent = state.contacts.length;
    const total = state.contacts.reduce((s, c) => s + (c.cards?.length || 0) + (c.interactionCards?.length || 0), 0);
    statCards.textContent = total;
    if (statSongs) statSongs.textContent = state.musicLibrary.length;
  }
  function updateBalanceUI() { if (userBalanceEl) userBalanceEl.textContent = state.userBalance; }

  // ========== Init ==========
  function init() {
    const data = loadData();
    state.contacts = data.contacts;
    state.chats = data.chats;
    state.musicLibrary = data.musicLibrary;
    state.userBalance = data.userBalance;
    state.theme = data.theme;
    applyTheme(state.theme);

    $$('.tab-item').forEach((tab) => tab.addEventListener('click', () => switchPage(tab.dataset.page)));
    btnBack.addEventListener('click', leaveChat);

    let lastTap = 0;
    headerAvatar.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 350) { doPoke(); lastTap = 0; } else lastTap = now;
    });

    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', confirmModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    btnReset.addEventListener('click', resetToDefault);
    btnEditBalance?.addEventListener('click', openBalanceModal);

    themeGrid?.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => { applyTheme(card.dataset.theme); saveData(); updateThemeUI(); });
    });

    fileAvatar.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'avatar'); e.target.value = ''; });
    fileBg.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f, 'bg'); e.target.value = ''; closeModal(); });

    btnSend.addEventListener('click', sendMessage);
    msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    msgInput.addEventListener('input', autoResizeInput);
    btnAttach.addEventListener('click', toggleAttachPanel);
    attachPanel.querySelectorAll('.attach-btn').forEach((btn) => btn.addEventListener('click', () => openMoneyModal(btn.dataset.action)));
    quoteBarClose.addEventListener('click', clearQuote);
    msgActionMenu.querySelector('[data-action="quote"]').addEventListener('click', startQuote);
    document.addEventListener('click', (e) => { if (!msgActionMenu.contains(e.target)) hideMsgMenu(); });

    // Music
    btnImportSong?.addEventListener('click', openImportSongModal);
    btnListenTogether?.addEventListener('click', openListenPicker);

    // Listen page
    listenBack?.addEventListener('click', stopListenSession);
    btnListenPlay?.addEventListener('click', toggleListenPlay);
    btnManualPlay?.addEventListener('click', () => {
      audioEl.play().then(() => {
        btnListenPlay.textContent = '❚❚';
        listenCover.classList.remove('paused');
        btnManualPlay.classList.add('hidden');
      }).catch(() => {});
    });
    listenProgress?.addEventListener('input', () => {
      if (audioEl.duration) audioEl.currentTime = (listenProgress.value / 1000) * audioEl.duration;
    });
    audioEl.addEventListener('timeupdate', () => {
      if (audioEl.duration) {
        listenProgress.value = (audioEl.currentTime / audioEl.duration) * 1000;
        listenCur.textContent = formatSec(audioEl.currentTime);
        listenDur.textContent = formatSec(audioEl.duration);
      }
      updateLrcHighlight();
    });
    audioEl.addEventListener('ended', () => {
      btnListenPlay.textContent = '▶';
      listenCover.classList.add('paused');
    });
    audioEl.addEventListener('loadedmetadata', () => {
      listenDur.textContent = formatSec(audioEl.duration);
    });

    switchPage('chat');
    updateStats(); updateBalanceUI(); updateThemeUI();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
