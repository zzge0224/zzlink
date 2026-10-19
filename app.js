/**
 * 字笺 · ZiJian
 * 原生前端 · 聊天模拟 + 字卡库 + localStorage
 */

(function () {
  'use strict';

  // ========== 常量 & 默认数据 ==========
  const STORAGE_KEY = 'zijian_data_v2';

  const DEFAULT_SETTINGS = {
    minDelay: 1.5,   // 秒
    maxDelay: 4,
    maxReplies: 2    // 实际条数 = random(1 ~ maxReplies)
  };

  const DEFAULT_CONTACTS = [
    {
      id: 'c1',
      name: '黎枫',
      avatarColor: '#3D9A62',
      cards: [
        '今日风清，想与你分享一杯热茶。',
        '你说的那句话，我记了很久。',
        '山高水长，字笺传情。',
        '不必急着回复，慢慢想就好。',
        '夜深了，记得早点休息。'
      ],
      settings: { ...DEFAULT_SETTINGS }
    },
    {
      id: 'c2',
      name: '阿澄',
      avatarColor: '#B23A3A',
      cards: [
        '刚写完一页，忽然想起你。',
        '纸笺有限，心意无限。',
        '下次见面，带你去看那片银杏。',
        '你的字卡总是很温柔。',
        '保持联系，别让时间把我们冲淡。'
      ],
      settings: { minDelay: 2, maxDelay: 5, maxReplies: 3 }
    }
  ];

  // ========== 状态 ==========
  let state = {
    contacts: [],
    chats: {},              // { [contactId]: Message[] }
    currentContactId: null, // 联系人页当前选中
    chatContactId: null,    // 聊天页当前对话的联系人
    editingCardIndex: null,
    modalMode: null,        // 'card-add' | 'card-edit' | 'settings'
    pendingTimers: []       // 用于清理 setTimeout
  };

  // ========== localStorage ==========
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.contacts) && parsed.contacts.length > 0) {
          // 兼容旧数据：补全 settings
          parsed.contacts.forEach((c) => {
            if (!c.settings) c.settings = { ...DEFAULT_SETTINGS };
          });
          return {
            contacts: parsed.contacts,
            chats: parsed.chats || {}
          };
        }
      }
    } catch (e) {
      console.warn('读取 localStorage 失败，使用默认数据', e);
    }
    return {
      contacts: JSON.parse(JSON.stringify(DEFAULT_CONTACTS)),
      chats: {}
    };
  }

  function saveData() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          contacts: state.contacts,
          chats: state.chats
        })
      );
    } catch (e) {
      console.error('保存 localStorage 失败', e);
    }
  }

  function resetToDefault() {
    if (!confirm('确定要重置为示例数据吗？当前所有字卡和聊天记录将被清空。')) return;
    clearPendingTimers();
    state.contacts = JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
    state.chats = {};
    state.currentContactId = null;
    state.chatContactId = null;
    saveData();
    renderContactsList();
    renderCardsPanel();
    renderChatList();
    showChatListView();
    updateStats();
  }

  // ========== DOM 引用 ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pageTitle = $('#page-title');
  const btnBack = $('#btn-back');
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

  const chatListView = $('#chat-list-view');
  const chatDetailView = $('#chat-detail-view');
  const chatList = $('#chat-list');
  const chatListEmpty = $('#chat-list-empty');
  const messageList = $('#message-list');
  const msgInput = $('#msg-input');
  const btnSend = $('#btn-send');

  // ========== Tab 切换 ==========
  function switchPage(pageName) {
    $$('.page').forEach((p) => p.classList.remove('active'));
    $$('.tab-item').forEach((t) => t.classList.remove('active'));

    const page = $(`#page-${pageName}`);
    const tab = $(`.tab-item[data-page="${pageName}"]`);
    if (page) page.classList.add('active');
    if (tab) tab.classList.add('active');

    // 重置 header
    btnBack.classList.add('hidden');

    if (pageName === 'chat') {
      if (state.chatContactId) {
        enterChat(state.chatContactId, false);
      } else {
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
    }
  }

  // ========== 聊天列表 ==========
  function renderChatList() {
    const items = state.contacts.map((c) => {
      const msgs = state.chats[c.id] || [];
      const last = msgs.length ? msgs[msgs.length - 1] : null;
      return { contact: c, last };
    });

    // 有消息的排前面
    items.sort((a, b) => {
      const ta = a.last ? a.last.time : 0;
      const tb = b.last ? b.last.time : 0;
      return tb - ta;
    });

    if (items.length === 0) {
      chatList.innerHTML = '';
      chatListEmpty.classList.remove('hidden');
      return;
    }

    chatListEmpty.classList.add('hidden');
    chatList.innerHTML = items
      .map(({ contact, last }) => {
        const preview = last
          ? (last.from === 'user' ? '我: ' : '') + last.text
          : '暂无消息，点击开始聊天';
        const timeStr = last ? formatTime(last.time) : '';
        return `
          <div class="chat-item" data-id="${contact.id}">
            <div class="avatar" style="background:${contact.avatarColor}">${contact.name.charAt(0)}</div>
            <div class="chat-item-info">
              <div class="chat-item-name">${escapeHtml(contact.name)}</div>
              <div class="chat-item-preview">${escapeHtml(preview)}</div>
            </div>
            <div class="chat-item-time">${timeStr}</div>
          </div>
        `;
      })
      .join('');

    chatList.querySelectorAll('.chat-item').forEach((el) => {
      el.addEventListener('click', () => {
        enterChat(el.dataset.id);
      });
    });
  }

  function showChatListView() {
    chatListView.classList.remove('hidden');
    chatDetailView.classList.add('hidden');
    btnBack.classList.add('hidden');
    pageTitle.textContent = '聊天';
  }

  function enterChat(contactId, renderList = true) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) return;

    state.chatContactId = contactId;
    chatListView.classList.add('hidden');
    chatDetailView.classList.remove('hidden');
    btnBack.classList.remove('hidden');
    pageTitle.textContent = contact.name;

    if (!state.chats[contactId]) {
      state.chats[contactId] = [];
    }

    renderMessages();
    msgInput.value = '';
    msgInput.focus();
  }

  function leaveChat() {
    clearPendingTimers();
    // 清理可能存在的 typing 指示
    const typing = messageList.querySelector('.typing-row');
    if (typing) typing.remove();

    state.chatContactId = null;
    showChatListView();
    renderChatList();
  }

  // ========== 消息渲染 ==========
  function renderMessages() {
    const msgs = state.chats[state.chatContactId] || [];
    messageList.innerHTML = msgs
      .map((m) => {
        const cls = m.from === 'user' ? 'user' : 'contact';
        return `
          <div class="msg-row ${cls}">
            <div class="msg-bubble">${escapeHtml(m.text)}</div>
            <div class="msg-time">${formatTime(m.time)}</div>
          </div>
        `;
      })
      .join('');

    // 滚动到底
    requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight;
    });
  }

  function appendMessage(msg, scroll = true) {
    const cls = msg.from === 'user' ? 'user' : 'contact';
    const row = document.createElement('div');
    row.className = `msg-row ${cls}`;
    row.innerHTML = `
      <div class="msg-bubble">${escapeHtml(msg.text)}</div>
      <div class="msg-time">${formatTime(msg.time)}</div>
    `;
    // 移除 typing 指示（如果有）
    const typing = messageList.querySelector('.typing-row');
    if (typing) typing.remove();

    messageList.appendChild(row);
    if (scroll) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  function showTypingIndicator() {
    // 已有则不重复
    if (messageList.querySelector('.typing-row')) return;
    const row = document.createElement('div');
    row.className = 'msg-row contact typing-row';
    row.innerHTML = `
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;
    messageList.appendChild(row);
    messageList.scrollTop = messageList.scrollHeight;
  }

  // ========== 发送 & 回复模拟 ==========
  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text || !state.chatContactId) return;

    const contact = state.contacts.find((c) => c.id === state.chatContactId);
    if (!contact) return;

    // 用户消息
    const userMsg = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      from: 'user',
      text,
      time: Date.now()
    };

    if (!state.chats[state.chatContactId]) {
      state.chats[state.chatContactId] = [];
    }
    state.chats[state.chatContactId].push(userMsg);
    saveData();
    appendMessage(userMsg);
    msgInput.value = '';
    autoResizeInput();

    // 触发回复
    scheduleReplies(contact);
  }

  function scheduleReplies(contact) {
    clearPendingTimers();

    const settings = contact.settings || DEFAULT_SETTINGS;
    const maxR = Math.min(3, Math.max(1, settings.maxReplies || 2));
    const count = Math.floor(Math.random() * maxR) + 1; // 1 ~ maxReplies

    if (!contact.cards || contact.cards.length === 0) {
      // 没有字卡，给一个兜底
      const fallback = {
        id: 'm_' + Date.now(),
        from: 'contact',
        text: '（对方还没有设置字卡）',
        time: Date.now()
      };
      const delay = randomDelay(settings.minDelay, settings.maxDelay) * 1000;
      const t = setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        state.chats[contact.id].push(fallback);
        saveData();
        appendMessage(fallback);
      }, delay);
      state.pendingTimers.push(t);
      return;
    }

    // 随机抽取 count 条（可重复）
    const selected = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * contact.cards.length);
      selected.push(contact.cards[idx]);
    }

    let cumulative = 0;
    selected.forEach((text, i) => {
      const delaySec = randomDelay(settings.minDelay, settings.maxDelay);
      cumulative += delaySec;

      // 显示 typing 指示（第一条和后续都显示）
      const typingDelay = Math.max(0, (cumulative - delaySec / 2) * 1000);
      const tTyping = setTimeout(() => {
        if (state.chatContactId !== contact.id) return;
        showTypingIndicator();
      }, typingDelay);
      state.pendingTimers.push(tTyping);

      const t = setTimeout(() => {
        if (state.chatContactId !== contact.id) return;

        const msg = {
          id: 'm_' + Date.now() + '_' + i,
          from: 'contact',
          text,
          time: Date.now()
        };
        state.chats[contact.id].push(msg);
        saveData();
        appendMessage(msg);
      }, cumulative * 1000);

      state.pendingTimers.push(t);
    });
  }

  function clearPendingTimers() {
    state.pendingTimers.forEach((t) => clearTimeout(t));
    state.pendingTimers = [];
  }

  function randomDelay(min, max) {
    return min + Math.random() * (max - min);
  }

  // ========== 联系人列表（联系人页） ==========
  function renderContactsList() {
    contactsList.innerHTML = '';
    state.contacts.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'contact-item' + (c.id === state.currentContactId ? ' active' : '');
      item.dataset.id = c.id;
      item.innerHTML = `
        <div class="avatar" style="background:${c.avatarColor}">${c.name.charAt(0)}</div>
        <div class="contact-name">${escapeHtml(c.name)}</div>
      `;
      item.addEventListener('click', () => {
        state.currentContactId = c.id;
        renderContactsList();
        renderCardsPanel();
      });
      contactsList.appendChild(item);
    });
  }

  // ========== 字卡面板 ==========
  function renderCardsPanel() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) {
      cardsPanel.innerHTML = `
        <div class="empty-state small">
          <p>选择一位联系人查看字卡库</p>
        </div>
      `;
      return;
    }

    const s = contact.settings || DEFAULT_SETTINGS;
    const cardsHtml = contact.cards
      .map(
        (text, idx) => `
      <div class="card-item" data-index="${idx}">
        <div class="card-text">${escapeHtml(text)}</div>
        <div class="card-actions">
          <button class="card-btn edit" title="编辑" data-index="${idx}">✎</button>
          <button class="card-btn delete" title="删除" data-index="${idx}">✕</button>
        </div>
      </div>
    `
      )
      .join('');

    cardsPanel.innerHTML = `
      <div class="cards-header">
        <h2>${escapeHtml(contact.name)} 的字卡</h2>
        <button class="btn-settings" id="btn-settings">设置</button>
        <button class="btn-add" id="btn-add-card">+ 添加</button>
      </div>
      <div class="settings-summary">
        回复延迟 <strong>${s.minDelay}~${s.maxDelay}s</strong> ·
        每次最多 <strong>${s.maxReplies}</strong> 条
      </div>
      <div class="card-list">
        ${cardsHtml || '<div class="empty-state small"><p>暂无字卡，点击上方添加</p></div>'}
      </div>
    `;

    $('#btn-add-card')?.addEventListener('click', () => openCardModal('add'));
    $('#btn-settings')?.addEventListener('click', () => openSettingsModal());

    cardsPanel.querySelectorAll('.card-btn.edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCardModal('edit', parseInt(btn.dataset.index, 10));
      });
    });

    cardsPanel.querySelectorAll('.card-btn.delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteCard(parseInt(btn.dataset.index, 10));
      });
    });
  }

  // ========== 弹窗：字卡 ==========
  function openCardModal(mode, index = null) {
    state.modalMode = mode === 'edit' ? 'card-edit' : 'card-add';
    state.editingCardIndex = mode === 'edit' ? index : null;
    modalTitle.textContent = mode === 'edit' ? '编辑字卡' : '添加字卡';

    modalBody.innerHTML = `<textarea id="modal-input" placeholder="输入字卡内容..." rows="4"></textarea>`;
    const input = $('#modal-input');

    if (mode === 'edit') {
      const contact = state.contacts.find((c) => c.id === state.currentContactId);
      input.value = contact ? contact.cards[index] : '';
    } else {
      input.value = '';
    }

    modalOverlay.classList.remove('hidden');
    input.focus();
  }

  // ========== 弹窗：回复设置 ==========
  function openSettingsModal() {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;

    state.modalMode = 'settings';
    modalTitle.textContent = '回复设置 · ' + contact.name;

    const s = contact.settings || DEFAULT_SETTINGS;
    modalBody.innerHTML = `
      <div class="form-row">
        <label>最小回复延迟（秒）</label>
        <input type="number" id="set-min" min="0.5" max="30" step="0.5" value="${s.minDelay}" />
      </div>
      <div class="form-row">
        <label>最大回复延迟（秒）</label>
        <input type="number" id="set-max" min="0.5" max="60" step="0.5" value="${s.maxDelay}" />
      </div>
      <div class="form-row">
        <label>每次最多回复条数（1~3）</label>
        <input type="number" id="set-count" min="1" max="3" step="1" value="${s.maxReplies}" />
      </div>
    `;

    modalOverlay.classList.remove('hidden');
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    state.modalMode = null;
    state.editingCardIndex = null;
  }

  function confirmModal() {
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
      saveData();
      renderCardsPanel();
      closeModal();
      return;
    }

    // 字卡增改
    const input = $('#modal-input');
    const text = input ? input.value.trim() : '';
    if (!text) {
      alert('字卡内容不能为空');
      return;
    }

    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;

    if (state.modalMode === 'card-add') {
      contact.cards.push(text);
    } else if (state.modalMode === 'card-edit') {
      contact.cards[state.editingCardIndex] = text;
    }

    saveData();
    renderCardsPanel();
    closeModal();
  }

  function deleteCard(index) {
    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;
    if (!confirm('确定删除这张字卡吗？')) return;

    contact.cards.splice(index, 1);
    saveData();
    renderCardsPanel();
  }

  // ========== 统计 ==========
  function updateStats() {
    statContacts.textContent = state.contacts.length;
    const total = state.contacts.reduce((sum, c) => sum + c.cards.length, 0);
    statCards.textContent = total;
  }

  // ========== 工具 ==========
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');

    if (isToday) return `${hh}:${mm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  }

  function autoResizeInput() {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 100) + 'px';
  }

  // ========== 初始化 ==========
  function init() {
    const data = loadData();
    state.contacts = data.contacts;
    state.chats = data.chats;

    // Tab
    $$('.tab-item').forEach((tab) => {
      tab.addEventListener('click', () => switchPage(tab.dataset.page));
    });

    // 返回
    btnBack.addEventListener('click', leaveChat);

    // 弹窗
    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', confirmModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // 重置
    btnReset.addEventListener('click', resetToDefault);

    // 发送
    btnSend.addEventListener('click', sendMessage);
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    msgInput.addEventListener('input', autoResizeInput);

    // 初始
    switchPage('chat');
    updateStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
