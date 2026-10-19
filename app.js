/**
 * 字笺 · ZiJian
 * 原生前端 · 主题 / 个性化 / 特殊消息 / localStorage
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'zijian_data_v5';

  const DEFAULT_SETTINGS = { minDelay: 1.5, maxDelay: 4, maxReplies: 2 };
  const DEFAULT_INTERACTION = ['轻轻拍了拍', '重重拍了拍', '拍了拍', '戳了戳', '碰了碰'];
  const THEMES = ['classic', 'dark', 'cream', 'lavender'];

  const DEFAULT_CONTACTS = [
    {
      id: 'c1',
      name: '黎枫',
      avatarColor: '#3D9A62',
      avatarImg: null,
      chatBgColor: null,
      chatBgImg: null,
      musicFavorites: [],
      currentMusic: null,
      cards: [
        '今日风清，想与你分享一杯热茶。',
        '你说的那句话，我记了很久。',
        '山高水长，字笺传情。',
        '不必急着回复，慢慢想就好。',
        '夜深了，记得早点休息。'
      ],
      interactionCards: [...DEFAULT_INTERACTION, '回拍了你一下'],
      settings: { ...DEFAULT_SETTINGS }
    },
    {
      id: 'c2',
      name: '阿澄',
      avatarColor: '#B23A3A',
      avatarImg: null,
      chatBgColor: null,
      chatBgImg: null,
      musicFavorites: [],
      currentMusic: null,
      cards: [
        '刚写完一页，忽然想起你。',
        '纸笺有限，心意无限。',
        '下次见面，带你去看那片银杏。',
        '你的字卡总是很温柔。',
        '保持联系，别让时间把我们冲淡。'
      ],
      interactionCards: [...DEFAULT_INTERACTION, '也拍了拍你'],
      settings: { minDelay: 2, maxDelay: 5, maxReplies: 3 }
    }
  ];

  let state = {
    contacts: [],
    chats: {},
    userBalance: 888,
    theme: 'classic',
    currentContactId: null,
    chatContactId: null,
    editingCardIndex: null,
    editingCardType: 'normal',
    modalMode: null,
    pendingTimers: [],
    quotingMsg: null,
    longPressMsg: null,
    uploadTarget: null,
    musicStatusTimer: null
  };

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.contacts) && parsed.contacts.length > 0) {
          parsed.contacts.forEach((c) => {
            if (!c.settings) c.settings = { ...DEFAULT_SETTINGS };
            if (!c.interactionCards) c.interactionCards = [...DEFAULT_INTERACTION];
            if (c.avatarImg === undefined) c.avatarImg = null;
            if (c.chatBgColor === undefined) c.chatBgColor = null;
            if (c.chatBgImg === undefined) c.chatBgImg = null;
            if (!c.musicFavorites) c.musicFavorites = [];
            if (c.currentMusic === undefined) c.currentMusic = null;
          });
          return {
            contacts: parsed.contacts,
            chats: parsed.chats || {},
            userBalance: typeof parsed.userBalance === 'number' ? parsed.userBalance : 888,
            theme: THEMES.includes(parsed.theme) ? parsed.theme : 'classic'
          };
        }
      }
    } catch (e) { console.warn('读取失败', e); }
    return {
      contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)),
      chats: {},
      userBalance: 888,
      theme: 'classic'
    };
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        contacts: state.contacts,
        chats: state.chats,
        userBalance: state.userBalance,
        theme: state.theme
      }));
    } catch (e) {
      console.error('保存失败', e);
      alert('保存失败，图片可能过大，请尝试更小的图片');
    }
  }

  function resetToDefault() {
    if (!confirm('确定重置？所有字卡、聊天记录、主题和个性化设置将恢复默认。')) return;
    clearPendingTimers();
    state.contacts = JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
    state.chats = {};
    state.userBalance = 888;
    state.theme = 'classic';
    state.currentContactId = null;
    state.chatContactId = null;
    state.quotingMsg = null;
    applyTheme('classic');
    saveData();
    renderContactsList();
    renderCardsPanel();
    renderChatList();
    showChatListView();
    updateStats();
    updateBalanceUI();
    updateThemeUI();
  }

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

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
  const musicPanel = $('#music-panel');
  const musicPanelToggle = $('#music-panel-toggle');
  const musicIframe = $('#music-iframe');
  const musicEmpty = $('#music-empty');
  const musicStatusText = $('#music-status-text');
  const musicStatusDot = document.querySelector('.music-status-dot');
  const musicLinkInput = $('#music-link-input');
  const btnMusicLoad = $('#btn-music-load');
  const btnMusicSave = $('#btn-music-save');
  const musicFavSelect = $('#music-fav-select');

  function applyTheme(name) {
    if (!THEMES.includes(name)) name = 'classic';
    state.theme = name;
    app.setAttribute('data-theme', name);
    if (state.chatContactId) applyContactChatBg(state.chatContactId);
  }

  function updateThemeUI() {
    $$('.theme-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.theme === state.theme);
    });
  }

  // ========== 一起听 · 网易云 ==========
  function buildEmbedUrl(type, id) {
    // type: 0=歌单, 2=单曲；height=66 为迷你样式
    const h = type === 0 ? 90 : 66;
    return `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=${h}`;
  }

  function parseNeteaseLink(input) {
    if (!input || typeof input !== 'string') return null;
    let str = input.trim();

    // 清理分享文案中的多余字符
    str = str.replace(/[\u200b-\u200f\ufeff]/g, '');

    // 1) 已经是 outchain 链接
    let m = str.match(/(?:https?:)?\/\/?(?:y\.)?music\.163\.com\/outchain\/player\?([^\s"'<>]+)/i);
    if (m) {
      try {
        const params = new URLSearchParams(m[1]);
        const type = parseInt(params.get('type'), 10);
        const id = params.get('id');
        if (!isNaN(type) && id) {
          return {
            type,
            id,
            embedUrl: buildEmbedUrl(type, id),
            label: type === 0 ? `歌单 ${id}` : `单曲 ${id}`
          };
        }
      } catch (_) {}
    }

    // 2) 歌单链接（优先判断，避免被通用 id 误伤）
    // 支持: music.163.com/playlist?id= / #/playlist?id= / y.music.163.com/m/playlist?id=
    m = str.match(/(?:playlist|歌单)[^\d]{0,20}id[=/:](\d+)/i)
      || str.match(/\/playlist\/(\d+)/i)
      || str.match(/[?&#]id=(\d+)[^\s]*playlist/i);
    if (m) {
      const id = m[1];
      return { type: 0, id, embedUrl: buildEmbedUrl(0, id), label: `歌单 ${id}` };
    }
    if (/playlist/i.test(str)) {
      m = str.match(/[?&#]id=(\d+)/i);
      if (m) {
        const id = m[1];
        return { type: 0, id, embedUrl: buildEmbedUrl(0, id), label: `歌单 ${id}` };
      }
    }

    // 3) 单曲链接
    // 支持: song?id= / #/song?id= / y.music.163.com/m/song?id= / song/123
    m = str.match(/(?:song|单曲)[^\d]{0,20}id[=/:](\d+)/i)
      || str.match(/\/song\/(\d+)/i);
    if (m) {
      const id = m[1];
      return { type: 2, id, embedUrl: buildEmbedUrl(2, id), label: `单曲 ${id}` };
    }
    if (/song|单曲/i.test(str)) {
      m = str.match(/[?&#]id=(\d+)/i);
      if (m) {
        const id = m[1];
        return { type: 2, id, embedUrl: buildEmbedUrl(2, id), label: `单曲 ${id}` };
      }
    }

    // 4) 纯数字 id（默认当单曲）
    m = str.match(/^\s*(\d{5,})\s*$/);
    if (m) {
      const id = m[1];
      return { type: 2, id, embedUrl: buildEmbedUrl(2, id), label: `单曲 ${id}` };
    }

    // 5) 最后兜底：任意 id= 数字（当单曲）
    m = str.match(/[?&#]id=(\d{5,})/i);
    if (m) {
      const id = m[1];
      return { type: 2, id, embedUrl: buildEmbedUrl(2, id), label: `单曲 ${id}` };
    }

    return null;
  }

  function loadMusicForContact(music) {
    if (!music || !music.embedUrl) {
      musicIframe.classList.add('hidden');
      musicEmpty.classList.remove('hidden');
      musicEmpty.textContent = '粘贴网易云链接开始一起听';
      musicIframe.removeAttribute('src');
      stopMusicStatus();
      return;
    }
    musicEmpty.classList.remove('hidden');
    musicEmpty.textContent = '正在加载播放器…';
    musicIframe.classList.add('hidden');

    // 先清空再设置，避免缓存旧页面
    musicIframe.removeAttribute('src');
    // 下一帧再赋值，确保重新加载
    requestAnimationFrame(() => {
      const h = music.type === 0 ? 110 : 86;
      musicIframe.style.height = h + 'px';
      musicIframe.src = music.embedUrl;
      musicIframe.onload = () => {
        musicEmpty.classList.add('hidden');
        musicIframe.classList.remove('hidden');
      };
      // 超时兜底：即使 onload 异常也显示 iframe
      setTimeout(() => {
        musicEmpty.classList.add('hidden');
        musicIframe.classList.remove('hidden');
      }, 2500);
    });
    startMusicStatus();
  }

  function startMusicStatus() {
    stopMusicStatus();
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact) return;
    const phrases = [
      `${contact.name} 正在听…`,
      `${contact.name} 也在听这首`,
      `${contact.name} 点了个赞`,
      `${contact.name} 跟着哼了起来`
    ];
    let i = 0;
    if (musicStatusDot) musicStatusDot.classList.add('active');
    musicStatusText.textContent = phrases[0];
    state.musicStatusTimer = setInterval(() => {
      i = (i + 1) % phrases.length;
      musicStatusText.textContent = phrases[i];
    }, 4000 + Math.random() * 2000);
  }

  function stopMusicStatus() {
    if (state.musicStatusTimer) {
      clearInterval(state.musicStatusTimer);
      state.musicStatusTimer = null;
    }
    if (musicStatusDot) musicStatusDot.classList.remove('active');
    if (musicStatusText) musicStatusText.textContent = '对方未在听';
  }

  function refreshMusicFavSelect() {
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!musicFavSelect) return;
    musicFavSelect.innerHTML = '<option value="">收藏的歌单/单曲</option>';
    if (!contact || !contact.musicFavorites) return;
    contact.musicFavorites.forEach((fav, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = fav.label || `${fav.type === 0 ? '歌单' : '单曲'} ${fav.id}`;
      musicFavSelect.appendChild(opt);
    });
  }

  function saveCurrentMusicToFav() {
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact || !contact.currentMusic) {
      alert('请先加载一首歌或歌单');
      return;
    }
    if (!contact.musicFavorites) contact.musicFavorites = [];
    const exists = contact.musicFavorites.some(
      (f) => f.type === contact.currentMusic.type && f.id === contact.currentMusic.id
    );
    if (exists) {
      alert('已在收藏中');
      return;
    }
    contact.musicFavorites.push({ ...contact.currentMusic });
    saveData();
    refreshMusicFavSelect();
    alert('已收藏');
  }

  function onMusicLoadClick() {
    const raw = musicLinkInput.value;
    const parsed = parseNeteaseLink(raw);
    if (!parsed) {
      alert('无法识别链接。请粘贴网易云单曲或歌单链接\n例如：\nhttps://music.163.com/song?id=xxx\nhttps://music.163.com/playlist?id=xxx\n或直接粘贴纯数字歌曲ID');
      return;
    }
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact) return;
    contact.currentMusic = parsed;
    saveData();
    loadMusicForContact(parsed);
    musicLinkInput.value = '';
    // 控制台便于排查
    console.log('[一起听] 已加载', parsed);
  }

  function onMusicFavSelect() {
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact || !contact.musicFavorites) return;
    const idx = parseInt(musicFavSelect.value, 10);
    if (isNaN(idx) || !contact.musicFavorites[idx]) return;
    const fav = contact.musicFavorites[idx];
    contact.currentMusic = fav;
    saveData();
    loadMusicForContact(fav);
  }

  function switchPage(pageName) {
    $$('.page').forEach((p) => p.classList.remove('active'));
    $$('.tab-item').forEach((t) => t.classList.remove('active'));
    const page = $(`#page-${pageName}`);
    const tab = $(`.tab-item[data-page="${pageName}"]`);
    if (page) page.classList.add('active');
    if (tab) tab.classList.add('active');
    btnBack.classList.add('hidden');
    headerAvatar.classList.add('hidden');
    hideAttachPanel();
    hideMsgMenu();
    if (pageName === 'chat') {
      if (state.chatContactId) enterChat(state.chatContactId);
      else {
        pageTitle.textContent = '聊天';
        showChatListView();
        renderChatList();
      }
    } else if (pageName === 'contacts') {
      pageTitle.textContent = '联系人';
      renderContactsList();
      renderCardsPanel();
    } else if (pageName === 'me') {
      pageTitle.textContent = '我';
      updateStats();
      updateBalanceUI();
      updateThemeUI();
    }
  }

  function getPreviewText(msg) {
    if (!msg) return '暂无消息，点击开始聊天';
    if (msg.type === 'system' || msg.type === 'poke') return msg.text;
    if (msg.type === 'transfer') return `[转账] ${msg.amount} 星币`;
    if (msg.type === 'redpacket') return `[红包] ${msg.note || '恭喜发财'}`;
    return (msg.from === 'user' ? '我: ' : '') + (msg.text || '');
  }

  function renderAvatarEl(contact) {
    if (contact.avatarImg) {
      return `<div class="avatar" style="background-image:url(${contact.avatarImg})"></div>`;
    }
    return `<div class="avatar" style="background:${contact.avatarColor}">${contact.name.charAt(0)}</div>`;
  }

  function renderChatList() {
    const items = state.contacts.map((c) => {
      const msgs = state.chats[c.id] || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return { contact: c, last };
    });
    items.sort((a, b) => (b.last?.time || 0) - (a.last?.time || 0));
    if (items.length === 0) {
      chatList.innerHTML = '';
      chatListEmpty.classList.remove('hidden');
      return;
    }
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
    chatListView.classList.remove('hidden');
    chatDetailView.classList.add('hidden');
    btnBack.classList.add('hidden');
    headerAvatar.classList.add('hidden');
    pageTitle.textContent = '聊天';
    state.quotingMsg = null;
    updateQuoteBar();
    messageList.style.backgroundImage = '';
    messageList.style.backgroundColor = '';
  }

  function applyContactChatBg(contactId) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) return;
    if (contact.chatBgImg) {
      messageList.style.backgroundImage = `url(${contact.chatBgImg})`;
      messageList.style.backgroundColor = '';
    } else if (contact.chatBgColor) {
      messageList.style.backgroundImage = '';
      messageList.style.backgroundColor = contact.chatBgColor;
    } else {
      messageList.style.backgroundImage = '';
      messageList.style.backgroundColor = '';
    }
  }

  function enterChat(contactId) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) return;
    state.chatContactId = contactId;
    chatListView.classList.add('hidden');
    chatDetailView.classList.remove('hidden');
    btnBack.classList.remove('hidden');
    pageTitle.textContent = contact.name;
    headerAvatar.classList.remove('hidden');
    if (contact.avatarImg) {
      headerAvatar.style.backgroundImage = `url(${contact.avatarImg})`;
      headerAvatar.style.backgroundColor = '';
      headerAvatar.textContent = '';
    } else {
      headerAvatar.style.backgroundImage = '';
      headerAvatar.style.background = contact.avatarColor;
      headerAvatar.textContent = contact.name.charAt(0);
    }
    applyContactChatBg(contactId);
    if (!state.chats[contactId]) state.chats[contactId] = [];
    renderMessages();
    msgInput.value = '';
    hideAttachPanel();
    state.quotingMsg = null;
    updateQuoteBar();
    // 一起听
    if (contact.currentMusic) {
      loadMusicForContact(contact.currentMusic);
    } else {
      loadMusicForContact(null);
    }
    refreshMusicFavSelect();
    msgInput.focus();
  }

  function leaveChat() {
    clearPendingTimers();
    stopMusicStatus();
    if (musicIframe) musicIframe.src = '';
    const typing = messageList.querySelector('.typing-row');
    if (typing) typing.remove();
    state.chatContactId = null;
    state.quotingMsg = null;
    showChatListView();
    renderChatList();
  }

  function renderMsgBubble(m) {
    if (m.type === 'system' || m.type === 'poke') {
      return `<div class="msg-system">${escapeHtml(m.text)}</div>`;
    }
    if (m.type === 'transfer') {
      return `<div class="msg-bubble msg-transfer">
        <div class="tf-label">${m.from === 'user' ? '转账给对方' : '收到转账'}</div>
        <div class="tf-amount">${m.amount}<span class="tf-unit">星币</span></div>
        ${m.note ? `<div class="tf-note">${escapeHtml(m.note)}</div>` : ''}
      </div>`;
    }
    if (m.type === 'redpacket') {
      return `<div class="msg-bubble msg-redpacket">
        <div class="rp-icon">🧧</div>
        <div class="rp-body">
          <div class="rp-title">${escapeHtml(m.note || '恭喜发财，大吉大利')}</div>
          <div class="rp-amount">${m.amount} 星币</div>
        </div>
      </div>`;
    }
    let quoteHtml = '';
    if (m.quote) {
      const qFrom = m.quote.from === 'user' ? '我' : (state.contacts.find(c => c.id === state.chatContactId)?.name || '对方');
      const qText = truncate(m.quote.text || getPreviewText(m.quote), 40);
      quoteHtml = `<div class="msg-quote"><div class="msg-quote-from">${escapeHtml(qFrom)}</div><div>${escapeHtml(qText)}</div></div>`;
    }
    return `<div class="msg-bubble">${quoteHtml}${escapeHtml(m.text || '')}</div>`;
  }

  function renderMessages() {
    const msgs = state.chats[state.chatContactId] || [];
    messageList.innerHTML = msgs.map((m) => {
      let cls = m.from;
      if (m.type === 'system' || m.type === 'poke') cls = 'system';
      return `<div class="msg-row ${cls}" data-id="${m.id}">${renderMsgBubble(m)}<div class="msg-time">${formatTime(m.time)}</div></div>`;
    }).join('');
    messageList.querySelectorAll('.msg-row:not(.system)').forEach((row) => bindLongPress(row));
    requestAnimationFrame(() => { messageList.scrollTop = messageList.scrollHeight; });
  }

  function appendMessage(msg) {
    const typing = messageList.querySelector('.typing-row');
    if (typing) typing.remove();
    let cls = msg.from;
    if (msg.type === 'system' || msg.type === 'poke') cls = 'system';
    const row = document.createElement('div');
    row.className = `msg-row ${cls}`;
    row.dataset.id = msg.id;
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
    messageList.appendChild(row);
    messageList.scrollTop = messageList.scrollHeight;
  }

  function bindLongPress(row) {
    let timer = null;
    const start = () => {
      timer = setTimeout(() => {
        const msgId = row.dataset.id;
        const msgs = state.chats[state.chatContactId] || [];
        const msg = msgs.find((m) => m.id === msgId);
        if (msg) showMsgMenu(msg, row);
      }, 500);
    };
    const cancel = () => { if (timer) clearTimeout(timer); };
    row.addEventListener('touchstart', start, { passive: true });
    row.addEventListener('touchend', cancel);
    row.addEventListener('touchmove', cancel);
    row.addEventListener('mousedown', start);
    row.addEventListener('mouseup', cancel);
    row.addEventListener('mouseleave', cancel);
  }

  function showMsgMenu(msg, row) {
    state.longPressMsg = msg;
    const rect = row.getBoundingClientRect();
    msgActionMenu.style.left = Math.min(rect.left + 20, window.innerWidth - 120) + 'px';
    msgActionMenu.style.top = (rect.top - 48) + 'px';
    msgActionMenu.classList.remove('hidden');
  }

  function hideMsgMenu() {
    msgActionMenu.classList.add('hidden');
    state.longPressMsg = null;
  }

  function startQuote() {
    if (!state.longPressMsg) return;
    state.quotingMsg = state.longPressMsg;
    updateQuoteBar();
    hideMsgMenu();
    msgInput.focus();
  }

  function updateQuoteBar() {
    if (state.quotingMsg) {
      quoteBarText.textContent = truncate(state.quotingMsg.text || getPreviewText(state.quotingMsg), 30);
      quoteBar.classList.remove('hidden');
    } else {
      quoteBar.classList.add('hidden');
    }
  }

  function clearQuote() {
    state.quotingMsg = null;
    updateQuoteBar();
  }

  function doPoke() {
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact) return;
    const pokeMsg = { id: genId(), from: 'system', type: 'poke', text: `你拍了拍 ${contact.name}`, time: Date.now() };
    pushMsg(pokeMsg);
    appendMessage(pokeMsg);
    const delay = randomDelay(0.8, 2.2) * 1000;
    const t = setTimeout(() => {
      if (state.chatContactId !== contact.id) return;
      if (Math.random() < 0.7) {
        const actions = contact.interactionCards?.length ? contact.interactionCards : DEFAULT_INTERACTION;
        const action = actions[Math.floor(Math.random() * actions.length)];
        const back = { id: genId(), from: 'system', type: 'poke', text: `${contact.name}${action}你`, time: Date.now() };
        pushMsg(back);
        appendMessage(back);
      }
      scheduleReplies(contact, 1);
    }, delay);
    state.pendingTimers.push(t);
  }

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !state.chatContactId) return;
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact) return;
    const msg = {
      id: genId(), from: 'user',
      type: state.quotingMsg ? 'quote' : 'text',
      text, time: Date.now()
    };
    if (state.quotingMsg) {
      msg.quote = {
        id: state.quotingMsg.id, from: state.quotingMsg.from,
        text: state.quotingMsg.text || getPreviewText(state.quotingMsg),
        type: state.quotingMsg.type
      };
    }
    pushMsg(msg);
    appendMessage(msg);
    msgInput.value = '';
    autoResizeInput();
    clearQuote();
    hideAttachPanel();
    scheduleReplies(contact);
  }

  function openMoneyModal(kind) {
    state.modalMode = kind;
    modalTitle.textContent = kind === 'transfer' ? '转账' : '发红包';
    modalBody.innerHTML = `
      <div class="form-row"><label>金额（星币）</label>
        <input type="number" id="money-amount" min="1" max="99999" step="1" value="8.88" /></div>
      <div class="form-row"><label>备注</label>
        <input type="text" id="money-note" placeholder="${kind === 'redpacket' ? '恭喜发财，大吉大利' : '请输入备注'}" /></div>
      <div class="form-row" style="font-size:12px;color:var(--muted)">当前余额：${state.userBalance} 星币</div>`;
    modalOverlay.classList.remove('hidden');
    hideAttachPanel();
  }

  function confirmMoney() {
    const amount = parseFloat($('#money-amount')?.value) || 0;
    const note = ($('#money-note')?.value || '').trim();
    if (amount <= 0) { alert('请输入有效金额'); return; }
    const kind = state.modalMode;
    const msg = {
      id: genId(), from: 'user', type: kind,
      text: kind === 'transfer' ? `转账 ${amount} 星币` : (note || '恭喜发财'),
      amount, note: note || (kind === 'redpacket' ? '恭喜发财，大吉大利' : ''),
      time: Date.now()
    };
    if (state.userBalance >= amount) {
      state.userBalance = Math.round((state.userBalance - amount) * 100) / 100;
      updateBalanceUI();
    }
    pushMsg(msg);
    appendMessage(msg);
    saveData();
    closeModal();
    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (contact) {
      const t = setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        if (Math.random() < 0.35) {
          const backAmount = Math.round((Math.random() * 20 + 1) * 100) / 100;
          const back = {
            id: genId(), from: 'contact',
            type: Math.random() < 0.5 ? 'transfer' : 'redpacket',
            text: '', amount: backAmount,
            note: Math.random() < 0.5 ? '谢谢' : '回礼', time: Date.now()
          };
          pushMsg(back);
          appendMessage(back);
        } else scheduleReplies(contact, 1);
      }, randomDelay(1.2, 3) * 1000);
      state.pendingTimers.push(t);
    }
  }

  function scheduleReplies(contact, forceCount) {
    clearPendingTimers();
    const settings = contact.settings || DEFAULT_SETTINGS;
    const maxR = Math.min(3, Math.max(1, settings.maxReplies || 2));
    const count = forceCount || (Math.floor(Math.random() * maxR) + 1);
    if (!contact.cards?.length) {
      const fallback = { id: genId(), from: 'contact', type: 'text', text: '（对方还没有设置字卡）', time: Date.now() };
      const t = setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        pushMsg(fallback); appendMessage(fallback);
      }, randomDelay(settings.minDelay, settings.maxDelay) * 1000);
      state.pendingTimers.push(t);
      return;
    }
    const selected = [];
    for (let i = 0; i < count; i++) selected.push(contact.cards[Math.floor(Math.random() * contact.cards.length)]);
    let cumulative = 0;
    selected.forEach((text) => {
      const delaySec = randomDelay(settings.minDelay, settings.maxDelay);
      cumulative += delaySec;
      const typingDelay = Math.max(0, (cumulative - delaySec * 0.6) * 1000);
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        showTypingIndicator();
      }, typingDelay));
      state.pendingTimers.push(setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        const msg = { id: genId(), from: 'contact', type: 'text', text, time: Date.now() };
        pushMsg(msg); appendMessage(msg);
      }, cumulative * 1000));
    });
  }

  function clearPendingTimers() {
    state.pendingTimers.forEach((t) => clearTimeout(t));
    state.pendingTimers = [];
  }

  function pushMsg(msg) {
    if (!state.chats[state.chatContactId]) state.chats[state.chatContactId] = [];
    state.chats[state.chatContactId].push(msg);
    saveData();
  }

  function toggleAttachPanel() {
    if (attachPanel.classList.contains('hidden')) {
      attachPanel.classList.remove('hidden');
      btnAttach.classList.add('active');
    } else hideAttachPanel();
  }
  function hideAttachPanel() {
    attachPanel.classList.add('hidden');
    btnAttach.classList.remove('active');
  }

  function renderContactsList() {
    contactsList.innerHTML = '';
    state.contacts.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'contact-item' + (c.id === state.currentContactId ? ' active' : '');
      item.dataset.id = c.id;
      item.innerHTML = `${renderAvatarEl(c)}<div class="contact-name">${escapeHtml(c.name)}</div>`;
      item.addEventListener('click', () => {
        state.currentContactId = c.id;
        renderContactsList();
        renderCardsPanel();
      });
      contactsList.appendChild(item);
    });
  }

  function renderCardsPanel() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) {
      cardsPanel.innerHTML = `<div class="empty-state small"><p>选择一位联系人查看字卡库</p></div>`;
      return;
    }
    const s = contact.settings || DEFAULT_SETTINGS;
    const normalCards = contact.cards || [];
    const interCards = contact.interactionCards || [];
    const makeCardHtml = (text, idx, type) => `
      <div class="card-item ${type === 'interaction' ? 'interaction' : ''}">
        <div class="card-text">${escapeHtml(text)}</div>
        <div class="card-actions">
          <button class="card-btn edit" data-index="${idx}" data-type="${type}">✎</button>
          <button class="card-btn delete" data-index="${idx}" data-type="${type}">✕</button>
        </div>
      </div>`;
    cardsPanel.innerHTML = `
      <div class="cards-header">
        <h2>${escapeHtml(contact.name)}</h2>
        <button class="btn-settings" id="btn-settings">设置</button>
      </div>
      <div class="settings-summary">
        回复延迟 <strong>${s.minDelay}~${s.maxDelay}s</strong> · 每次最多 <strong>${s.maxReplies}</strong> 条
      </div>
      <div class="contact-custom-bar">
        <button class="btn-custom" id="btn-set-avatar">更换头像</button>
        <button class="btn-custom" id="btn-set-bg">聊天背景</button>
        <button class="btn-custom" id="btn-clear-custom">清除个性化</button>
      </div>
      <div class="section-title">普通字卡 <button class="btn-add" id="btn-add-card" style="margin-left:8px">+ 添加</button></div>
      <div class="card-list">
        ${normalCards.map((t, i) => makeCardHtml(t, i, 'normal')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}
      </div>
      <div class="section-title">互动字卡（拍一拍） <button class="btn-add" id="btn-add-inter" style="margin-left:8px">+ 添加</button></div>
      <div class="card-list">
        ${interCards.map((t, i) => makeCardHtml(t, i, 'interaction')).join('') || '<div class="empty-state small"><p>暂无</p></div>'}
      </div>
      <div class="section-title">一起听 · 收藏</div>
      <div class="music-fav-list" id="contact-music-favs">
        ${(contact.musicFavorites || []).map((fav, i) => `
          <div class="music-fav-item" data-idx="${i}">
            <span class="fav-type">${fav.type === 0 ? '歌单' : '单曲'}</span>
            <span class="fav-id">${escapeHtml(fav.label || fav.id)}</span>
            <button class="fav-del" data-idx="${i}">✕</button>
          </div>`).join('') || '<div class="empty-state small"><p>暂无收藏，在聊天页「一起听」中添加</p></div>'}
      </div>`;
    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add', 'normal'));
    $('#btn-add-inter')?.addEventListener('click', () => openCardModal('add', 'interaction'));
    $('#btn-settings')?.addEventListener('click', openSettingsModal);
    $('#btn-set-avatar')?.addEventListener('click', () => { state.uploadTarget = 'avatar'; fileAvatar.click(); });
    $('#btn-set-bg')?.addEventListener('click', openBgModal);
    $('#btn-clear-custom')?.addEventListener('click', () => {
      if (!confirm('清除该联系人的自定义头像和背景？')) return;
      contact.avatarImg = null;
      contact.chatBgColor = null;
      contact.chatBgImg = null;
      saveData();
      renderContactsList();
      renderCardsPanel();
      if (state.chatContactId === contact.id) {
        applyContactChatBg(contact.id);
        enterChat(contact.id);
      }
    });
    cardsPanel.querySelectorAll('.fav-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        if (!contact.musicFavorites) return;
        contact.musicFavorites.splice(idx, 1);
        saveData();
        renderCardsPanel();
      });
    });
    cardsPanel.querySelectorAll('.card-btn.edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCardModal('edit', btn.dataset.type, parseInt(btn.dataset.index, 10));
      });
    });
    cardsPanel.querySelectorAll('.card-btn.delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCard(btn.dataset.type, parseInt(btn.dataset.index, 10));
      });
    });
  }

  function compressImage(file, maxSize = 400, quality = 0.7) {
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
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleImageUpload(file, type) {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact || !file) return;
    try {
      const dataUrl = await compressImage(file, type === 'avatar' ? 200 : 600, 0.65);
      if (type === 'avatar') contact.avatarImg = dataUrl;
      else {
        contact.chatBgImg = dataUrl;
        contact.chatBgColor = null;
      }
      saveData();
      renderContactsList();
      renderCardsPanel();
      if (state.chatContactId === contact.id) enterChat(contact.id);
    } catch (e) {
      alert('图片处理失败');
    }
  }

  function openBgModal() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;
    state.modalMode = 'chat-bg';
    modalTitle.textContent = '聊天背景 · ' + contact.name;
    modalBody.innerHTML = `
      <div class="form-row"><label>背景颜色</label>
        <input type="color" id="bg-color" value="${contact.chatBgColor || '#141311'}" /></div>
      <div class="form-row">
        <button class="btn-primary" id="btn-pick-bg-img" style="width:100%">上传背景图片</button>
      </div>
      <div class="form-row" style="font-size:12px;color:var(--muted)">图片会自动压缩后保存到本地</div>`;
    modalOverlay.classList.remove('hidden');
    $('#btn-pick-bg-img')?.addEventListener('click', () => {
      state.uploadTarget = 'bg';
      fileBg.click();
    });
  }

  function openCardModal(mode, type, index = null) {
    state.modalMode = mode === 'edit' ? 'card-edit' : 'card-add';
    state.editingCardType = type;
    state.editingCardIndex = mode === 'edit' ? index : null;
    modalTitle.textContent = (mode === 'edit' ? '编辑' : '添加') + (type === 'interaction' ? '互动字卡' : '字卡');
    modalBody.innerHTML = `<textarea id="modal-input" placeholder="输入内容..." rows="3"></textarea>`;
    const input = $('#modal-input');
    if (mode === 'edit') {
      const contact = state.contacts.find((c) => c.id === state.currentContactId);
      const arr = type === 'interaction' ? contact.interactionCards : contact.cards;
      input.value = arr ? arr[index] : '';
    }
    modalOverlay.classList.remove('hidden');
    input.focus();
  }

  function openSettingsModal() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;
    state.modalMode = 'settings';
    modalTitle.textContent = '回复设置 · ' + contact.name;
    const s = contact.settings || DEFAULT_SETTINGS;
    modalBody.innerHTML = `
      <div class="form-row"><label>最小回复延迟（秒）</label>
        <input type="number" id="set-min" min="0.5" max="30" step="0.5" value="${s.minDelay}" /></div>
      <div class="form-row"><label>最大回复延迟（秒）</label>
        <input type="number" id="set-max" min="0.5" max="60" step="0.5" value="${s.maxDelay}" /></div>
      <div class="form-row"><label>每次最多回复条数（1~3）</label>
        <input type="number" id="set-count" min="1" max="3" step="1" value="${s.maxReplies}" /></div>`;
    modalOverlay.classList.remove('hidden');
  }

  function openBalanceModal() {
    state.modalMode = 'balance';
    modalTitle.textContent = '修改星币余额';
    modalBody.innerHTML = `
      <div class="form-row"><label>星币数量</label>
        <input type="number" id="set-balance" min="0" max="999999" step="1" value="${state.userBalance}" /></div>`;
    modalOverlay.classList.remove('hidden');
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    state.modalMode = null;
    state.editingCardIndex = null;
  }

  function confirmModal() {
    if (state.modalMode === 'transfer' || state.modalMode === 'redpacket') { confirmMoney(); return; }
    if (state.modalMode === 'balance') {
      const v = parseFloat($('#set-balance')?.value);
      if (!isNaN(v) && v >= 0) {
        state.userBalance = Math.round(v * 100) / 100;
        saveData(); updateBalanceUI();
      }
      closeModal(); return;
    }
    if (state.modalMode === 'chat-bg') {
      const contact = state.contacts.find((c) => c.id === state.currentContactId);
      if (contact) {
        const color = $('#bg-color')?.value;
        if (color) {
          contact.chatBgColor = color;
          contact.chatBgImg = null;
          saveData();
          if (state.chatContactId === contact.id) applyContactChatBg(contact.id);
        }
      }
      closeModal(); return;
    }
    if (state.modalMode === 'settings') {
      const contact = state.contacts.find((c) => c.id === state.currentContactId);
      if (!contact) return;
      let min = parseFloat($('#set-min').value) || 1.5;
      let max = parseFloat($('#set-max').value) || 4;
      let count = parseInt($('#set-count').value, 10) || 2;
      min = Math.max(0.5, Math.min(30, min));
      max = Math.max(min, Math.min(60, max));
      count = Math.max(1, Math.min(3, count));
      contact.settings = { minDelay: min, maxDelay: max, maxReplies: count };
      saveData(); renderCardsPanel(); closeModal(); return;
    }
    const input = $('#modal-input');
    const text = input ? input.value.trim() : '';
    if (!text) { alert('内容不能为空'); return; }
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;
    const isInter = state.editingCardType === 'interaction';
    if (!contact.interactionCards) contact.interactionCards = [];
    const arr = isInter ? contact.interactionCards : contact.cards;
    if (state.modalMode === 'card-add') arr.push(text);
    else if (state.modalMode === 'card-edit') arr[state.editingCardIndex] = text;
    saveData(); renderCardsPanel(); closeModal();
  }

  function deleteCard(type, index) {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;
    if (!confirm('确定删除？')) return;
    const arr = type === 'interaction' ? contact.interactionCards : contact.cards;
    arr.splice(index, 1);
    saveData(); renderCardsPanel();
  }

  function updateStats() {
    statContacts.textContent = state.contacts.length;
    const total = state.contacts.reduce((sum, c) => sum + (c.cards?.length || 0) + (c.interactionCards?.length || 0), 0);
    statCards.textContent = total;
  }
  function updateBalanceUI() {
    if (userBalanceEl) userBalanceEl.textContent = state.userBalance;
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }
  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    if (isToday) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }
  function randomDelay(min, max) { return min + Math.random() * (max - min); }
  function genId() { return 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }
  function autoResizeInput() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px';
  }

  function init() {
    const data = loadData();
    state.contacts = data.contacts;
    state.chats = data.chats;
    state.userBalance = data.userBalance;
    state.theme = data.theme;
    applyTheme(state.theme);

    $$('.tab-item').forEach((tab) => {
      tab.addEventListener('click', () => switchPage(tab.dataset.page));
    });
    btnBack.addEventListener('click', leaveChat);

    let lastTap = 0;
    headerAvatar.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTap < 350) { doPoke(); lastTap = 0; }
      else lastTap = now;
    });

    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', confirmModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    btnReset.addEventListener('click', resetToDefault);
    btnEditBalance?.addEventListener('click', openBalanceModal);

    themeGrid?.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        applyTheme(card.dataset.theme);
        saveData();
        updateThemeUI();
      });
    });

    fileAvatar.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageUpload(file, 'avatar');
      e.target.value = '';
    });
    fileBg.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleImageUpload(file, 'bg');
      e.target.value = '';
      closeModal();
    });

    btnSend.addEventListener('click', sendMessage);
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    msgInput.addEventListener('input', autoResizeInput);
    btnAttach.addEventListener('click', toggleAttachPanel);
    attachPanel.querySelectorAll('.attach-btn').forEach((btn) => {
      btn.addEventListener('click', () => openMoneyModal(btn.dataset.action));
    });
    quoteBarClose.addEventListener('click', clearQuote);
    msgActionMenu.querySelector('[data-action="quote"]').addEventListener('click', startQuote);
    document.addEventListener('click', (e) => {
      if (!msgActionMenu.contains(e.target)) hideMsgMenu();
    });

    // 一起听
    musicPanelToggle?.addEventListener('click', () => {
      musicPanel?.classList.toggle('collapsed');
    });
    btnMusicLoad?.addEventListener('click', onMusicLoadClick);
    musicLinkInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onMusicLoadClick(); }
    });
    btnMusicSave?.addEventListener('click', saveCurrentMusicToFav);
    musicFavSelect?.addEventListener('change', onMusicFavSelect);

    switchPage('chat');
    updateStats();
    updateBalanceUI();
    updateThemeUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
