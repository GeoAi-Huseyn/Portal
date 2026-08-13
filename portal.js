/* ─── AUTH & API CONFIG ─── */
const API_URL = 'http://localhost:3000/api';
const HEADERS = { 'Content-Type': 'application/json' };

let portalUserRole = localStorage.getItem('portalRole') || 'user';
let portalUserName = localStorage.getItem('portalName') || 'İstifadəçi';
let portalUserId = localStorage.getItem('portalUserId') || '0';

// Global cache for domains
let domains = { departments: [], sectors: [], positions: [] };
let employees = [];
let nextId = 1, editingId = null, currentView = 'card', currentPage = 'directory';
let editRequestMode = false; // true when non-admin is submitting an edit request
let editRequestOriginalData = null; // snapshot of current employee data
let searchField = 'all'; // 'all' or specific field key
let orgSelectedDeptId = null;
let orgSearchQuery = '';
let orgExpandedSectors = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  const initStr = portalUserName.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  document.getElementById('sidebarAvatar').textContent = initStr;
  document.getElementById('sidebarName').textContent = portalUserName;
  document.getElementById('sidebarRole').textContent = portalUserRole === 'admin' ? 'Sistem İdarəçisi' : 'İşçi İstifadəçi';

  if (portalUserRole === 'admin') {
    document.getElementById('navRequests').style.display = 'flex';
    document.getElementById('navDomains').style.display = 'flex';
    document.getElementById('navImport').style.display = 'flex';
    document.getElementById('addBtn').style.display = 'inline-flex';
    const adminBtn = document.getElementById('adminLoginBtn');
    if (adminBtn) adminBtn.style.display = 'none';
    
    // Hide name, role and avatar so only the logout button is visible inside userCard
    const avatar = document.getElementById('sidebarAvatar');
    if (avatar) avatar.style.display = 'none';
    const userInfo = document.querySelector('.topbar-user-info');
    if (userInfo) userInfo.style.display = 'none';

    fetchPendingRequestsCount();
    setInterval(fetchPendingRequestsCount, 30000);
    // Auto-sync sequences on admin panel entry/refresh (silently)
    syncSequences(false);
  } else {
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
      addBtn.style.display = 'inline-flex';
    }
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) logoutBtn.style.display = 'none';
    
    const userCard = document.getElementById('userCard');
    if (userCard) userCard.style.display = 'none';
  }

  // Load domains first, then load employees
  await fetchDomains();
  await fetchEmployees();
});

function logout() {
  localStorage.clear();
  window.location.reload();
}

async function syncSequences(showFeedback = true) {
  let syncBtn = null;
  if (showFeedback) {
    // Find the sync button in the UI
    const btns = document.querySelectorAll('button');
    syncBtn = Array.from(btns).find(b => b.textContent.includes('Bazanı Sinxronlaşdır'));
    if (syncBtn) {
      syncBtn.classList.add('loading');
      syncBtn.disabled = true;
    }
  }

  try {
    const res = await fetch(`${API_URL}/admin/sync-sequences`, { method: 'POST', headers: HEADERS });
    if (!res.ok) throw new Error('Sync failed');
    const data = await res.json();
    if (showFeedback) {
      const maxEmp = data.sequences?.employees ?? '?';
      showToast(`Sayğaclar sinxronlaşdırıldı ✓ (İşçi max ID: ${maxEmp})`, 'success');
    }
  } catch (err) {
    if (showFeedback) {
      showToast('Sinxronizasiya zamanı xəta baş verdi', 'error');
    }
    console.error('syncSequences error:', err);
  } finally {
    if (syncBtn) {
      // Small timeout to let user see the animation finish
      setTimeout(() => {
        syncBtn.classList.remove('loading');
        syncBtn.disabled = false;
      }, 500);
    }
  }
}
window.syncSequences = syncSequences;

async function promptAdminLogin() {
  const pwd = prompt("Admin şifrəsini daxil edin:");
  if (pwd === null) return;
  if (!pwd.trim()) {
    alert("Şifrə boş ola bilməz!");
    return;
  }
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ username: 'Admin', password: pwd })
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('portalRole', data.role);
      localStorage.setItem('portalName', data.username);
      localStorage.setItem('portalUserId', String(data.id));
      window.location.reload();
    } else {
      const err = await res.json().catch(() => ({ error: "Şifrə yanlışdır!" }));
      alert(err.error || "Şifrə yanlışdır!");
    }
  } catch (err) {
    console.error(err);
    alert("Qoşulma xətası baş verdi!");
  }
}

/* ─── DATA & API ─── */
const DEPT_GRADIENTS = [
  'linear-gradient(135deg, #1E293B, #334155)', // Corporate Slate
  'linear-gradient(135deg, #0F172A, #1E293B)', // Navy Dark
  'linear-gradient(135deg, #312E81, #4338CA)', // Deep Indigo
  'linear-gradient(135deg, #164E63, #0E7490)', // Teal/Cyan
  'linear-gradient(135deg, #064E3B, #047857)', // Emerald
  'linear-gradient(135deg, #581C87, #7E22CE)', // Purple
  'linear-gradient(135deg, #7F1D1D, #B91C1C)', // Ruby Red
  'linear-gradient(135deg, #701A75, #A21CAF)', // Fuchsia
  'linear-gradient(135deg, #111827, #374151)', // Charcoal
  'linear-gradient(135deg, #3F6212, #4D7C0F)'  // Olive Green
];

function departmentGradient(dept) {
  if (!dept) return DEPT_GRADIENTS[0];
  let h = 0; for (let c of dept) h = (h * 31 + c.charCodeAt(0)) & 0xFFFFFFFF;
  return DEPT_GRADIENTS[Math.abs(h) % DEPT_GRADIENTS.length];
}
function initials(n) { return n.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(); }

window.formatMobilePhone = function (input) {
  let raw = input.value.replace(/\D/g, '');
  raw = raw.substring(0, 9);

  let formatted = '';
  if (raw.length > 0) formatted += raw.substring(0, 2);
  if (raw.length > 2) formatted += '-' + raw.substring(2, 5);
  if (raw.length > 5) formatted += '-' + raw.substring(5, 7);
  if (raw.length > 7) formatted += '-' + raw.substring(7, 9);

  input.value = formatted;
};

// Fetch all domain lists
async function fetchDomains() {
  try {
    const res = await fetch(`${API_URL}/domains`, { headers: HEADERS });
    if (!res.ok) throw new Error('API Error');
    domains = await res.json() || { departments: [], sectors: [], positions: [] };
    populateFormDomains();
  } catch (err) {
    showToast('Domain məlumatları yüklənərkən xəta baş verdi');
    console.error(err);
  }
}

async function fetchEmployees() {
  try {
    window.setPage = setPage; window.openView = openView; window.openEdit = openEdit; window.deleteEmp = deleteEmp; window.filterEmployees = filterEmployees; window.logout = logout; window.openAddModal = openAddModal; window.closeModal = closeModal; window.saveDirectPassword = saveDirectPassword; window.openDirectPassModal = openDirectPassModal; window.approveEditRequest = approveEditRequest; window.rejectEditRequest = rejectEditRequest; window.saveEmployee = saveEmployee; window.showToast = showToast; window.toggleSearchFieldDD = toggleSearchFieldDD; window.setSearchField = setSearchField; window.approveNewEmployeeRequest = approveNewEmployeeRequest; window.renderUsersTable = renderUsersTable;
    const res = await fetch(`${API_URL}/employees`, { headers: HEADERS });
    if (!res.ok) throw new Error('API Error');
    employees = await res.json() || [];
    render();
  } catch (err) {
    showToast('Məlumatlar yüklənərkən xəta baş verdi');
    console.error(err);
  }
}

function updateStats() {
  const animate = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    let start = 0, step = Math.max(val / 20, 1);
    const t = setInterval(() => {
      start += step;
      if (start >= val) { el.textContent = val; clearInterval(t); }
      else el.textContent = Math.floor(start);
    }, 30);
  };
  const uniqueRooms = [...new Set(employees.map(e => (e.room || '').trim().toLowerCase()).filter(Boolean))].length;
  const carOwners = employees.filter(e => e.car_plate && e.car_plate.trim() !== '').length;
  animate('totalCount', employees.length);
  animate('roomCount', uniqueRooms);
  animate('carCount', carOwners);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select')) {
    document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('open'));
  }
  if (!e.target.closest('#searchFieldWrap')) {
    const dd = document.getElementById('searchFieldDD');
    if (dd) dd.classList.remove('open');
  }
  if (!e.target.closest('.form-cs')) {
    document.querySelectorAll('.form-cs').forEach(el => el.classList.remove('open'));
  }
});

/* ─── FORM CUSTOM SELECT SYSTEM ─── */
window.toggleFormCS = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('disabled')) return; // Block opening if disabled
  const wasOpen = el.classList.contains('open');
  // Close all form-cs first
  document.querySelectorAll('.form-cs').forEach(x => x.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
};

function sortFormCSOptionsById(options) {
  const idOf = (val) => {
    const s = String(val);
    if (s.startsWith('sys_')) return Number(s.slice(4)) || 0;
    return Number(s) || 0;
  };
  return [...options].sort((a, b) => idOf(a.val) - idOf(b.val));
}

function populateFormCS(csId, options, placeholder, withSearch = false) {
  // options = [{val, text}]
  const optsEl = document.getElementById(csId + '-opts');
  if (!optsEl) return;

  const sortedOptions = sortFormCSOptionsById(options);

  let html = '';
  if (withSearch && sortedOptions.length > 5) {
    html += `<div class="form-cs-search"><input type="text" placeholder="Axtar..." oninput="filterFormCSOptions('${csId}', this.value)" onclick="event.stopPropagation()"></div>`;
  }
  if (placeholder !== null) {
    html += `<div class="form-cs-option empty-opt" onclick="selectFormCS('${csId}', '', '${placeholder.replace(/'/g, "\\'")}')">— ${placeholder} —</div>`;
    html += '<div class="form-cs-divider"></div>';
  }
  sortedOptions.forEach(opt => {
    const escapedText = opt.text.replace(/'/g, "\\'");
    html += `<div class="form-cs-option" data-val="${opt.val}" data-text="${opt.text}" onclick="selectFormCS('${csId}', '${opt.val}', '${escapedText}')">${opt.text}</div>`;
  });
  optsEl.innerHTML = html;
}

window.filterFormCSOptions = function (csId, query) {
  const optsEl = document.getElementById(csId + '-opts');
  if (!optsEl) return;
  const q = query.toLocaleUpperCase('az');
  optsEl.querySelectorAll('.form-cs-option:not(.empty-opt)').forEach(opt => {
    const text = (opt.dataset.text || '').toLocaleUpperCase('az');
    opt.style.display = text.includes(q) ? '' : 'none';
  });
};

window.selectFormCS = function (csId, val, text) {
  const el = document.getElementById(csId);
  if (!el) return;
  const selectedEl = el.querySelector('.form-cs-selected');
  const hiddenInput = el.querySelector('input[type="hidden"]');
  if (selectedEl) {
    selectedEl.textContent = val ? text : text; // placeholder text passed in
    selectedEl.classList.toggle('placeholder', !val);
  }
  if (hiddenInput) {
    const oldVal = hiddenInput.value;
    hiddenInput.value = val;
    if (oldVal !== val && typeof hiddenInput.onchange === 'function') {
      hiddenInput.onchange();
    }
  }
  // Update active state
  el.querySelectorAll('.form-cs-option').forEach(opt => {
    opt.classList.toggle('active', String(opt.dataset.val) === String(val) && val !== '');
  });
  el.classList.remove('open');
};

function setFormCSWithValue(csId, val, placeholderText) {
  const el = document.getElementById(csId);
  if (!el) return;
  const hiddenInput = el.querySelector('input[type="hidden"]');
  const oldVal = hiddenInput ? hiddenInput.value : '';
  setFormCS(csId, val, placeholderText);
  if (hiddenInput && oldVal !== String(val || '') && typeof hiddenInput.onchange === 'function') {
    hiddenInput.onchange();
  }
}

function setFormCS(csId, val, placeholderText) {
  // Programmatically set a value (for edit mode)
  const el = document.getElementById(csId);
  if (!el) return;
  const hiddenInput = el.querySelector('input[type="hidden"]');
  if (hiddenInput) hiddenInput.value = val || '';
  const selectedEl = el.querySelector('.form-cs-selected');
  // Find matching option text
  const matchOpt = el.querySelector(`.form-cs-option[data-val="${val}"]`);
  el.querySelectorAll('.form-cs-option').forEach(opt => {
    opt.classList.toggle('active', String(opt.dataset.val) === String(val) && val !== '');
  });
  if (selectedEl) {
    if (val && matchOpt) {
      selectedEl.textContent = matchOpt.dataset.text;
      selectedEl.classList.remove('placeholder');
    } else {
      selectedEl.textContent = placeholderText;
      selectedEl.classList.add('placeholder');
    }
  }
}

window.toggleCS = function (id) {
  const el = document.getElementById(id);
  const wasOpen = el.classList.contains('open');
  document.querySelectorAll('.custom-select').forEach(x => x.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
};

window.selectCSOption = function (csId, val, text) {
  const cs = document.getElementById(csId);
  cs.classList.remove('open');
  cs.querySelector('.cs-selected').textContent = text;
  const inp = cs.querySelector('input');
  inp.value = val;
  filterEmployees();
};

function renderCSOptions(csId, placeholder, optionsArr, currentVal) {
  const cso = document.getElementById('cso-' + csId.split('-')[1]);
  if (!cso) return;
  let html = `<div class="cs-option ${currentVal === '' ? 'active' : ''}" onclick="selectCSOption('${csId}', '', '${placeholder}')">${placeholder}</div>`;
  optionsArr.forEach(opt => {
    html += `<div class="cs-option ${String(currentVal) === String(opt.val) ? 'active' : ''}" onclick="selectCSOption('${csId}', '${opt.val}', '${opt.text}')">${opt.text}</div>`;
  });
  cso.innerHTML = html;
  const cs = document.getElementById(csId);
  if (cs) {
    const selected = optionsArr.find(x => String(x.val) === String(currentVal));
    cs.querySelector('.cs-selected').textContent = selected ? selected.text : placeholder;
    const inp = cs.querySelector('input');
    if (inp) inp.value = currentVal;
  }
}

window.clearFilters = function () {
  const search = document.getElementById('searchInput');
  if (search) search.value = '';

  const setCS = (id, text) => {
    const cs = document.getElementById(id);
    if (!cs) return;
    cs.querySelector('.cs-selected').textContent = text;
    const inp = cs.querySelector('input');
    if (inp) inp.value = '';
  };

  setCS('cs-dept', 'Bütün şöbələr');
  setCS('cs-sec', 'Bütün sektorlar');
  setCS('cs-pos', 'Bütün vəzifələr');

  filterEmployees();
};

function updateFilters() {
  const q = document.getElementById('searchInput') ? document.getElementById('searchInput').value : '';
  const df = document.getElementById('deptFilter'), sf = document.getElementById('secFilter'), pf = document.getElementById('posFilter');
  const dv = df ? df.value : '', sv = sf ? sf.value : '', pv = pf ? pf.value : '';

  const clearBtn = document.getElementById('clearFiltersBtn');
  if (clearBtn) {
    clearBtn.style.display = (q || dv || sv || pv) ? 'inline-flex' : 'none';
  }

  // Populate departments
  renderCSOptions('cs-dept', 'Bütün şöbələr', domains.departments.map(d => ({ val: d.id, text: d.name })), dv);

  // Populate sectors (cascade based on dept)
  let availableSectors = domains.sectors;
  if (dv) {
    availableSectors = domains.sectors.filter(s => String(s.dept_id) === String(dv));
  }
  renderCSOptions('cs-sec', 'Bütün sektorlar', availableSectors.map(s => ({ val: s.id, text: s.name })), sv);

  // Populate positions (cascade based on sector/dept from employees data)
  let availablePositions = domains.positions;
  if (sv) {
    const posIdsInSector = employees.filter(e => String(e.sector_id) === String(sv) && e.position_id).map(e => String(e.position_id));
    availablePositions = domains.positions.filter(p => posIdsInSector.includes(String(p.id)));
  } else if (dv) {
    const posIdsInDept = employees.filter(e => String(e.dept_id) === String(dv) && e.position_id).map(e => String(e.position_id));
    availablePositions = domains.positions.filter(p => posIdsInDept.includes(String(p.id)));
  }
  renderCSOptions('cs-pos', 'Bütün vəzifələr', availablePositions.map(p => ({ val: p.id, text: p.name })), pv);
}

function getFiltered() {
  const raw = document.getElementById('searchInput').value;
  const q = raw.toLocaleUpperCase('az');
  const d = document.getElementById('deptFilter').value;
  const s = document.getElementById('secFilter') ? document.getElementById('secFilter').value : '';
  const p = document.getElementById('posFilter').value;
  return employees.filter(e => {
    let ok = true;
    if (q) {
      if (searchField === 'all') {
        ok = [e.name, e.email, e.dept_name, e.sector_name, e.position_name, e.room, e.car_plate, e.intphone, e.mobile].some(f => f && f.toLocaleUpperCase('az').includes(q));
      } else {
        let key = searchField;
        if (key === 'dept') key = 'dept_name';
        if (key === 'sektor') key = 'sector_name';
        if (key === 'position') key = 'position_name';
        const val = e[key];
        ok = val ? val.toLocaleUpperCase('az').includes(q) : false;
      }
    }
    return ok && (!d || String(e.dept_id) === String(d)) && (!s || String(e.sector_id) === String(s)) && (!p || String(e.position_id) === String(p));
  });
}

function toggleSearchFieldDD(event) {
  if (event) event.stopPropagation();
  const dd = document.getElementById('searchFieldDD');
  if (dd) dd.classList.toggle('open');
}

function setSearchField(field, label, placeholder) {
  searchField = field;
  const lbl = document.getElementById('searchFieldLabel');
  if (lbl) lbl.textContent = label;
  document.querySelectorAll('.sfd-opt').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
  const inp = document.getElementById('searchInput');
  if (inp) { inp.placeholder = placeholder; inp.focus(); }
  const dd = document.getElementById('searchFieldDD');
  if (dd) dd.classList.remove('open');
  filterEmployees();
}

function renderCards(list) {
  const g = document.getElementById('cardGrid');
  if (!list.length) {
    g.innerHTML = `<div class="empty-wrap"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><h3>Məlumat tapılmadı</h3><p>Fərqli axtarış sözü sınayın</p></div>`;
    return;
  }
  g.innerHTML = list.map((e, i) => {
    const bg = departmentGradient(e.dept_name);
    const delay = `animation-delay:${i * 0.04}s`;
    return `<div class="emp-card" style="${delay}" onclick="openView(${e.id})">
      <div class="card-banner" style="background:${bg}"></div>
      <div class="card-top">
        <div class="emp-avatar" style="background:${bg}">${initials(e.name)}</div>
        <div>
          <div class="emp-name">${e.name}</div>
          <div class="emp-pos">${e.position_name || '—'}</div>
          <span class="dept-chip">Şöbə: ${e.dept_name || '—'}</span>
          ${e.sector_name ? `<span class="dept-chip" style="background:rgba(16,185,129,0.1); color:var(--success); margin-left:4px">Sektor: ${e.sector_name}</span>` : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg><a href="mailto:${e.email}" onclick="event.stopPropagation()">${e.email}</a></div>
        ${e.intphone ? `<div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg><span>Daxili: <strong>${e.intphone}</strong></span></div>` : ''}
        ${e.mobile ? `<div class="info-row"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg><span>Mobil: <a href="tel:${e.mobile}" onclick="event.stopPropagation()"><strong>${e.mobile}</strong></a></span></div>` : ''}
      </div>
      <div class="card-footer">
        ${e.room ? `<span class="room-chip"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>Otaq ${e.room}</span>` : '<span></span>'}
        <div class="card-acts">
          ${portalUserRole === 'admin' ? `
          <button class="act-btn" title="Redəktə" onclick="event.stopPropagation();openEdit(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
          <button class="act-btn red" title="Sil" onclick="event.stopPropagation();deleteEmp(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          ` : `
          <button class="act-btn" title="Redəktə Sorğusu" ${Number(e.dept_id) === 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="event.stopPropagation(); if (Number(${e.dept_id}) !== 1) openEdit(${e.id})"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
          `}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderTable(list) {
  const tb = document.getElementById('tableBody');
  if (!list.length) { tb.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#94A3B8">Məlumat tapılmadı</td></tr>`; return; }
  tb.innerHTML = list.map(e => `<tr>
    <td><span class="t-avatar" style="background:${departmentGradient(e.dept_name)}">${initials(e.name)}</span>${e.name}</td>
    <td>${e.position_name || '—'}</td>
    <td><span class="dept-chip" style="margin:0">${e.dept_name || '—'}</span></td>
    <td>${e.sector_name || '—'}</td>
    <td><a href="mailto:${e.email}" style="color:#4F46E5;text-decoration:none;font-weight:600">${e.email}</a></td>
    <td>${e.intphone || '—'}</td>
    <td>${e.mobile || '—'}</td>
    <td>${e.room || '—'}</td>
    <td style="text-align:right">
      <div class="card-acts" style="justify-content:flex-end">
        <button class="act-btn" onclick="openView(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg></button>
        <button class="act-btn" title="${portalUserRole === 'admin' ? 'Redəktə' : 'Redəktə Sorğusu'}" ${portalUserRole !== 'admin' && Number(e.dept_id) === 1 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''} onclick="if (portalUserRole === 'admin' || Number(${e.dept_id}) !== 1) openEdit(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
        ${portalUserRole === 'admin' ? `
        <button class="act-btn red" onclick="deleteEmp(${e.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
        ` : ''}
      </div>
    </td>
  </tr>`).join('');
}

const ORG_ROLE_LABELS = {
  director: 'Direktor',
  'director-deputy': 'Direktor Müavini',
  'dept-head': 'Şöbə Müdiri',
  'dept-deputy': 'Şöbə Müdiri Müavini',
  'sector-head': 'Sektor Müdiri',
  staff: 'Əməkdaş'
};

function getEmployeeRole(emp) {
  const p = (emp.position_name || '').toLocaleUpperCase('az');
  if (p.includes('DİREKTOR') && p.includes('MÜAVİN')) return 'director-deputy';
  if (p.includes('DİREKTOR')) return 'director';
  if (p.includes('ŞÖBƏ MÜDİR') && p.includes('MÜAVİN')) return 'dept-deputy';
  if (p.includes('ŞÖBƏ MÜDİR')) return 'dept-head';
  if (p.includes('SEKTOR MÜDİR')) return 'sector-head';
  if (p.includes('MÜAVİN') && !p.includes('SEKTOR')) return 'dept-deputy';
  return 'staff';
}

function orgAvatarBg(role, deptGradient) {
  if (role === 'director') return 'linear-gradient(135deg,#1E293B 0%,#0F172A 55%,#334155 100%)';
  if (role === 'director-deputy') return 'linear-gradient(135deg,#1E3A5F,#2563EB)';
  if (role === 'dept-head') return 'linear-gradient(135deg,#3730A3,#4F46E5)';
  if (role === 'dept-deputy') return 'linear-gradient(135deg,#475569,#64748B)';
  if (role === 'sector-head') return 'linear-gradient(135deg,#047857,#10B981)';
  return deptGradient || 'linear-gradient(135deg,#64748B,#94A3B8)';
}

function renderOrgPerson(emp, role, deptGradient) {
  return `
    <div class="org-person org-person--${role}" onclick="openView(${emp.id})" title="Profilə bax">
      <span class="org-person-badge">${ORG_ROLE_LABELS[role]}</span>
      
      <div class="org-person-name">${emp.name}</div>
      <div class="org-person-title">${emp.position_name || ORG_ROLE_LABELS[role]}</div>
    </div>`;
}

function renderOrgStaffList(staffList, deptGradient, label) {
  if (!staffList.length) return '';
  return `
    <div class="org-staff-section">
      <div class="org-staff-label">${label} <span>${staffList.length}</span></div>
      <div class="org-staff-list">
        ${staffList.map(emp => `
          <div class="org-staff-row" onclick="openView(${emp.id})" title="Profilə bax">
            
            <span class="org-staff-row-name">${emp.name}</span>
            <span class="org-staff-row-pos">${emp.position_name || 'Əməkdaş'}</span>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderOrgSectorBlock(sector, deptEmps, excludeIds, deptGradient, deptId) {
  const secEmps = deptEmps.filter(e =>
    String(e.sector_id) === String(sector.id) && !excludeIds.has(String(e.id))
  );
  const leader = secEmps.find(e => getEmployeeRole(e) === 'sector-head');
  const staff = secEmps.filter(e => !leader || String(e.id) !== String(leader.id));
  const sectorKey = `${deptId}-${sector.id}`;
  const isOpen = orgExpandedSectors.has(sectorKey);

  return `
    <section class="org-sector-block ${isOpen ? 'open' : ''}" data-sector-key="${sectorKey}">
      <button type="button" class="org-sector-head" onclick="toggleOrgSector('${sectorKey}', event)">
        <span class="org-sector-chevron">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
        </span>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px; opacity:0.6;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        <h4>${sector.name}</h4>
        <span class="org-sector-count">${secEmps.length} nəfər</span>
      </button>
      <div class="org-sector-body">
        ${leader ? `<div class="org-sector-leader">${renderOrgPerson(leader, 'sector-head', deptGradient)}</div>` : ''}
        ${staff.length
      ? renderOrgStaffList(staff, deptGradient, 'Sektor əməkdaşları')
      : (!leader ? '<p class="org-empty-note">Bu sektorda əməkdaş qeydiyyatdan keçməyib</p>' : '')}
      </div>
    </section>`;
}

function getDeptEmployeeCount(deptId) {
  return employees.filter(e =>
    String(e.dept_id) === String(deptId) && getEmployeeRole(e) !== 'director'
  ).length;
}

function renderOrgDeptPanel(dept, isActive) {
  const deptEmps = employees.filter(e =>
    String(e.dept_id) === String(dept.id) && getEmployeeRole(e) !== 'director'
  );
  const manager = deptEmps.find(e => getEmployeeRole(e) === 'dept-head');
  const deputies = deptEmps.filter(e => getEmployeeRole(e) === 'dept-deputy');
  const excludeIds = new Set([manager, ...deputies].filter(Boolean).map(e => String(e.id)));
  const deptSectors = domains.sectors.filter(s => String(s.dept_id) === String(dept.id));
  const deptGradient = departmentGradient(dept.name);

  const deptDirectStaff = deptEmps.filter(e =>
    !e.sector_id &&
    !excludeIds.has(String(e.id)) &&
    getEmployeeRole(e) !== 'sector-head'
  );

  const sectorsHtml = deptSectors.map(sec =>
    renderOrgSectorBlock(sec, deptEmps, excludeIds, deptGradient, dept.id)
  ).join('');

  return `
    <article class="org-dept-panel ${isActive ? 'active' : ''}" data-dept-id="${dept.id}" id="org-dept-${dept.id}">
      <header class="org-dept-header">
        
        <div class="org-dept-meta">
          <h3>${dept.name}</h3>
          <p>${deptEmps.length} əməkdaş${deptSectors.length ? ` · ${deptSectors.length} sektor` : ''}</p>
        </div>
      </header>

      <div class="org-leadership-row">
        ${manager
      ? renderOrgPerson(manager, 'dept-head', deptGradient)
      : '<div class="org-person org-person--vacant"><span class="org-person-badge">Şöbə Müdiri</span><div class="org-vacant-text">Təyin edilməyib</div></div>'}
        ${deputies.length
      ? deputies.map(dep => renderOrgPerson(dep, 'dept-deputy', deptGradient)).join('')
      : '<div class="org-person org-person--vacant org-person--vacant-deputy"><span class="org-person-badge">Şöbə Müdiri Müavini</span><div class="org-vacant-text">Təyin edilməyib</div></div>'}
      </div>

      ${deptSectors.length ? `<div class="org-sectors-wrap">${sectorsHtml}</div>` : ''}
      ${renderOrgStaffList(deptDirectStaff, deptGradient, 'Birbaşa şöbə əməkdaşları')}
    </article>`;
}

function getFilteredOrgDepts() {
  const q = orgSearchQuery.toLocaleUpperCase('az').trim();
  if (!q) return domains.departments;
  return domains.departments.filter(dept => {
    if (dept.name.toLocaleUpperCase('az').includes(q)) return true;
    const deptSectors = domains.sectors.filter(s => String(s.dept_id) === String(dept.id));
    return deptSectors.some(s => s.name.toLocaleUpperCase('az').includes(q));
  });
}

window.filterOrgView = function (query) {
  orgSearchQuery = query || '';
  const filtered = getFilteredOrgDepts();
  if (filtered.length && (!orgSelectedDeptId || !filtered.some(d => String(d.id) === String(orgSelectedDeptId)))) {
    orgSelectedDeptId = filtered[0].id;
  }
  renderDepts();
};

window.selectOrgDept = function (deptId) {
  orgSelectedDeptId = deptId;
  renderDepts();
  const panel = document.getElementById(`org-dept-${deptId}`);
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.toggleOrgSector = function (sectorKey, event) {
  event.stopPropagation();
  if (orgExpandedSectors.has(sectorKey)) orgExpandedSectors.delete(sectorKey);
  else orgExpandedSectors.add(sectorKey);
  const block = document.querySelector(`[data-sector-key="${sectorKey}"]`);
  if (block) block.classList.toggle('open', orgExpandedSectors.has(sectorKey));
};

window.orgExpandAllSectors = function () {
  document.querySelectorAll('.org-sector-block').forEach(el => {
    const key = el.dataset.sectorKey;
    if (key) orgExpandedSectors.add(key);
    el.classList.add('open');
  });
};

window.orgCollapseAllSectors = function () {
  orgExpandedSectors.clear();
  document.querySelectorAll('.org-sector-block').forEach(el => {
    el.classList.remove('open');
  });
};

// Find the Rəhbərlik department by name (case-insensitive)
function getRehberlikDept() {
  return domains.departments.find(d =>
    d.name.toLocaleUpperCase('az').includes('RƏHBƏRL') ||
    d.name.toLocaleUpperCase('az').includes('REHBERL')
  ) || null;
}

function renderDepts() {
  const container = document.getElementById('deptsContent');
  if (!container) return;

  // Rəhbərlik department employees
  const rehberlikDept = getRehberlikDept();
  const rehberlikEmps = rehberlikDept
    ? employees.filter(e => String(e.dept_id) === String(rehberlikDept.id))
    : employees.filter(e => getEmployeeRole(e) === 'director' || getEmployeeRole(e) === 'director-deputy');

  const directors = rehberlikEmps.filter(e => getEmployeeRole(e) === 'director');
  const directorDeputies = rehberlikEmps.filter(e => getEmployeeRole(e) === 'director-deputy');
  const mgmtOtherStaff = rehberlikEmps.filter(e => {
    const r = getEmployeeRole(e);
    return r !== 'director' && r !== 'director-deputy';
  });

  // Exclude Rəhbərlik from the departments list
  const allFilteredDepts = getFilteredOrgDepts();
  const filteredDepts = rehberlikDept
    ? allFilteredDepts.filter(d => String(d.id) !== String(rehberlikDept.id))
    : allFilteredDepts;
  const sectorCount = domains.sectors.length;

  if (!orgSelectedDeptId && filteredDepts.length) {
    orgSelectedDeptId = filteredDepts[0].id;
  }
  if (orgSelectedDeptId && filteredDepts.length && !filteredDepts.some(d => String(d.id) === String(orgSelectedDeptId))) {
    orgSelectedDeptId = filteredDepts[0].id;
  }

  let html = `
    <div class="org-stats">
      <div class="org-stat"><strong>${directors.length}</strong><span>Direktor</span></div>
      <div class="org-stat"><strong>${domains.departments.length}</strong><span>Şöbə</span></div>
      <div class="org-stat"><strong>${sectorCount}</strong><span>Sektor</span></div>
      <div class="org-stat"><strong>${employees.length}</strong><span>Cəmi əməkdaş</span></div>
    </div>`;

  html += `
    <section class="org-tier org-tier--director">
      <div class="org-tier-head">
        <span class="org-tier-line"></span>
        <h2>İdarəetmə heyəti</h2>
        <span class="org-tier-line"></span>
      </div>

      <!-- Tier 1: Director -->
      <div class="org-director-stage">
        ${directors.length
      ? directors.map(d => renderOrgPerson(d, 'director')).join('')
      : `<div class="org-director-placeholder">
               <div class="org-director-placeholder-title">KADASTR VƏ YERQURULUŞU LAYİHƏ-TƏDQİQAT MƏRKƏZİ</div>
               <div class="org-director-placeholder-sub">Direktor vəzifəsi hələ təyin edilməyib</div>
             </div>`}
      </div>

      <!-- Tier 2: Deputy Directors -->
      ${directorDeputies.length ? `
      <div class="org-deputy-stage">
        <div class="org-tier-connector"></div>
        <div class="org-deputies-row">
          ${directorDeputies.map(d => renderOrgPerson(d, 'director-deputy')).join('')}
        </div>
      </div>` : ''}

      <!-- Tier 3: Remaining Rəhbərlik staff -->
      ${mgmtOtherStaff.length ? renderOrgStaffList(mgmtOtherStaff, null, 'Rəhbərlik əməkdaşları') : ''}

    </section>`;

  if (filteredDepts.length) {
    html += `
      <section class="org-tier org-tier--departments">
        <div class="org-tier-head">
          <span class="org-tier-line"></span>
          <h2>Şöbələr və Sektorlar</h2>
          <span class="org-tier-line"></span>
        </div>
        <div class="org-layout">
          <aside class="org-sidebar">
            <div class="org-sidebar-title">Şöbələr <span>${filteredDepts.length}</span></div>
            
            <div class="org-mobile-custom-select" onclick="this.classList.toggle('open')">
              <div class="org-mobile-custom-select-trigger">
                <span class="org-mobile-custom-select-trigger-text">${filteredDepts.find(d => String(d.id) === String(orgSelectedDeptId))?.name || (filteredDepts[0]?.name || 'Şöbə seçin')}</span>
                <svg class="org-mobile-custom-select-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <div class="org-mobile-custom-select-options">
                ${filteredDepts.map(dept => `
                  <div class="org-mobile-custom-select-option ${String(dept.id) === String(orgSelectedDeptId) ? 'selected' : ''}" onclick="event.stopPropagation(); selectOrgDept('${dept.id}')">
                    <span class="org-nav-name">${dept.name}</span>
                    <span class="org-nav-count">${getDeptEmployeeCount(dept.id)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <nav class="org-nav">
              ${filteredDepts.map(dept => `
                <button type="button" class="org-nav-item ${String(dept.id) === String(orgSelectedDeptId) ? 'active' : ''}"
                  onclick="selectOrgDept('${dept.id}')">
                  <span class="org-nav-name">${dept.name}</span>
                  <span class="org-nav-count">${getDeptEmployeeCount(dept.id)}</span>
                </button>
              `).join('')}
            </nav>
          </aside>
          <main class="org-main">
            ${filteredDepts.map(dept => renderOrgDeptPanel(dept, String(dept.id) === String(orgSelectedDeptId))).join('')}
          </main>
        </div>
      </section>`;
  } else if (domains.departments.length) {
    html += `<div class="org-empty-state"><p>Axtarışa uyğun şöbə tapılmadı.</p></div>`;
  } else {
    html += `<div class="org-empty-state"><p>Heç bir şöbə əlavə edilməyib. Domainlər bölməsindən şöbə yarada bilərsiniz.</p></div>`;
  }

  container.innerHTML = html;
}

function toggleDeptCollapse(el) {
  // legacy noop
}
window.toggleDeptCollapse = toggleDeptCollapse;

function render() {
  updateStats(); updateFilters();
  const list = getFiltered();
  renderCards(list); renderTable(list);
  if (currentPage === 'departments') renderDepts();
}
function filterEmployees() { render(); }

function setView(v) {
  currentView = v;
  document.getElementById('cardGrid').classList.toggle('hidden', v === 'table');
  document.getElementById('tableWrap').classList.toggle('active', v === 'table');
  document.getElementById('cardViewBtn').classList.toggle('active', v === 'card');
  document.getElementById('tableViewBtn').classList.toggle('active', v === 'table');
}

async function setPage(p) {
  currentPage = p;
  document.getElementById('directoryPage').style.display = p === 'directory' ? '' : 'none';
  document.getElementById('departmentsPage').style.display = p === 'departments' ? '' : 'none';
  document.getElementById('requestsPage').style.display = p === 'requests' ? '' : 'none';
  document.getElementById('domainsPage').style.display = p === 'domains' ? '' : 'none';
  document.getElementById('importPage').style.display = p === 'import' ? '' : 'none';

  const searchBox = document.getElementById('searchBox');
  if (searchBox) {
    searchBox.style.display = p === 'directory' ? '' : 'none';
  }

  document.getElementById('navDirectory').classList.toggle('active', p === 'directory');
  document.getElementById('navDepartments').classList.toggle('active', p === 'departments');
  document.getElementById('navRequests').classList.toggle('active', p === 'requests');
  document.getElementById('navDomains').classList.toggle('active', p === 'domains');
  document.getElementById('navImport').classList.toggle('active', p === 'import');

  if (p === 'departments') renderDepts();
  if (p === 'requests') await fetchRequestsPageData();
  if (p === 'domains') renderDomainsPage();
}

function openView(id) {
  const e = employees.find(x => String(x.id) === String(id)); if (!e) return;
  document.getElementById('viewModalBody').innerHTML = `
    <div class="profile-banner">
      <div class="profile-avatar-lg" style="background:${departmentGradient(e.dept_name)}">${initials(e.name)}</div>
      <div>
        <div class="profile-name">${e.name}</div>
        <div class="profile-pos">${e.position_name || '—'}</div>
        <span class="dept-chip" style="margin-top:8px">Şöbə: ${e.dept_name || '—'}</span>
        ${e.sector_name ? `<span class="dept-chip" style="margin-top:8px; background:rgba(16,185,129,0.1); color:var(--success); margin-left:4px">Sektor: ${e.sector_name}</span>` : ''}
      </div>
    </div>
    <div class="info-section">
      <div class="info-section-title">Əlaqə Məlumatları</div>
      <div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg><div><div class="info-item-label">Email</div><div class="info-item-value">${e.email}</div></div></div>
      ${e.intphone ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg><div><div class="info-item-label">Daxili Tel.</div><div class="info-item-value">${e.intphone}</div></div></div>` : ''}
      ${e.mobile ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg><div><div class="info-item-label">Mobil</div><div class="info-item-value">${e.mobile}</div></div></div>` : ''}
      ${e.room ? `<div class="info-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg><div><div class="info-item-label">Otaq Nömrəsi</div><div class="info-item-value">Otaq ${e.room}</div></div></div>` : ''}
      ${e.car_plate ? `<div class="info-item"><svg viewBox="0 0 24 24" fill="currentColor" style="opacity:0.75"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg><div><div class="info-item-label">Maşın Nömrəsi</div><div class="info-item-value">${e.car_plate}</div></div></div>` : ''}
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      ${portalUserRole === 'admin' ? `
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="closeModal('viewModal');openEdit(${e.id})">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        Redəktə et
      </button>
      ` : `
      <button class="btn" style="flex:1;justify-content:center;background:#F0F4FF;color:var(--accent);border:1px solid var(--accent); ${Number(e.dept_id) === 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}" ${Number(e.dept_id) === 1 ? 'disabled' : ''} onclick="closeModal('viewModal'); if (Number(${e.dept_id}) !== 1) openEdit(${e.id})">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        Redəktə Sorğusu Göndər
      </button>
      `}
    </div>
  `;
  document.getElementById('viewModal').classList.add('open');
}

function openAddModal() {
  editingId = null;
  editRequestMode = false;
  editRequestOriginalData = null;
  const isAdmin = portalUserRole === 'admin';
  document.getElementById('formTitle').textContent = isAdmin ? 'Yeni Əməkdaş' : 'Yeni Əməkdaş Sorğusu';
  const saveBtn = document.getElementById('saveEmpBtn');
  if (saveBtn) {
    if (isAdmin) {
      saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saxla';
    } else {
      saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Sorğu Göndər';
    }
  }
  ['fName', 'fRoom', 'fEmail', 'fIntPhone', 'fMobile', 'fCarPlate'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });

  // Reset select elements
  setFormCS('fcs-fDept', '', 'Şöbə seçin');
  setFormCS('fcs-fSector', '', 'Sektor seçin');
  onFormDeptChange();

  document.getElementById('formModal').classList.add('open');
}

function openEdit(id) {
  const e = employees.find(x => String(x.id) === String(id)); if (!e) return;
  if (portalUserRole !== 'admin' && Number(e.dept_id) === 1) {
    showToast('Rəhbərlik şöbəsindəki əməkdaşlar redaktə edilə bilməz!', 'error');
    return;
  }
  editingId = id;

  if (portalUserRole !== 'admin') {
    editRequestMode = true;
    editRequestOriginalData = { ...e };
    document.getElementById('formTitle').textContent = 'Redəktə Sorğusu — ' + e.name;
    const saveBtn = document.getElementById('saveEmpBtn');
    if (saveBtn) saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg> Sorğu Göndər';
  } else {
    editRequestMode = false;
    editRequestOriginalData = null;
    document.getElementById('formTitle').textContent = 'Məlumatları Yenilə';
    const saveBtn = document.getElementById('saveEmpBtn');
    if (saveBtn) saveBtn.innerHTML = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Saxla';
  }

  // ── Populate selects without cascade side-effects ──
  const deptId = e.dept_id ? String(e.dept_id) : '';
  const sectorId = e.sector_id ? String(e.sector_id) : '';
  const positionId = e.position_id ? String(e.position_id) : '';

  // 1. Dept — always has all departments as options (filtered for non-admin)
  let depts = domains.departments;
  if (portalUserRole !== 'admin') {
    depts = depts.filter(d => String(d.id) !== '1');
  }
  populateFormCS('fcs-fDept', depts.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin', true);
  setFormCS('fcs-fDept', deptId, 'Şöbə seçin');

  // 2. Sector — options filtered by dept (empty if no dept)
  const sectorOpts = deptId
    ? domains.sectors.filter(s => String(s.dept_id) === deptId)
    : [];
  const sectorContainer = document.getElementById('fcs-fSector');
  if (sectorContainer) {
    if (deptId) sectorContainer.classList.remove('disabled');
    else sectorContainer.classList.add('disabled');
  }
  populateFormCS('fcs-fSector', sectorOpts.map(s => ({ val: s.id, text: s.name })), 'Sektor seçin', true);
  setFormCS('fcs-fSector', sectorId, 'Sektor seçin');

  // 3. Position — show all positions (filtered for non-admin)
  let normalPos = domains.positions || [];
  if (portalUserRole !== 'admin') {
    normalPos = normalPos.filter(p => {
      const id = String(p.id);
      return id !== '1' && id !== '2' && id !== '3';
    });
  }
  const posData = normalPos.map(p => ({ val: p.id, text: p.name }));

  populateFormCS('fcs-fPosition', posData, 'Vəzifə seçin', true);
  setFormCS('fcs-fPosition', positionId, 'Vəzifə seçin');

  // Text fields
  document.getElementById('fName').value = e.name || '';
  document.getElementById('fRoom').value = e.room || '';
  document.getElementById('fEmail').value = e.email || '';
  document.getElementById('fIntPhone').value = e.intphone || '';
  document.getElementById('fMobile').value = (e.mobile || '').replace(/^\+994\s*/, '');
  const fCarPlate = document.getElementById('fCarPlate'); if (fCarPlate) fCarPlate.value = e.car_plate || '';

  document.getElementById('formModal').classList.add('open');
}

// Populate cascading form dropdowns
function populateFormDomains() {
  const fDept = document.getElementById('fDept');
  if (!fDept) return;

  let depts = domains.departments;
  if (portalUserRole !== 'admin') {
    depts = depts.filter(d => String(d.id) !== '1');
  }

  populateFormCS('fcs-fDept', depts.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin', true);
  onFormDeptChange();
}

window.onFormDeptChange = function () {
  const deptId = document.getElementById('fDept').value;
  const fSector = document.getElementById('fSector');
  const sectorContainer = document.getElementById('fcs-fSector');
  if (!fSector) return;

  if (!deptId) {
    // If no department is selected, disable sector selection
    if (sectorContainer) sectorContainer.classList.add('disabled');
    populateFormCS('fcs-fSector', [], 'Sektor seçin', false);
    setFormCS('fcs-fSector', '', 'Sektor seçin');
  } else {
    // If department is selected, enable sector selection
    if (sectorContainer) sectorContainer.classList.remove('disabled');
    const sectorsData = domains.sectors.filter(s => String(s.dept_id) === String(deptId));
    populateFormCS('fcs-fSector', sectorsData.map(s => ({ val: s.id, text: s.name })), 'Sektor seçin', true);
    setFormCS('fcs-fSector', '', 'Sektor seçin');
  }
  onFormSectorChange();
};

window.onFormSectorChange = function () {
  const sectorId = document.getElementById('fSector').value;
  const deptId = document.getElementById('fDept').value;
  const fPosition = document.getElementById('fPosition');
  if (!fPosition) return;

  const currentPosVal = fPosition.value;
  let posData = [];

  // Build positions dropdown options based on dept/sector selection
  let normalPos = domains.positions || [];

  if (portalUserRole !== 'admin') {
    normalPos = normalPos.filter(p => {
      const id = String(p.id);
      return id !== '1' && id !== '2' && id !== '3';
    });
  }

  posData = normalPos.map(p => ({ val: p.id, text: p.name }));

  populateFormCS('fcs-fPosition', posData, 'Vəzifə seçin', true);
  setFormCS('fcs-fPosition', currentPosVal || '', 'Vəzifə seçin');
};

window.onFormPositionChange = function () {
  const posId = document.getElementById('fPosition').value;
  const fSector = document.getElementById('fSector');
  if (!posId) return;

  const pos = domains.positions.find(x => String(x.id) === String(posId));
  if (pos) {
    const name = (pos.name || '').toLocaleUpperCase('az');
    if (!name.includes('SEKTOR MÜDİR') && fSector && fSector.value) {
      setFormCS('fcs-fSector', '', 'Sektor seçin');
    }
  }
};

async function saveEmployee() {
  const saveBtn = document.getElementById('saveEmpBtn');
  if (saveBtn && saveBtn.disabled) return; // already running, ignore double-click
  if (saveBtn) { saveBtn.disabled = true; saveBtn.style.opacity = '0.6'; }

  const name = document.getElementById('fName').value.trim();
  const position_id = document.getElementById('fPosition').value;
  const dept_id = document.getElementById('fDept').value;
  const sector_id = document.getElementById('fSector').value;
  const email = document.getElementById('fEmail').value.trim();
  const intPhone = document.getElementById('fIntPhone').value.trim();
  const mobileRaw = document.getElementById('fMobile').value.trim();
  const mobile = mobileRaw ? '+994 ' + mobileRaw : '';
  const room = document.getElementById('fRoom').value.trim();
  const fCarPlate = document.getElementById('fCarPlate');
  const car_plate = fCarPlate ? fCarPlate.value.trim() : '';

  const enableBtn = () => { if (saveBtn) { saveBtn.disabled = false; saveBtn.style.opacity = ''; } };

  if (!name || !position_id) {
    showToast('Ad Soyad və Vəzifə məcburidir!');
    enableBtn();
    return;
  }

  const data = { name, position_id, dept_id: dept_id || null, sector_id: sector_id || null, email: email || '', intphone: intPhone || null, mobile: mobile || null, room: room || null, car_plate: car_plate || null };

  if (editRequestMode && editingId) {
    await saveEditRequest(data);
    enableBtn();
    return;
  }

  // Non-admin trying to add a completely NEW employee → send as approval request
  if (portalUserRole !== 'admin' && !editingId) {
    await saveNewEmployeeRequest(data);
    enableBtn();
    return;
  }

  try {
    if (editingId) {
      const res = await fetch(`${API_URL}/employees/${editingId}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(data) });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || 'Update failed');
      }
      const updated = await res.json();
      const idx = employees.findIndex(x => String(x.id) === String(editingId));
      if (idx !== -1) employees[idx] = updated;
      showToast('Məlumatlar yenilendi ✓');
      closeModal('formModal');
      render();
    } else {
      const res = await fetch(`${API_URL}/employees`, { method: 'POST', headers: HEADERS, body: JSON.stringify(data) });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.details || 'Insert failed');
      }
      const created = await res.json();
      employees.push(created);
      showToast('Əməkdaş əlavə edildi ✓');
      closeModal('formModal');
      render();
    }
  } catch (err) {
    showToast(err.message || 'Yadda saxlayarkən xəta baş verdi');
    console.error(err);
    await fetchEmployees();
  } finally {
    enableBtn();
  }
}


/* ─── USER EDIT REQUEST ─── */
async function saveEditRequest(newData) {
  try {
    const payload = {
      employee_id: editingId,
      employee_name: editRequestOriginalData ? editRequestOriginalData.name : '',
      old_data: editRequestOriginalData,
      new_data: newData,
      status: 'pending',
      requested_by: portalUserName
    };
    const res = await fetch(`${API_URL}/employee_edit_requests`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Request failed');
    showToast('Redəktə sorğunuz adminə göndərildi ✓');
    closeModal('formModal');
    editRequestMode = false;
    editRequestOriginalData = null;
  } catch (err) {
    showToast('Sorğu göndərilərkən xəta baş verdi');
    console.error(err);
  }
}

/* ─── NEW EMPLOYEE REQUEST (User → Admin) ─── */
async function saveNewEmployeeRequest(data) {
  try {
    const payload = {
      employee_id: null,
      employee_name: data.name,
      old_data: null,
      new_data: data,
      status: 'pending',
      requested_by: portalUserName,
      request_type: 'new_employee'
    };
    const res = await fetch(`${API_URL}/employee_edit_requests`, {
      method: 'POST', headers: HEADERS, body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Request failed');
    showToast('Yeni əməkdaş sorğunuz adminə göndərildi ✓');
    closeModal('formModal');
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast('Sorğu göndərilərkən xəta baş verdi');
    console.error(err);
  }
}

async function deleteEmp(id) {
  if (!confirm('Bu əməkdaşı silmək istədiyinizə əminsiniz?')) return;
  try {
    const res = await fetch(`${API_URL}/employees/${id}`, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) throw new Error('Delete failed');
    employees = employees.filter(x => String(x.id) !== String(id));
    showToast('Əməkdaş silindi');
    render();
  } catch (err) {
    showToast('Silinərkən xəta baş verdi');
    console.error(err);
    await fetchEmployees();
  }
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  const msgEl = document.getElementById('toastMsg');
  const dotEl = t.querySelector('.toast-dot');
  
  if (msgEl) msgEl.textContent = msg;

  if (type === 'error') {
    t.classList.add('error');
    if (dotEl) {
      dotEl.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/></svg>`;
    }
  } else {
    t.classList.remove('error');
    if (dotEl) {
      dotEl.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`;
    }
  }

  t.classList.add('show');
  if (t._timeout) clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
}


/* ─── EDIT REQUEST SYSTEM (ADMIN PANEL) ─── */
async function fetchPendingRequestsCount() {
  if (portalUserRole !== 'admin') return;
  try {
    const res = await fetch(`${API_URL}/employee_edit_requests/count?status=pending`, { headers: HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    const count = data.count || 0;
    const badge = document.getElementById('reqBadge');
    if (badge) {
      if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
      else { badge.style.display = 'none'; }
    }
  } catch (err) {
    console.error(err);
  }
}

async function fetchRequestsPageData() {
  try {
    const editRes = await fetch(`${API_URL}/employee_edit_requests?status=pending`, { headers: HEADERS });
    if (!editRes.ok) throw new Error('Fetch edit requests failed');
    const allPending = await editRes.json();

    // Split by request type
    const editRequests = allPending.filter(r => !r.request_type || r.request_type === 'edit');
    const newEmpRequests = allPending.filter(r => r.request_type === 'new_employee');

    const usersRes = await fetch(`${API_URL}/portal_users`, { headers: HEADERS });
    if (!usersRes.ok) throw new Error('Fetch users failed');
    const users = await usersRes.json();

    renderEditRequestsTable(editRequests);
    renderNewEmployeeRequestsTable(newEmpRequests);
    renderUsersTable(users);
  } catch (err) {
    showToast('Məlumatlar yüklənərkən xəta baş verdi');
    console.error(err);
  }
}

function renderEditRequestsTable(list) {
  const tb = document.getElementById('editRequestsTableBody');
  if (!tb) return;
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">Gözləyən məlumat dəyişikliyi sorğusu yoxdur</td></tr>`;
    return;
  }

  const getDeptName = (id) => { const d = domains.departments.find(x => String(x.id) === String(id)); return d ? d.name : '—'; };
  const getSectorName = (id) => { const s = domains.sectors.find(x => String(x.id) === String(id)); return s ? s.name : '—'; };
  const getPosName = (id) => { const p = domains.positions.find(x => String(x.id) === String(id)); return p ? p.name : '—'; };

  const getValLabel = (key, val) => {
    if (!val) return '—';
    if (key === 'dept_id') return getDeptName(val);
    if (key === 'sector_id') return getSectorName(val);
    if (key === 'position_id') return getPosName(val);
    return val;
  };

  tb.innerHTML = list.map(req => {
    const oldD = req.old_data || {};
    const newD = req.new_data || {};

    const fieldLabels = {
      name: 'Ad',
      position_id: 'Vəzifə', position: 'Vəzifə',
      dept_id: 'Şöbə', dept: 'Şöbə',
      sector_id: 'Sektor', sektor: 'Sektor',
      email: 'Email', intphone: 'Daxili Tel', mobile: 'Mobil', room: 'Otaq', car_plate: 'Maşın №'
    };

    const changes = Object.keys(fieldLabels).filter(k => {
      const oldV = String(oldD[k] || '');
      const newV = String(newD[k] || '');
      return oldV !== newV;
    });

    const changesHtml = changes.length
      ? changes.map(k => `<span style="display:inline-block;background:#FFF8E7;border:1px solid #F59E0B;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>${fieldLabels[k]}:</b> <s style="color:#999">${getValLabel(k, oldD[k])}</s> → <b style="color:var(--success)">${getValLabel(k, newD[k])}</b></span>`).join(' ')
      : '<em style="color:#999">Dəyişiklik yoxdur</em>';
    const dateStr = new Date(req.requested_at).toLocaleString('az-AZ');
    const newDataEncoded = encodeURIComponent(JSON.stringify(newD));
    return `<tr>
      <td><strong>${req.employee_name || '—'}</strong></td>
      <td>${changesHtml}</td>
      <td>${req.requested_by || '—'}</td>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="text-align:right">
        <div class="card-acts" style="justify-content:flex-end">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;background:var(--success);box-shadow:none" onclick="approveEditRequest(${req.id}, ${req.employee_id}, '${newDataEncoded}')">Təsdiqlə</button>
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="rejectEditRequest(${req.id})">Rədd et</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderNewEmployeeRequestsTable(list) {
  const tb = document.getElementById('newEmpRequestsTableBody');
  if (!tb) return;
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">Gözləyən yeni əməkdaş əlavəsi sorğusu yoxdur</td></tr>`;
    return;
  }

  const getDeptName = (id) => { const d = domains.departments.find(x => String(x.id) === String(id)); return d ? d.name : '—'; };
  const getSectorName = (id) => { const s = domains.sectors.find(x => String(x.id) === String(id)); return s ? s.name : '—'; };
  const getPosName = (idVal) => {
    if (!idVal) return '—';
    const p = domains.positions.find(x => String(x.id) === String(idVal));
    return p ? p.name : '—';
  };

  const getOtherDetailsHtml = (d) => {
    const details = [];
    if (d.email) details.push(`<span style="display:inline-block;background:#F0FDF4;border:1px solid #10B981;color:#047857;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Email:</b> ${d.email}</span>`);
    if (d.mobile) details.push(`<span style="display:inline-block;background:#EFF6FF;border:1px solid #3B82F6;color:#1D4ED8;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Mobil:</b> ${d.mobile}</span>`);
    if (d.intphone) details.push(`<span style="display:inline-block;background:#F5F3FF;border:1px solid #8B5CF6;color:#6D28D9;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Daxili:</b> ${d.intphone}</span>`);
    if (d.room) details.push(`<span style="display:inline-block;background:#FFF7ED;border:1px solid #F97316;color:#C2410C;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Otaq:</b> ${d.room}</span>`);
    if (d.car_plate) details.push(`<span style="display:inline-block;background:#F1F5F9;border:1px solid #64748B;color:#334155;border-radius:5px;padding:2px 7px;font-size:11px;margin:2px"><b>Maşın №:</b> ${d.car_plate}</span>`);
    return details.length ? details.join(' ') : '<em style="color:#999">—</em>';
  };

  tb.innerHTML = list.map(req => {
    const d = req.new_data || {};
    const dateStr = new Date(req.requested_at).toLocaleString('az-AZ');
    return `<tr>
      <td><strong>${d.name || '—'}</strong></td>
      <td>${getPosName(d.position_id)}</td>
      <td><span class="dept-chip" style="margin:0">${getDeptName(d.dept_id)}</span></td>
      <td>${getSectorName(d.sector_id)}</td>
      <td>${getOtherDetailsHtml(d)}</td>
      <td>${req.requested_by || '—'}</td>
      <td style="white-space:nowrap">${dateStr}</td>
      <td style="text-align:right">
        <div class="card-acts" style="justify-content:flex-end">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;background:var(--success);box-shadow:none" onclick="approveNewEmployeeRequest(${req.id})">Təsdiqlə</button>
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:var(--danger);border-color:var(--danger)" onclick="rejectEditRequest(${req.id})">Rədd et</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderUsersTable(users) {
  const tb = document.getElementById('usersTableBody');
  if (!tb) return;
  if (!users || !users.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">İstifadəçi tapılmadı</td></tr>`;
    return;
  }
  tb.innerHTML = users.map(u => `<tr>
    <td><strong>${u.username}</strong></td>
    <td>${u.email || '—'}</td>
    <td><span class="dept-chip" style="margin:0;background:${u.role === 'admin' ? 'rgba(79,70,229,0.1)' : 'rgba(16,185,129,0.1)'};color:${u.role === 'admin' ? 'var(--accent)' : 'var(--success)'}">${u.role === 'admin' ? 'Admin' : 'İstifadəçi'}</span></td>
    <td style="letter-spacing:2px;color:var(--text-muted)">••••••••</td>
    <td style="text-align:right">
      <button class="act-btn" style="display:inline-flex" onclick="openDirectPassModal(${u.id}, '${u.username}')" title="Şifrəni Dəyiş">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1m0 0a2 2 0 114 0m-4 0v5"/></svg>
      </button>
    </td>
  </tr>`).join('');
}

async function approveNewEmployeeRequest(reqId) {
  if (!confirm('Bu yeni əməkdaş sorğusunu təsdiqləyirsiniz? Əməkdaş sisteme əlavə ediləcək.')) return;
  try {
    const r = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS,
      body: JSON.stringify({ status: 'approved', resolved_at: new Date().toISOString() })
    });
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(errData.error || 'Approval failed');
    }
    showToast('Sorğu təsdiqlendi, əməkdaş əlavə edildi ✓');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
    await fetchEmployees();
  } catch (err) {
    showToast('Təsdiqləyərkən xəta baş verdi');
    console.error(err);
  }
}

function renderUsersTable(list) {
  const tb = document.getElementById('usersTableBody');
  if (!list || !list.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">İstifadəçi tapılmadı</td></tr>`;
    return;
  }
  tb.innerHTML = list.map(u => {
    return `<tr>
      <td>${u.username}</td>
      <td>${u.email}</td>
      <td><span class="dept-chip" style="background:${u.role === 'admin' ? 'rgba(79,70,229,0.1)' : 'rgba(16,185,129,0.1)'}; color:${u.role === 'admin' ? 'var(--accent)' : 'var(--success)'}">${u.role === 'admin' ? 'Admin' : 'İstifadəçi'}</span></td>
      <td style="font-family:monospace">${u.password}</td>
      <td style="text-align:right">
        <button class="act-btn" style="display:inline-flex" onclick="openDirectPassModal(${u.id}, '${u.username}')" title="Şifrəni Dəyiş">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1m0 0a2 2 0 114 0m-4 0v5"/></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

async function approveEditRequest(reqId, employeeId, newDataEncoded) {
  if (!confirm('Bu redəktə sorğusunu təsdiqləyirsiniz? Əməkdaş məlumatları yenilənəcək.')) return;
  try {
    const newData = JSON.parse(decodeURIComponent(newDataEncoded));
    const r1 = await fetch(`${API_URL}/employees/${employeeId}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(newData)
    });
    if (!r1.ok) throw new Error('Employee update failed');
    const r2 = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify({ status: 'approved', resolved_at: new Date().toISOString() })
    });
    if (!r2.ok) throw new Error('Request update failed');
    showToast('Sorğu təsdiqlendi, məlumatlar yenilendi ✓');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
    await fetchEmployees();
  } catch (err) {
    showToast('Təsdiqləyərkən xəta baş verdi');
    console.error(err);
  }
}

async function rejectEditRequest(reqId) {
  if (!confirm('Bu sorğunu rədd etmək istəyirsiniz?')) return;
  try {
    const res = await fetch(`${API_URL}/employee_edit_requests/${reqId}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify({ status: 'rejected', resolved_at: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('Reject failed');
    showToast('Sorğu rədd edildi');
    await fetchRequestsPageData();
    await fetchPendingRequestsCount();
  } catch (err) {
    showToast('Rədd edilərkən xəta baş verdi');
    console.error(err);
  }
}

function openDirectPassModal(userId, username) {
  document.getElementById('directPassUserId').value = userId;
  document.getElementById('directPassTitle').textContent = `${username} — Şifrəni Dəyiş`;
  document.getElementById('directPassInput').value = '';
  document.getElementById('directPassModal').classList.add('open');
}

async function saveDirectPassword() {
  const userId = document.getElementById('directPassUserId').value;
  const newPass = document.getElementById('directPassInput').value.trim();
  if (!newPass) { showToast('Yeni şifrəni daxil edin!'); return; }

  try {
    const res = await fetch(`${API_URL}/portal_users/${userId}`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ password: newPass }) });
    if (!res.ok) throw new Error('Update password failed');

    showToast('Şifrə birbaşa yeniləndi ✓');
    closeModal('directPassModal');
    await fetchRequestsPageData();
  } catch (err) {
    showToast('Şifrə yenilənərkən xəta baş verdi');
    console.error(err);
  }
}

/* ─── DOMAIN MANAGEMENT SYSTEM (ADMIN PANEL) ─── */

function getDomainPosLinkType() {
  const el = document.querySelector('input[name="domainPosLinkType"]:checked');
  return el ? el.value : 'sector';
}

function setDomainPosLinkType(type) {
  const radio = document.querySelector(`input[name="domainPosLinkType"][value="${type}"]`);
  if (radio) radio.checked = true;
  updateDomainPosLinkUI();
}

window.onDomainPosLinkTypeChange = function () {
  updateDomainPosLinkUI();
};

function updateDomainPosLinkUI() {
  const linkGroup = document.getElementById('domainPosLinkTypeGroup');
  if (!linkGroup || linkGroup.style.display === 'none') return;
  const linkType = getDomainPosLinkType();
  document.getElementById('domainParentDeptGroup').style.display = linkType === 'dept' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = linkType === 'sector' ? 'block' : 'none';
}

function populateDomainParentField(kind, options, placeholder) {
  const csId = kind === 'dept' ? 'fcs-domainDept' : 'fcs-domainSector';
  const csEl = document.getElementById(csId);
  if (csEl) {
    populateFormCS(csId, options, null, true);
    setFormCS(csId, '', placeholder);
    return;
  }
  const sel = document.getElementById(kind === 'dept' ? 'domainParentDeptSelect' : 'domainParentSectorSelect');
  if (sel && sel.tagName === 'SELECT') {
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      options.map(o => `<option value="${o.val}">${o.text}</option>`).join('');
    sel.value = '';
  }
}

function setDomainParentFieldValue(kind, val, placeholder) {
  const csId = kind === 'dept' ? 'fcs-domainDept' : 'fcs-domainSector';
  const csEl = document.getElementById(csId);
  const list = kind === 'dept' ? domains.departments : domains.sectors;
  const match = list.find(x => String(x.id) === String(val));
  if (csEl) {
    setFormCS(csId, val || '', match ? match.name : placeholder);
    return;
  }
  const sel = document.getElementById(kind === 'dept' ? 'domainParentDeptSelect' : 'domainParentSectorSelect');
  if (sel) sel.value = val || '';
}

function renderDomainsPage() {
  const deptTable = document.getElementById('domainDeptTableBody');
  if (deptTable) {
    deptTable.innerHTML = domains.departments.map(d => `
      <tr>
        <td><strong>${d.name}</strong></td>
        <td style="text-align:right">
          <div class="card-acts" style="justify-content:flex-end">
            <button class="act-btn" onclick="openEditDomainModal('dept', ${d.id}, '${d.name.replace(/'/g, "\\'")}')"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
            <button class="act-btn red" onclick="deleteDomain('dept', ${d.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  const sectorTable = document.getElementById('domainSectorTableBody');
  if (sectorTable) {
    sectorTable.innerHTML = domains.sectors.map(s => {
      const parentDept = domains.departments.find(d => String(d.id) === String(s.dept_id));
      return `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td><span class="dept-chip" style="margin:0">${parentDept ? parentDept.name : '—'}</span></td>
          <td style="text-align:right">
            <div class="card-acts" style="justify-content:flex-end">
              <button class="act-btn" onclick="openEditDomainModal('sector', ${s.id}, '${s.name.replace(/'/g, "\\'")}', ${s.dept_id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
              <button class="act-btn red" onclick="deleteDomain('sector', ${s.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  const posTable = document.getElementById('domainPosTableBody');
  if (posTable) {
    const allSysPositions = ["DİREKTOR", "ŞÖBƏ MÜDİRİ", "ŞÖBƏ MÜDİRİ MÜAVİNİ", "SEKTOR MÜDİRİ"];

    posTable.innerHTML = domains.positions
      .filter(p => !allSysPositions.includes((p.name || '').toLocaleUpperCase('az')))
      .map(p => {
        const activeUsage = employees.filter(e => String(e.position_id) === String(p.id));
        const usedIn = [...new Set(activeUsage.map(e => e.sector_name ? `Sektor: ${e.sector_name}` : (e.dept_name ? `Şöbə: ${e.dept_name}` : '')).filter(Boolean))];
        const parentLabel = usedIn.length ? usedIn.join(', ') : 'İstifadə edilmir';
        const isSystem = allSysPositions.includes((p.name || '').toLocaleUpperCase('az'));
        return `
          <tr>
            <td><strong>${p.name}</strong></td>
            <td style="text-align:right">
              <div class="card-acts" style="justify-content:flex-end">
                ${isSystem ? `
                  <span title="Sistem vəzifəsi (redaktə edilə bilməz)" style="color:var(--text-muted); opacity:0.6; padding: 6px 12px; display:inline-flex; align-items:center; gap:4px; font-size:11px;">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                    Kilidli
                  </span>
                ` : `
                  <button class="act-btn" onclick="openEditDomainModal('pos', ${p.id}, '${p.name.replace(/'/g, "\\'")}')"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                  <button class="act-btn red" onclick="deleteDomain('pos', ${p.id})"><svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                `}
              </div>
            </td>
          </tr>
        `;
      }).join('');
  }
}

window.openAddDomainModal = function (type) {
  document.getElementById('domainType').value = type;
  document.getElementById('domainEditId').value = '';
  document.getElementById('domainNameInput').value = '';

  const typeTitles = { dept: 'Yeni Şöbə', sector: 'Yeni Sektor', pos: 'Yeni Vəzifə' };
  document.getElementById('domainFormTitle').textContent = typeTitles[type] || 'Domain Əlavə Et';

  document.getElementById('domainParentDeptGroup').style.display = type === 'sector' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = 'none';
  document.getElementById('domainPosLinkTypeGroup').style.display = 'none';

  if (type === 'sector') {
    populateDomainParentField('dept', domains.departments.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin');
  }

  document.getElementById('domainFormModal').classList.add('open');
};

window.openEditDomainModal = function (type, id, name, deptId, sectorId) {
  document.getElementById('domainType').value = type;
  document.getElementById('domainEditId').value = id;
  document.getElementById('domainNameInput').value = name;

  const typeTitles = { dept: 'Şöbəni Redaktə Et', sector: 'Sektoru Redaktə Et', pos: 'Vəzifəni Redaktə Et' };
  document.getElementById('domainFormTitle').textContent = typeTitles[type] || 'Domain Redaktə Et';

  document.getElementById('domainParentDeptGroup').style.display = type === 'sector' ? 'block' : 'none';
  document.getElementById('domainParentSectorGroup').style.display = 'none';
  document.getElementById('domainPosLinkTypeGroup').style.display = 'none';

  if (type === 'sector') {
    populateDomainParentField('dept', domains.departments.map(d => ({ val: d.id, text: d.name })), 'Şöbə seçin');
    setDomainParentFieldValue('dept', deptId, 'Şöbə seçin');
  }

  document.getElementById('domainFormModal').classList.add('open');
};

window.saveDomain = async function () {
  const type = document.getElementById('domainType').value;
  const id = document.getElementById('domainEditId').value;
  const name = document.getElementById('domainNameInput').value.trim();

  if (!name) { showToast('Ad sahəsi məcburidir!'); return; }

  let url = `${API_URL}/`;
  let method = id ? 'PATCH' : 'POST';
  let body = { name };

  if (type === 'dept') {
    url += `departments${id ? '/' + id : ''}`;
  } else if (type === 'sector') {
    url += `sectors${id ? '/' + id : ''}`;
    const selectedDept = document.getElementById('domainParentDeptSelect').value;
    if (!selectedDept) { showToast('Şöbə seçmək məcburidir!'); return; }
    body.dept_id = selectedDept;
  } else if (type === 'pos') {
    url += `positions${id ? '/' + id : ''}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Uğursuz əməliyyat');
    }
    showToast('Uğurla yadda saxlanıldı ✓');
    closeModal('domainFormModal');
    await fetchDomains();
    await fetchEmployees();
    if (currentPage === 'domains') renderDomainsPage();
  } catch (err) {
    showToast(err.message || 'Xəta baş verdi');
    console.error(err);
  }
};

window.deleteDomain = async function (type, id) {
  if (!confirm('Bu domaini silmək istədiyinizə əminsiniz? Altındakı bütün əlaqəli məlumatlar da silinə bilər.')) return;

  let url = `${API_URL}/`;
  if (type === 'dept') url += `departments/${id}`;
  else if (type === 'sector') url += `sectors/${id}`;
  else if (type === 'pos') url += `positions/${id}`;

  try {
    const res = await fetch(url, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Silinmə uğursuz oldu');
    }
    showToast('Uğurla silindi');
    await fetchDomains();
    await fetchEmployees();
    if (currentPage === 'domains') renderDomainsPage();
  } catch (err) {
    showToast(err.message || 'Silinərkən xəta baş verdi');
    console.error(err);
  }
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.org-mobile-custom-select')) {
    document.querySelectorAll('.org-mobile-custom-select.open').forEach(el => el.classList.remove('open'));
  }
});

/* ─── IMPORT PAGE FUNCTIONS ─── */

// CSV şablonlarının strukturu
const CSV_TEMPLATES = {
  departments: {
    headers: ['id', 'name'],
    sample: [['1', 'Texniki Şöbə'], ['2', 'Maliyyə Şöbəsi']]
  },
  sectors: {
    headers: ['id', 'name', 'dept_id'],
    sample: [['1', 'Proqram Sektoru', '1'], ['2', 'Avadanlıq Sektoru', '1']]
  },
  positions: {
    headers: ['id', 'name'],
    sample: [['1', 'Mütəxəssis'], ['2', 'Aparıcı Mütəxəssis']]
  },
  employees: {
    headers: ['id', 'name', 'email', 'intphone', 'mobile', 'room', 'car_plate', 'dept_id', 'sector_id', 'position_id'],
    sample: [['1', 'Anar Həsənov', 'anar@kyltm.az', '1045', '050-123-45-67', '405', '10-AA-001', '1', '1', '1']]
  }
};

// Cədvəl adından UI suffix almaq
function tableKey(tableName) {
  const map = { departments: 'Dept', sectors: 'Sector', positions: 'Pos', employees: 'Emp' };
  return map[tableName] || '';
}

// Fayl seçildikdə
window.handleFileSelect = function(event, tableName) {
  const file = event.target.files[0];
  if (!file) return;
  processImportFile(file, tableName);
};

// Drag over
window.handleDragOver = function(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
};

// Drag leave
window.handleDragLeave = function(event) {
  event.currentTarget.classList.remove('drag-over');
};

// Drop
window.handleDrop = function(event, tableName) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    showToast('Yalnız .csv formatında fayl qəbul edilir!', 'error');
    return;
  }
  processImportFile(file, tableName);
};

// Faylı oxuyub preview göstər
function processImportFile(file, tableName) {
  const key = tableKey(tableName);
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    const rows = parseCsvText(content);
    if (!rows || rows.length === 0) {
      showToast('CSV faylı boş və ya oxuna bilən məlumat yoxdur!', 'error');
      return;
    }

    // File info göstər
    const fileInfoEl = document.getElementById('fileInfo' + key);
    if (fileInfoEl) {
      fileInfoEl.innerHTML = `
        <div class="import-file-badge">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <span><strong>${file.name}</strong> — ${rows.length} sətir tapıldı</span>
        </div>
      `;
      fileInfoEl.style.display = '';
    }

    // Preview göstər (ilk 5 sətir)
    const previewEl = document.getElementById('preview' + key);
    if (previewEl) {
      previewEl.innerHTML = buildPreviewTable(rows, 5);
      previewEl.style.display = '';
    }

    // Actions göstər
    const actionsEl = document.getElementById('actions' + key);
    if (actionsEl) actionsEl.style.display = '';

    // Result sıfırla
    const resultEl = document.getElementById('result' + key);
    if (resultEl) resultEl.innerHTML = '';

    // Dropzone yeniləyin
    const dropzone = document.getElementById('dropzone' + key);
    if (dropzone) dropzone.classList.add('has-file');

    // Faylı data-attr-da saxla
    const dropzoneEl = document.getElementById('dropzone' + key);
    if (dropzoneEl) {
      dropzoneEl._csvRows = rows;
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// CSV mətn → [{col: val, ...}] massivi
function parseCsvText(content) {
  const lines = content.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (!vals.length) continue;
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Preview cədvəlini qur
function buildPreviewTable(rows, maxRows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const displayRows = rows.slice(0, maxRows);
  const moreCount = rows.length - displayRows.length;

  let html = `<div class="import-preview-label">Önizləmə (ilk ${displayRows.length} sətir${moreCount > 0 ? ` + ${moreCount} daha` : ''}):</div>`;
  html += '<div class="import-preview-scroll"><table class="import-preview-table"><thead><tr>';
  headers.forEach(h => { html += `<th>${h}</th>`; });
  html += '</tr></thead><tbody>';
  displayRows.forEach(row => {
    html += '<tr>';
    headers.forEach(h => { html += `<td>${row[h] || ''}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// Import çalışdır
window.runImport = async function(tableName) {
  const key = tableKey(tableName);
  const dropzoneEl = document.getElementById('dropzone' + key);
  const rows = dropzoneEl ? dropzoneEl._csvRows : null;

  if (!rows || rows.length === 0) {
    showToast('İdxal üçün məlumat tapılmadı!', 'error');
    return;
  }

  const resultEl = document.getElementById('result' + key);
  if (resultEl) {
    resultEl.innerHTML = `<div class="import-result-loading"><span class="import-spinner"></span> İdxal edilir... (${rows.length} sətir)</div>`;
  }

  // Düymələri deaktiv et
  const actionsEl = document.getElementById('actions' + key);
  const btns = actionsEl ? actionsEl.querySelectorAll('button') : [];
  btns.forEach(b => { b.disabled = true; });

  try {
    const res = await fetch(`${API_URL}/import/${tableName}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ rows })
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    if (resultEl) {
      resultEl.innerHTML = `
        <div class="import-result-success">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
          </svg>
          <span>Uğurlu! <strong>${data.imported}</strong> sətir idxal edildi${data.skipped ? `, <strong>${data.skipped}</strong> ötürüldü` : ''}.</span>
        </div>
      `;
    }

    showToast(`${tableName} idxalı uğurla tamamlandı ✓`, 'success');

    // Domenləri və əməkdaşları yenilə
    await fetchDomains();
    if (tableName === 'employees') await fetchEmployees();

  } catch (err) {
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="import-result-error">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
          <span>Xəta: ${err.message}</span>
        </div>
      `;
    }
    showToast('İdxal zamanı xəta baş verdi!', 'error');
    console.error('Import error:', err);
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
};

// Import sıfırla
window.clearImport = function(tableName) {
  const key = tableKey(tableName);
  const dropzoneEl = document.getElementById('dropzone' + key);
  if (dropzoneEl) {
    dropzoneEl._csvRows = null;
    dropzoneEl.classList.remove('has-file', 'drag-over');
  }
  ['fileInfo', 'preview', 'actions', 'result'].forEach(prefix => {
    const el = document.getElementById(prefix + key);
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  });
  // File input sıfırla
  const fileInputMap = { Dept: 'fileDept', Sector: 'fileSector', Pos: 'filePos', Emp: 'fileEmp' };
  const fileInput = document.getElementById(fileInputMap[key]);
  if (fileInput) fileInput.value = '';
};

// Şablon yüklə
window.downloadTemplate = function(tableName) {
  const tpl = CSV_TEMPLATES[tableName];
  if (!tpl) return;

  const csvContent = [
    tpl.headers.join(','),
    ...tpl.sample.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tableName}_sablon.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${tableName} şablonu yükləndi ✓`, 'success');
};

// Bütün bazanı Export etmək
window.exportAllTables = async function() {
  const tables = ['departments', 'sectors', 'positions', 'employees'];
  showToast('Bütün cədvəllərin exportu başladılır...', 'success');
  
  for (const table of tables) {
    try {
      const res = await fetch(`${API_URL}/export/${table}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = `${table}_export_${date}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        console.error(`Export failed for ${table}:`, await res.text());
        showToast(`${table} cədvəlini export edərkən xəta oldu.`, 'error');
      }
    } catch (err) {
      console.error(`Export error for ${table}:`, err);
    }
    // Kiçik gecikmə ki, browser ardıcıl downloadları bloklamasın
    await new Promise(resolve => setTimeout(resolve, 800));
  }
};
