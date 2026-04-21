/* =========================================================
   SSAINDA Partners Portal — App Logic
   ========================================================= */
(function () {
  'use strict';

  /* ------------------------ State ------------------------ */
  const SESSION_KEY = 'ssainda.portal.session';
  const db = window.__db; // Firestore instance (set in portal.html)

  const state = {
    partner: null,
    currentView: 'home',
    notices: [],
    library: { categories: [], files: [] },
    libraryFilter: { category: 'all', query: '' },
    missions: [],
    products: []
  };

  /* ------------------------ Utils ------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  /* ---- Firestore helpers ---- */
  async function findPartnerByEmail(email) {
    const norm = String(email || '').trim().toLowerCase();
    if (!norm || !db) return null;
    const snap = await db.collection('partners')
      .where('email', '==', norm)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return Object.assign({ id: doc.id }, doc.data());
  }

  async function isEmailTaken(email) {
    const p = await findPartnerByEmail(email);
    return !!p;
  }

  async function nextPartnerCode() {
    // Find highest existing code, increment. Starts at 001.
    if (!db) return '001';
    const snap = await db.collection('partners').orderBy('code', 'desc').limit(1).get();
    if (snap.empty) return '001';
    const max = Number(String(snap.docs[0].data().code || '0').replace(/\D/g, '')) || 0;
    return String(max + 1).padStart(3, '0');
  }

  async function createPartner({ name, email, phone, pin }) {
    const code = await nextPartnerCode();
    const doc = {
      code,
      name,
      email: String(email).toLowerCase(),
      phone,
      pin,
      status: 'active',
      shopUrl: 'https://ssainda.kr',
      signupUrl: 'https://ssainda.kr/signup?ref=' + code,
      kakaoUrl: '',
      addedAt: new Date().toISOString().slice(0, 10),
      source: 'portal-signup'
    };
    await db.collection('partners').doc(code).set(doc);
    return doc;
  }

  function verifyPin(partner, pin) {
    const expected = String(partner?.pin ?? '').trim();
    const given = String(pin || '').trim();
    if (!expected) return false;
    return expected === given;
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  function saveSession(partner) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(partner));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function showToast(msg, icon = 'check-circle') {
    const toast = $('#toast');
    const msgEl = $('#toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    const iconEl = toast.querySelector('[data-lucide]');
    if (iconEl && icon) {
      iconEl.setAttribute('data-lucide', icon);
      renderIcons();
    }
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-show'));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('is-show');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 2200);
  }

  function formatNumber(n) {
    const val = Number(n);
    if (!isFinite(val)) return String(n);
    return val.toLocaleString('ko-KR');
  }

  function initials(name) {
    if (!name) return 'P';
    const trimmed = String(name).trim();
    return trimmed.charAt(0).toUpperCase();
  }

  /* ------------------------ Auth (login + signup) ------------------------ */
  function switchAuthMode(mode) {
    const validModes = ['login', 'signup'];
    if (!validModes.includes(mode)) mode = 'login';
    document.querySelectorAll('.auth-tab').forEach((t) =>
      t.classList.toggle('is-active', t.dataset.auth === mode)
    );
    document.querySelectorAll('.auth-panel').forEach((p) =>
      p.classList.toggle('is-active', p.dataset.authPanel === mode)
    );
  }

  function attachAuthTabs() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-auth]');
      if (tab) {
        e.preventDefault();
        switchAuthMode(tab.dataset.auth);
        return;
      }
      const switcher = e.target.closest('[data-auth-switch]');
      if (switcher) {
        e.preventDefault();
        switchAuthMode(switcher.dataset.authSwitch);
      }
    });
  }

  function setFormLoading(btn, loading, textIdle) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.original = btn.innerHTML;
      btn.innerHTML = '<i data-lucide="loader"></i> <span>처리 중...</span>';
      renderIcons();
    } else {
      btn.disabled = false;
      if (btn.dataset.original) {
        btn.innerHTML = btn.dataset.original;
        renderIcons();
      }
    }
  }

  function attachLoginHandlers() {
    const form = $('#login-form');
    const emailInput = $('#login-email');
    const pinInput = $('#login-pin');
    const errEl = $('#login-error');
    const submitBtn = $('#login-submit');

    if (!form) return;

    pinInput.addEventListener('input', () => {
      pinInput.value = pinInput.value.replace(/\D+/g, '').slice(0, 4);
      if (errEl.textContent) errEl.textContent = '';
    });
    emailInput.addEventListener('input', () => {
      if (errEl.textContent) errEl.textContent = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const pin = pinInput.value.trim();

      if (!email) { errEl.textContent = '이메일 주소를 입력해주세요.'; emailInput.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = '올바른 이메일 형식이 아닙니다.'; emailInput.focus(); return;
      }
      if (!/^[0-9]{4}$/.test(pin)) {
        errEl.textContent = 'PIN 4자리를 정확히 입력해주세요.'; pinInput.focus(); return;
      }

      setFormLoading(submitBtn, true);
      try {
        const partner = await findPartnerByEmail(email);
        if (!partner) {
          errEl.textContent = '등록되지 않은 이메일입니다. 회원가입을 먼저 진행해주세요.';
          emailInput.focus();
          return;
        }
        if (partner.status && partner.status !== 'active') {
          errEl.textContent = '현재 비활성 상태의 계정입니다. 본사에 문의해주세요.';
          return;
        }
        if (!verifyPin(partner, pin)) {
          errEl.textContent = 'PIN이 일치하지 않습니다.';
          pinInput.focus(); pinInput.select();
          return;
        }
        loginAs(partner);
      } catch (err) {
        console.error('login error:', err);
        errEl.textContent = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      } finally {
        setFormLoading(submitBtn, false);
      }
    });
  }

  function attachSignupHandlers() {
    const form = $('#signup-form');
    const nameInput = $('#signup-name');
    const emailInput = $('#signup-email');
    const phoneInput = $('#signup-phone');
    const pinInput = $('#signup-pin');
    const pin2Input = $('#signup-pin2');
    const errEl = $('#signup-error');
    const submitBtn = $('#signup-submit');

    if (!form) return;

    [pinInput, pin2Input].forEach((el) =>
      el.addEventListener('input', () => {
        el.value = el.value.replace(/\D+/g, '').slice(0, 4);
        if (errEl.textContent) errEl.textContent = '';
      })
    );
    [nameInput, emailInput, phoneInput].forEach((el) =>
      el.addEventListener('input', () => {
        if (errEl.textContent) errEl.textContent = '';
      })
    );
    phoneInput.addEventListener('input', () => {
      // Auto-format 010-xxxx-xxxx
      const digits = phoneInput.value.replace(/\D/g, '').slice(0, 11);
      if (digits.length >= 11) {
        phoneInput.value = digits.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
      } else if (digits.length >= 7) {
        phoneInput.value = digits.replace(/(\d{3})(\d{3,4})(\d*)/, (_, a, b, c) => c ? `${a}-${b}-${c}` : `${a}-${b}`);
      } else {
        phoneInput.value = digits;
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const email = emailInput.value.trim().toLowerCase();
      const phone = phoneInput.value.trim();
      const pin = pinInput.value.trim();
      const pin2 = pin2Input.value.trim();

      if (!name) { errEl.textContent = '이름을 입력해주세요.'; nameInput.focus(); return; }
      if (!email) { errEl.textContent = '이메일을 입력해주세요.'; emailInput.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = '올바른 이메일 형식이 아닙니다.'; emailInput.focus(); return;
      }
      if (!phone) { errEl.textContent = '연락처를 입력해주세요.'; phoneInput.focus(); return; }
      if (!/^[0-9]{4}$/.test(pin)) {
        errEl.textContent = 'PIN 4자리 숫자를 입력해주세요.'; pinInput.focus(); return;
      }
      if (pin !== pin2) {
        errEl.textContent = 'PIN이 일치하지 않습니다.'; pin2Input.focus(); pin2Input.select(); return;
      }

      setFormLoading(submitBtn, true);
      try {
        if (await isEmailTaken(email)) {
          errEl.textContent = '이미 가입된 이메일입니다. 로그인 탭으로 이동하세요.';
          return;
        }
        const partner = await createPartner({ name, email, phone, pin });
        showToast(`가입 완료! ${name}님, 환영합니다 🎉`, 'sparkles');
        loginAs(partner);
      } catch (err) {
        console.error('signup error:', err);
        errEl.textContent = '가입 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      } finally {
        setFormLoading(submitBtn, false);
      }
    });
  }

  function loginAs(partner) {
    state.partner = partner;
    saveSession(partner);
    showApp();
    showToast(`${partner.name || '파트너'}님, 환영합니다`);
  }

  function logout() {
    clearSession();
    state.partner = null;
    // reset UI
    $('#app').hidden = true;
    $('#login-screen').hidden = false;
    document.body.style.overflow = '';
    ['login-email','login-pin','signup-name','signup-email','signup-phone','signup-pin','signup-pin2'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const le = $('#login-error'); if (le) le.textContent = '';
    const se = $('#signup-error'); if (se) se.textContent = '';
    switchAuthMode('login');
  }

  /* ------------------------ App init ------------------------ */
  function showApp() {
    const loginScreen = $('#login-screen');
    const app = $('#app');
    if (loginScreen) loginScreen.hidden = true;
    if (app) app.hidden = false;

    paintPartnerProfile();
    // Initial view from hash or default 'home'
    const fromHash = (location.hash || '#home').replace('#', '');
    navigate(fromHash, { silent: true });
    runCountUps();
    renderIcons();
  }

  function paintPartnerProfile() {
    const p = state.partner || {};
    const name = p.name || '파트너';
    const email = p.email || '';
    const code = p.code ? String(p.code).padStart(3, '0') : '';
    const sub = email || (code ? `파트너 코드 ${code}` : '');
    $('#sidebar-partner-name').textContent = name + ' 님';
    $('#sidebar-partner-code').textContent = sub;
    $('#topbar-partner-name').textContent = name;
    $('#topbar-partner-grade').textContent = p.grade || 'PN · Partner';
    $('#sidebar-avatar').textContent = initials(name);
    $('#topbar-avatar').textContent = initials(name);
    const greeting = $('#hero-greeting');
    if (greeting) greeting.textContent = `안녕하세요, ${name}님`;
  }

  /* ------------------------ Navigation ------------------------ */
  function navigate(view, opts = {}) {
    const valid = ['home', 'intro', 'library', 'mission', 'report', 'products', 'notices'];
    if (!valid.includes(view)) view = 'home';

    state.currentView = view;

    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
    $$('.nav-item').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === view));

    if (!opts.silent) {
      history.replaceState(null, '', '#' + view);
    }

    // Close mobile sidebar after navigating
    closeSidebar();

    // Scroll content to top
    const content = $('#content');
    if (content) content.scrollTo({ top: 0, behavior: 'smooth' });

    // Re-run count-ups when entering views that include data metrics
    if (view === 'home' || view === 'report') runCountUps();
  }

  function attachNavHandlers() {
    // Any element with [data-nav]
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-nav]');
      if (!el) return;
      const view = el.dataset.nav;
      if (!view) return;
      e.preventDefault();
      navigate(view);
    });

    window.addEventListener('hashchange', () => {
      const view = location.hash.replace('#', '') || 'home';
      navigate(view, { silent: true });
    });

    // Logout
    const logoutBtn = $('#logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => {
      if (confirm('로그아웃 하시겠습니까?')) logout();
    });
  }

  /* ------------------------ Sidebar (mobile) ------------------------ */
  function openSidebar() {
    $('#sidebar')?.classList.add('is-open');
    const bd = $('.sidebar-backdrop');
    if (bd) {
      bd.hidden = false;
      requestAnimationFrame(() => bd.classList.add('is-show'));
    }
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    $('#sidebar')?.classList.remove('is-open');
    const bd = $('.sidebar-backdrop');
    if (bd) {
      bd.classList.remove('is-show');
      setTimeout(() => { bd.hidden = true; }, 200);
    }
    document.body.style.overflow = '';
  }
  function attachSidebarHandlers() {
    $$('[data-sidebar-open]').forEach((b) => b.addEventListener('click', openSidebar));
    $$('[data-sidebar-close]').forEach((b) => b.addEventListener('click', closeSidebar));
  }

  /* ------------------------ Count-up ------------------------ */
  function runCountUps() {
    $$('.view.is-active .num[data-count]').forEach((el) => {
      if (el.dataset.counted === '1') return;
      const target = Number(el.dataset.count);
      if (!isFinite(target)) return;
      const duration = 900;
      const start = performance.now();
      const startVal = 0;
      el.dataset.counted = '1';
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const cur = Math.round(startVal + (target - startVal) * eased);
        el.textContent = formatNumber(cur);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* ------------------------ Notices ------------------------ */
  async function loadNotices() {
    try {
      const res = await fetch('data/notices.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.notices = Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('공지를 불러오지 못했습니다:', err);
      state.notices = [];
    }
    renderNotices('all');
    renderHomeNotices();
    updateNoticeBadge();
  }

  function sortNotices(list) {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.date).localeCompare(String(a.date));
    });
  }

  function renderNotices(filter) {
    const list = $('#notice-list');
    if (!list) return;
    const items = sortNotices(
      filter === 'all'
        ? state.notices
        : state.notices.filter((n) => n.category === filter)
    );
    if (!items.length) {
      list.innerHTML = '<li class="empty">해당 카테고리의 공지가 없습니다.</li>';
      return;
    }
    list.innerHTML = items.map(renderNoticeItem).join('');
    renderIcons();

    // Expand/collapse
    $$('#notice-list .notice-item').forEach((li) => {
      li.addEventListener('click', () => li.classList.toggle('is-open'));
    });
  }

  function renderHomeNotices() {
    const list = $('#home-notice-list');
    if (!list) return;
    const items = sortNotices(state.notices).slice(0, 4);
    if (!items.length) {
      list.innerHTML = '<li class="empty">등록된 공지가 없습니다.</li>';
      return;
    }
    list.innerHTML = items.map(renderNoticeItem).join('');
    renderIcons();
    $$('#home-notice-list .notice-item').forEach((li) => {
      li.addEventListener('click', (e) => {
        // Clicking home preview jumps to full notices view, opens that item
        const id = li.dataset.id;
        navigate('notices');
        setTimeout(() => {
          const target = $(`#notice-list .notice-item[data-id="${id}"]`);
          if (target) {
            target.classList.add('is-open');
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 80);
      });
    });
  }

  function renderNoticeItem(n) {
    const pin = n.pinned
      ? `<span class="notice-pin"><i data-lucide="pin"></i> PIN</span>`
      : '';
    const body = (n.content || '').replace(/</g, '&lt;');
    return `
      <li class="notice-item" data-id="${n.id}">
        <div class="notice-head">
          ${pin}
          <span class="notice-tag" data-cat="${n.category || ''}">${n.category || '공지'}</span>
          <span class="notice-title">${(n.title || '').replace(/</g, '&lt;')}</span>
          <span class="notice-date">${n.date || ''}</span>
          <i class="chev" data-lucide="chevron-down"></i>
        </div>
        <div class="notice-body">${body}</div>
      </li>`;
  }

  function updateNoticeBadge() {
    const count = state.notices.length;
    const badge = $('#notice-count');
    const dot = $('#notice-dot');
    if (badge) {
      if (count > 0) { badge.hidden = false; badge.textContent = count > 99 ? '99+' : count; }
      else badge.hidden = true;
    }
    if (dot) dot.hidden = !state.notices.some((n) => n.pinned);
  }

  function attachNoticeFilters() {
    const bar = $('#notice-filter');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      $$('.chip', bar).forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderNotices(chip.dataset.filter);
    });
  }

  /* ------------------------ Library ------------------------ */
  const FILE_ICON = {
    txt: 'file-text',
    md: 'file-text',
    docx: 'file-text',
    pdf: 'file-text',
    mp4: 'film',
    mov: 'film',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    zip: 'archive',
    csv: 'table',
    xlsx: 'table'
  };
  const FILE_TONE = {
    txt: 'tone-gold', md: 'tone-gold', docx: 'tone-gold', pdf: 'tone-gold',
    mp4: 'tone-blue', mov: 'tone-blue',
    png: 'tone-green', jpg: 'tone-green', jpeg: 'tone-green',
    zip: 'tone-navy', csv: 'tone-navy', xlsx: 'tone-navy'
  };

  async function loadLibrary() {
    try {
      const res = await fetch('data/library.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.library.categories = Array.isArray(data.categories) ? data.categories : [];
      state.library.files = Array.isArray(data.files) ? data.files : [];
    } catch (err) {
      console.warn('자료실을 불러오지 못했습니다:', err);
    }
    renderLibraryTabs();
    renderLibraryGrid();
  }

  function renderLibraryTabs() {
    const tabs = $('#library-tabs');
    if (!tabs) return;
    const all = `<button class="tab is-active" data-cat="all">전체</button>`;
    const cats = state.library.categories.map((c) =>
      `<button class="tab" data-cat="${c.id}">${c.label}</button>`
    ).join('');
    tabs.innerHTML = all + cats;
    tabs.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.libraryFilter.category = btn.dataset.cat;
        renderLibraryGrid();
      });
    });
  }

  function renderLibraryGrid() {
    const grid = $('#library-grid');
    const empty = $('#library-empty');
    if (!grid) return;

    const { category, query } = state.libraryFilter;
    const q = query.trim().toLowerCase();
    const items = state.library.files.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (q && !(f.title + ' ' + (f.description || '')).toLowerCase().includes(q)) return false;
      return true;
    });

    if (!items.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    grid.innerHTML = items.map(renderFileCard).join('');
    renderIcons();
  }

  function renderFileCard(f) {
    const type = (f.type || '').toLowerCase();
    const icon = FILE_ICON[type] || 'file';
    const tone = FILE_TONE[type] || 'tone-navy';
    const href = `downloads/${f.filename}`;
    const mission = f.mission ? `<span class="file-tag">${f.mission}</span>` : '';
    const size = f.size ? `<span>${f.size}</span>` : '';
    const date = f.date ? `<span>${f.date}</span>` : '';
    return `
      <div class="card file-card">
        <div class="file-card-head">
          <span class="icon-bubble ${tone}"><i data-lucide="${icon}"></i></span>
          ${mission}
        </div>
        <strong>${escapeHtml(f.title)}</strong>
        <p>${escapeHtml(f.description || '')}</p>
        <div class="file-meta-row">
          <span class="file-type">.${type}</span>
          ${size}
          ${date}
        </div>
        <a class="btn btn-primary btn-block" href="${href}" download>
          <i data-lucide="download"></i> 다운로드
        </a>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attachLibrarySearch() {
    const input = $('#library-search-input');
    if (!input) return;
    input.addEventListener('input', () => {
      state.libraryFilter.query = input.value;
      renderLibraryGrid();
    });
  }

  /* ------------------------ Missions ------------------------ */
  const MISSION_KEY = 'ssainda.portal.missions.progress';

  function loadMissionProgress() {
    try {
      const raw = localStorage.getItem(MISSION_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch { return {}; }
  }
  function saveMissionProgress(progress) {
    localStorage.setItem(MISSION_KEY, JSON.stringify(progress));
  }

  async function loadMissions() {
    try {
      const res = await fetch('data/missions.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.missions = await res.json();
    } catch (err) {
      console.warn('미션을 불러오지 못했습니다:', err);
      state.missions = [];
    }
    renderMissions();
  }

  function renderMissions() {
    const grid = $('#mission-grid');
    if (!grid) return;
    const progress = loadMissionProgress();
    const total = state.missions.length;

    // Figure out which mission is current: first incomplete one
    let currentIdx = state.missions.findIndex((m) => !(progress[m.id] && progress[m.id].done));
    if (currentIdx === -1) currentIdx = total; // all done

    grid.innerHTML = state.missions.map((m, idx) => {
      const p = progress[m.id] || { checked: [], done: false };
      const isCurrent = idx === currentIdx;
      const isDone = !!p.done;
      const isLocked = idx > currentIdx;
      return renderMissionCard(m, idx, { isCurrent, isDone, isLocked, checked: p.checked || [] });
    }).join('');

    renderIcons();

    // Wire up checklist toggles + copy buttons + complete buttons
    grid.querySelectorAll('.mission-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-toggle-check]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (card.classList.contains('is-locked') || card.classList.contains('is-done')) return;
          const i = Number(el.dataset.toggleCheck);
          const prog = loadMissionProgress();
          const cur = prog[id] || { checked: [], done: false };
          const set = new Set(cur.checked);
          if (set.has(i)) set.delete(i); else set.add(i);
          cur.checked = Array.from(set);
          prog[id] = cur;
          saveMissionProgress(prog);
          renderMissions();
        });
      });
      card.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const text = btn.dataset.copy;
          try {
            await navigator.clipboard.writeText(text);
            showToast('클립보드에 복사됐습니다');
          } catch {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('클립보드에 복사됐습니다');
          }
        });
      });
      const completeBtn = card.querySelector('[data-mission-complete]');
      if (completeBtn) {
        completeBtn.addEventListener('click', () => {
          const prog = loadMissionProgress();
          prog[id] = Object.assign({}, prog[id], { done: true, completedAt: new Date().toISOString() });
          saveMissionProgress(prog);
          showToast('미션 완료! 다음 단계로 진행하세요 🎉', 'sparkles');
          renderMissions();
        });
      }
    });

    // Update overview
    const done = Object.values(progress).filter((p) => p.done).length;
    const doneEl = $('#mission-done-count');
    const totEl = $('#mission-total-count');
    const bar = $('#mission-progress-bar');
    const hint = $('#mission-overview-hint');
    if (doneEl) doneEl.textContent = String(done);
    if (totEl) totEl.textContent = String(total);
    if (bar) {
      const pct = total ? Math.round((done / total) * 100) : 0;
      bar.style.setProperty('--val', pct + '%');
      bar.style.width = pct + '%';
    }
    if (hint) {
      hint.textContent = done === 0
        ? '첫 미션부터 시작하세요'
        : done === total
          ? '모든 미션 완료! 고급 미션이 곧 추가됩니다.'
          : `다음 미션: ${state.missions[currentIdx]?.title || ''}`;
    }
  }

  function renderMissionCard(m, idx, flags) {
    const { isCurrent, isDone, isLocked, checked } = flags;
    const statusHtml = isDone
      ? `<span class="mission-status done"><i data-lucide="check-circle-2"></i> 완료</span>`
      : isLocked
        ? `<span class="mission-status locked"><i data-lucide="lock"></i> 잠금</span>`
        : `<span class="mission-status in-progress"><i data-lucide="play"></i> 진행 중</span>`;
    const tier = m.tier ? `<span class="mission-tier">${escapeHtml(m.tier)}</span>` : '';
    const checklist = (m.checklist || []).map((txt, i) => {
      const isChecked = checked.includes(i);
      const icon = isChecked ? 'check-square' : 'square';
      return `<li data-toggle-check="${i}" class="${isChecked ? 'is-checked' : ''}">
        <i data-lucide="${icon}"></i>
        <span>${escapeHtml(txt)}</span>
      </li>`;
    }).join('');
    const allChecked = (m.checklist || []).length > 0 &&
      (m.checklist || []).every((_, i) => checked.includes(i));

    const templates = (m.templates || []).map((t) => `
      <div class="mission-template">
        <header>
          <strong>${escapeHtml(t.title)}</strong>
          <button class="mini-copy" data-copy="${escapeHtml(t.content)}">
            <i data-lucide="copy"></i> 복사
          </button>
        </header>
        <pre>${escapeHtml(t.content)}</pre>
      </div>`).join('');

    const criteria = m.complete_criteria
      ? `<div class="mission-criteria"><i data-lucide="flag"></i><span>${escapeHtml(m.complete_criteria)}</span></div>`
      : '';

    const action = isDone
      ? `<button class="btn btn-block btn-done" disabled><i data-lucide="check"></i> 완료됨</button>`
      : isLocked
        ? `<button class="btn btn-block btn-locked" disabled><i data-lucide="lock"></i> 이전 미션 완료 후 해제</button>`
        : `<button class="btn btn-primary btn-block" data-mission-complete ${allChecked ? '' : 'disabled'}>
             <i data-lucide="check"></i> 미션 완료 표시
           </button>`;

    const cls = [
      'card', 'mission-card',
      isCurrent && !isDone ? 'is-current' : '',
      isDone ? 'is-done' : '',
      isLocked ? 'is-locked' : ''
    ].filter(Boolean).join(' ');

    return `
      <article class="${cls}" data-id="${m.id}">
        <header>
          <span class="mission-num">${m.number || String(idx + 1).padStart(2, '0')}</span>
          ${statusHtml}
        </header>
        <h3>${escapeHtml(m.title)}</h3>
        <p class="mission-goal">${tier}${escapeHtml(m.goal || '')}</p>
        ${m.checklist && m.checklist.length ? `<ul class="mission-todo">${checklist}</ul>` : ''}
        ${templates ? `<div class="mission-templates">${templates}</div>` : ''}
        ${criteria}
        ${action}
      </article>`;
  }

  function attachMissionReset() {
    const btn = $('#mission-reset');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (confirm('미션 진행 상태를 모두 초기화하시겠습니까?')) {
        localStorage.removeItem(MISSION_KEY);
        renderMissions();
        showToast('미션 진행 상태가 초기화됐습니다');
      }
    });
  }

  /* ------------------------ Products ------------------------ */
  async function loadProducts() {
    try {
      const res = await fetch('data/products.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.products = {
        categories: Array.isArray(data.categories) ? data.categories : [{ id: 'all', label: '전체' }],
        items: Array.isArray(data.products) ? data.products : []
      };
    } catch (err) {
      console.warn('상품 정보를 불러오지 못했습니다:', err);
      state.products = { categories: [{ id: 'all', label: '전체' }], items: [] };
    }
    renderProductTabs();
    renderProducts('all');
  }

  function renderProductTabs() {
    const tabs = $('#products-tabs');
    if (!tabs) return;
    const cats = state.products.categories || [];
    tabs.innerHTML = cats.map((c, i) =>
      `<button class="tab ${i === 0 ? 'is-active' : ''}" data-pcat="${c.id}">${escapeHtml(c.label)}</button>`
    ).join('');
    tabs.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        renderProducts(btn.dataset.pcat);
      });
    });
  }

  function renderProducts(categoryId) {
    const grid = $('#products-grid');
    const empty = $('#products-empty');
    if (!grid) return;

    const items = (state.products.items || []).filter((p) => {
      if (!categoryId || categoryId === 'all') return true;
      return p.category === categoryId;
    });

    if (!items.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    grid.innerHTML = items.map(renderProductCard).join('');
    renderIcons();

    grid.querySelectorAll('.product-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a, [data-stop]')) return;
        const id = card.dataset.id;
        openProductModal(id);
      });
    });
  }

  function renderProductCard(p) {
    const price = p.price ? `<span class="product-price">${formatNumber(p.price)}원</span>` : '';
    const rbv = p.rbv ? `<span class="product-rbv">RBV ${formatNumber(p.rbv)}</span>` : '';
    const thumb = p.image
      ? `<img src="${p.image}" alt="${escapeHtml(p.name)}" loading="lazy" />`
      : `<div class="product-thumb-placeholder"><i data-lucide="package"></i></div>`;
    const tag = p.tag ? `<span class="product-tag">${escapeHtml(p.tag)}</span>` : '';
    const video = p.youtube ? `<span class="product-badge"><i data-lucide="play"></i> 영상</span>` : '';
    return `
      <article class="card product-card" data-id="${escapeHtml(p.id)}">
        <div class="product-thumb">
          ${thumb}
          ${tag}
          ${video}
        </div>
        <div class="product-body">
          <strong>${escapeHtml(p.name)}</strong>
          <p>${escapeHtml(p.summary || '')}</p>
          <div class="product-meta">${price}${rbv}</div>
        </div>
      </article>`;
  }

  /* ---- Product modal ---- */
  function openProductModal(id) {
    const modal = $('#product-modal');
    const body = $('#product-modal-body');
    const p = (state.products.items || []).find((x) => x.id === id);
    if (!modal || !body || !p) return;
    body.innerHTML = renderProductDetail(p);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    renderIcons();
  }
  function closeProductModal() {
    const modal = $('#product-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function renderProductDetail(p) {
    const price = p.price ? `<div class="pd-stat"><em>가격</em><strong>${formatNumber(p.price)}원</strong></div>` : '';
    const rbv = p.rbv ? `<div class="pd-stat"><em>RBV</em><strong>${formatNumber(p.rbv)}</strong></div>` : '';
    const video = p.youtube
      ? `<div class="pd-video">
          <iframe src="https://www.youtube.com/embed/${escapeHtml(p.youtube)}"
                  title="${escapeHtml(p.name)}"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen></iframe>
        </div>` : '';
    const features = (p.features || []).map((f) => `<li><span class="dot-b"></span> ${escapeHtml(f)}</li>`).join('');
    const highlights = (p.highlights || []).map((h) => `<li><span class="dot-g"></span> ${escapeHtml(h)}</li>`).join('');
    const downloads = (p.downloads || []).map((d) => `
      <a href="downloads/${escapeHtml(d.filename)}" download class="pd-download">
        <i data-lucide="download"></i>
        <span>
          <strong>${escapeHtml(d.title)}</strong>
          <em>.${(d.type || '').toLowerCase()}${d.size ? ' · ' + d.size : ''}</em>
        </span>
      </a>`).join('');

    return `
      <header class="pd-head">
        <h2>${escapeHtml(p.name)}</h2>
        ${p.summary ? `<p>${escapeHtml(p.summary)}</p>` : ''}
      </header>
      <div class="pd-stats">${price}${rbv}</div>
      ${video}
      ${features ? `<section class="pd-section"><h3>제품 특징</h3><ul class="bullet-list">${features}</ul></section>` : ''}
      ${highlights ? `<section class="pd-section"><h3>홍보 포인트</h3><ul class="bullet-list">${highlights}</ul></section>` : ''}
      ${downloads ? `<section class="pd-section"><h3>자료 다운로드</h3><div class="pd-downloads">${downloads}</div></section>` : ''}`;
  }

  function attachProductModalHandlers() {
    const modal = $('#product-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-modal-close]').forEach((el) =>
      el.addEventListener('click', closeProductModal)
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) closeProductModal();
    });
  }

  /* ------------------------ Bootstrap ------------------------ */
  function init() {
    renderIcons();
    attachAuthTabs();
    attachLoginHandlers();
    attachSignupHandlers();
    attachNavHandlers();
    attachSidebarHandlers();
    attachNoticeFilters();
    attachLibrarySearch();
    attachMissionReset();
    attachProductModalHandlers();
    loadNotices();
    loadLibrary();
    loadMissions();
    loadProducts();

    // Restore session if present
    const session = loadSession();
    if (session && (session.email || session.code)) {
      state.partner = session;
      showApp();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
