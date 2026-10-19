/**
 * 字笺 · ZiJian
 * 原生前端 · 字卡库 + localStorage 持久化
 */

(function () {
  'use strict';

  // ========== 数据结构 & 默认数据 ==========
  const STORAGE_KEY = 'zijian_card_library';

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
      ]
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
      ]
    }
  ];

  // ========== 状态 ==========
  let state = {
    contacts: [],
    currentContactId: null,
    editingCardIndex: null // null = 新增, number = 编辑
  };

  // ========== localStorage ==========
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.contacts) && parsed.contacts.length > 0) {
          return parsed.contacts;
        }
      }
    } catch (e) {
      console.warn('读取 localStorage 失败，使用默认数据', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ contacts: state.contacts }));
    } catch (e) {
      console.error('保存 localStorage 失败', e);
    }
  }

  function resetToDefault() {
    if (!confirm('确定要重置为示例数据吗？当前所有字卡将被覆盖。')) return;
    state.contacts = JSON.parse(JSON.stringify(DEFAULT_CONTACTS));
    state.currentContactId = null;
    saveData();
    renderContactsList();
    renderCardsPanel();
    updateStats();
  }

  // ========== DOM 引用 ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pageTitle = $('#page-title');
  const contactsList = $('#contacts-list');
  const cardsPanel = $('#cards-panel');
  const modalOverlay = $('#modal-overlay');
  const modalTitle = $('#modal-title');
  const modalInput = $('#modal-input');
  const modalCancel = $('#modal-cancel');
  const modalConfirm = $('#modal-confirm');
  const btnReset = $('#btn-reset-data');
  const statContacts = $('#stat-contacts');
  const statCards = $('#stat-cards');

  // ========== Tab 切换 ==========
  function switchPage(pageName) {
    $$('.page').forEach((p) => p.classList.remove('active'));
    $$('.tab-item').forEach((t) => t.classList.remove('active'));

    const page = $(`#page-${pageName}`);
    const tab = $(`.tab-item[data-page="${pageName}"]`);
    if (page) page.classList.add('active');
    if (tab) tab.classList.add('active');

    const titles = { chat: '聊天', contacts: '联系人', me: '我' };
    pageTitle.textContent = titles[pageName] || '';

    if (pageName === 'me') updateStats();
    if (pageName === 'contacts') {
      renderContactsList();
      renderCardsPanel();
    }
  }

  // ========== 渲染联系人列表 ==========
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

  // ========== 渲染字卡面板 ==========
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
        <button class="btn-add" id="btn-add-card">+ 添加</button>
      </div>
      <div class="card-list">
        ${cardsHtml || '<div class="empty-state small"><p>暂无字卡，点击上方添加</p></div>'}
      </div>
    `;

    // 绑定事件
    const addBtn = $('#btn-add-card');
    if (addBtn) {
      addBtn.addEventListener('click', () => openModal('add'));
    }

    cardsPanel.querySelectorAll('.card-btn.edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        openModal('edit', idx);
      });
    });

    cardsPanel.querySelectorAll('.card-btn.delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        deleteCard(idx);
      });
    });
  }

  // ========== 字卡 CRUD ==========
  function openModal(mode, index = null) {
    state.editingCardIndex = mode === 'edit' ? index : null;
    modalTitle.textContent = mode === 'edit' ? '编辑字卡' : '添加字卡';

    if (mode === 'edit') {
      const contact = state.contacts.find((c) => c.id === state.currentContactId);
      modalInput.value = contact ? contact.cards[index] : '';
    } else {
      modalInput.value = '';
    }

    modalOverlay.classList.remove('hidden');
    modalInput.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    state.editingCardIndex = null;
  }

  function confirmModal() {
    const text = modalInput.value.trim();
    if (!text) {
      alert('字卡内容不能为空');
      return;
    }

    const contact = state.contacts.find((c) => c.id === state.currentContactId);
    if (!contact) return;

    if (state.editingCardIndex === null) {
      // 新增
      contact.cards.push(text);
    } else {
      // 编辑
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

  // ========== 初始化 ==========
  function init() {
    state.contacts = loadData();

    // Tab 事件
    $$('.tab-item').forEach((tab) => {
      tab.addEventListener('click', () => {
        switchPage(tab.dataset.page);
      });
    });

    // 弹窗事件
    modalCancel.addEventListener('click', closeModal);
    modalConfirm.addEventListener('click', confirmModal);
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });

    // 重置
    btnReset.addEventListener('click', resetToDefault);

    // 初始渲染
    switchPage('chat');
    updateStats();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
