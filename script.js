let members = [];
let attendance = [];
let leaderPasscodeHash = null;
let leaderUnlocked = false;
let rosterFilter = 'All';
const todayStr = () => new Date().toISOString().slice(0,10);

// ---- PWA: service worker + install prompt ----
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.error('sw register failed', e));
  });
}

let deferredInstallPrompt = null;
const installRow = document.getElementById('install-row');
const installDivider = document.getElementById('install-divider');
const installBtn = document.getElementById('install-btn');

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  if(!isStandalone()){
    installRow.style.display = 'flex';
    installDivider.style.display = 'block';
  }
});

if(installBtn){
  installBtn.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installRow.style.display = 'none';
    installDivider.style.display = 'none';
  });
}

window.addEventListener('appinstalled', ()=>{
  installRow.style.display = 'none';
  installDivider.style.display = 'none';
  deferredInstallPrompt = null;
});

// iOS Safari has no beforeinstallprompt — show "Add to Home Screen" instructions instead.
(function iosInstallHint(){
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isIos && !isStandalone() && installRow){
    installRow.style.display = 'flex';
    installDivider.style.display = 'block';
    installBtn.textContent = 'How to install';
    installBtn.addEventListener('click', ()=>{
      alert('To install: tap the Share icon in Safari, then "Add to Home Screen".');
    });
  }
})();

// ---- Theme toggle (per-device preference, not shared church data) ----
function applyTheme(theme){
  document.body.classList.toggle('light-theme', theme === 'light');
  const checkbox = document.getElementById('theme-toggle-checkbox');
  if(checkbox) checkbox.checked = (theme === 'dark');
}
(function initTheme(){
  let saved = 'light';
  try{ saved = localStorage.getItem('theme-preference') || 'light'; }catch(e){}
  applyTheme(saved);
})();
document.getElementById('theme-toggle-checkbox').addEventListener('change', (e)=>{
  const next = e.target.checked ? 'dark' : 'light';
  try{ localStorage.setItem('theme-preference', next); }catch(e){}
  applyTheme(next);
});

// ---- Header dropdown menu ----
const menuToggle = document.getElementById('menu-toggle');
const dropdownMenu = document.getElementById('dropdown-menu');
menuToggle.addEventListener('click', (e)=>{
  e.stopPropagation();
  dropdownMenu.classList.toggle('show');
});
document.addEventListener('click', (e)=>{
  if(!dropdownMenu.contains(e.target) && e.target !== menuToggle){
    dropdownMenu.classList.remove('show');
  }
});

// ---- Dropdown: help panel ----
document.getElementById('help-toggle').addEventListener('click', function(){
  document.getElementById('help-panel').classList.toggle('show');
  this.classList.toggle('open');
});

// ---- Dropdown: change leader passcode ----
document.getElementById('passcode-toggle').addEventListener('click', function(){
  const panel = document.getElementById('passcode-panel');
  const opening = !panel.classList.contains('show');
  panel.classList.toggle('show');
  this.classList.toggle('open');
  if(opening){
    const msg = document.getElementById('passcode-panel-msg');
    const form = document.getElementById('passcode-change-form');
    if(leaderUnlocked){
      msg.style.display = 'none';
      form.style.display = 'block';
    }else{
      msg.style.display = 'block';
      form.style.display = 'none';
    }
  }
});
document.getElementById('save-new-passcode-btn').addEventListener('click', async ()=>{
  const val = document.getElementById('new-passcode-input').value;
  const confirmVal = document.getElementById('new-passcode-confirm').value;
  const errEl = document.getElementById('passcode-change-error');
  if(!val || val.length < 4){ errEl.textContent = 'Use at least 4 characters.'; return; }
  if(val !== confirmVal){ errEl.textContent = 'Passcodes do not match.'; return; }
  const hash = simpleHash(val);
  const ok = await savePasscode(hash);
  if(!ok){ errEl.textContent = 'Could not save. Check your connection.'; return; }
  leaderPasscodeHash = hash;
  errEl.style.color = 'var(--sage)';
  errEl.textContent = 'Passcode updated.';
  document.getElementById('new-passcode-input').value = '';
  document.getElementById('new-passcode-confirm').value = '';
});

const MINISTRIES = [
  'Pastoral Ministry','Diaconate','Administration','Prayer Ministry',
  'Praise and Worship','Media and Tech','Ushering','Discipleship',
  'Youth Ministry',"Children's Ministry",'Outreach and Missions'
];

function renderMinistryCheckboxes(containerId, prefix){
  const el = document.getElementById(containerId);
  el.innerHTML = MINISTRIES.map(m => {
    const cid = `${prefix}-${m.replace(/\s+/g,'-').toLowerCase()}`;
    return `<label><input type="checkbox" id="${cid}" value="${m}"> ${m}</label>`;
  }).join('');
}
renderMinistryCheckboxes('ministry-current-group', 'cur');
renderMinistryCheckboxes('ministry-desired-group', 'des');

function getCheckedMinistries(containerId){
  return Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map(i => i.value);
}
function setCheckedMinistries(containerId, list){
  const set = new Set((list || '').split(',').map(s=>s.trim()).filter(Boolean));
  document.querySelectorAll(`#${containerId} input`).forEach(i=>{
    i.checked = set.has(i.value);
  });
}

const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">
    <rect width="72" height="72" rx="36" fill="#2E3D5E"/>
    <circle cx="36" cy="28" r="14" fill="#93A0B8"/>
    <path d="M12 62c4-14 16-20 24-20s20 6 24 20" fill="#93A0B8"/>
  </svg>`
);

function simpleHash(str){
  let h = 0;
  for(let i=0;i<str.length;i++){ h = ((h<<5)-h+str.charCodeAt(i))|0; }
  return 'h'+Math.abs(h).toString(36);
}

function formatDateLong(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if(isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'});
}

function calcAge(birthdate){
  if(!birthdate) return null;
  const b = new Date(birthdate);
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if(m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

function buildFullName(first, mi, surname){
  const miPart = mi ? mi.replace(/\.$/,'') + '.' : '';
  return [first, miPart, surname].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
}
function checkinDisplayName(m){
  if(m.first_name && m.surname) return `${m.first_name} ${m.surname}`;
  return m.name;
}
function ageCategory(birthdate){
  const age = calcAge(birthdate);
  if(age === null) return null;
  if(age <= 24) return 'Youth';
  if(age <= 35) return 'YoungAdult';
  return 'Adult';
}
const GRADE_OPTIONS = {
  'Elementary': ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'],
  'Junior High School': ['Grade 7','Grade 8','Grade 9','Grade 10'],
  'Senior High School': ['Grade 11','Grade 12']
};
const PROGRAM_LABELS = {
  'College': 'Program / course',
  'Graduate': 'Course/program completed',
  'Vocational (TESDA)': 'TESDA course/program'
};
const PROGRAM_PLACEHOLDERS = {
  'College': 'e.g. BS in Information Technology',
  'Graduate': 'e.g. BS in Information Technology',
  'Vocational (TESDA)': 'e.g. Computer Systems Servicing NC II'
};
function updateEducationFields(){
  const level = document.getElementById('member-education-level').value;
  const gradeField = document.getElementById('edu-grade-field');
  const programField = document.getElementById('edu-program-field');
  const yearWrapper = document.getElementById('edu-year-wrapper');
  const programLabel = document.getElementById('edu-program-label');
  const gradeSelect = document.getElementById('member-grade-level');
  const programInput = document.getElementById('member-college-program');

  gradeField.classList.remove('show');
  programField.classList.remove('show');

  if(GRADE_OPTIONS[level]){
    gradeField.classList.add('show');
    const prevGrade = gradeSelect.value;
    gradeSelect.innerHTML = GRADE_OPTIONS[level].map(g => `<option>${g}</option>`).join('');
    if(GRADE_OPTIONS[level].includes(prevGrade)) gradeSelect.value = prevGrade;
  }else if(PROGRAM_LABELS[level]){
    programField.classList.add('show');
    yearWrapper.style.display = (level === 'College') ? 'block' : 'none';
    programLabel.textContent = PROGRAM_LABELS[level];
    programInput.placeholder = PROGRAM_PLACEHOLDERS[level] || '';
  }
}
document.getElementById('member-education-level').addEventListener('change', updateEducationFields);

function toggleBaptismDateField(){
  const checked = document.getElementById('member-baptized').checked;
  document.getElementById('baptism-date-field').style.display = checked ? 'block' : 'none';
}
document.getElementById('member-baptized').addEventListener('change', toggleBaptismDateField);

// ---- Supabase data layer ----
async function loadData(){
  try{
    const { data, error } = await window.db.from('members').select('*').order('name');
    if(error) throw error;
    members = (data || []).map(m => ({
      id: m.id, name: m.name, birthdate: m.birthdate || '',
      first_name: m.first_name || '', middle_initial: m.middle_initial || '', surname: m.surname || '',
      ministry: m.ministry || '', photo_url: m.photo_url || '',
      member_type: m.member_type || 'Member',
      status: m.status || 'Active',
      is_scholar: !!m.is_scholar,
      is_baptized: !!m.is_baptized,
      baptism_date: m.baptism_date || '',
      education_level: m.education_level || '',
      grade_level: m.grade_level || '',
      college_year: m.college_year || '',
      college_program: m.college_program || '',
      talents_skills: m.talents_skills || '',
      desired_ministry: m.desired_ministry || '',
      cellphone: m.cellphone || '', email: m.email || '',
      facebook: m.facebook || '', instagram: m.instagram || ''
    }));
  }catch(e){ console.error('load members failed', e); members = []; }

  try{
    const { data, error } = await window.db.from('attendance').select('*');
    if(error) throw error;
    attendance = (data || []).map(r => ({ memberId: r.member_id, date: r.date, timestamp: r.ts }));
  }catch(e){ console.error('load attendance failed', e); attendance = []; }

  try{
    const { data, error } = await window.db.from('app_settings')
      .select('value').eq('key','leader-passcode').maybeSingle();
    if(error) throw error;
    leaderPasscodeHash = data ? data.value : null;
  }catch(e){ leaderPasscodeHash = null; }
}

async function upsertMember(member){
  try{
    const { error } = await window.db.from('members').upsert({
      id: member.id,
      name: member.name,
      first_name: member.first_name || null,
      middle_initial: member.middle_initial || null,
      surname: member.surname || null,
      birthdate: member.birthdate || null,
      ministry: member.ministry,
      photo_url: member.photo_url || null,
      member_type: member.member_type || 'Member',
      status: member.status || 'Active',
      is_scholar: !!member.is_scholar,
      is_baptized: !!member.is_baptized,
      baptism_date: member.baptism_date || null,
      education_level: member.education_level || null,
      grade_level: member.grade_level || null,
      college_year: member.college_year || null,
      college_program: member.college_program || null,
      talents_skills: member.talents_skills || null,
      desired_ministry: member.desired_ministry || null,
      cellphone: member.cellphone || null,
      email: member.email || null,
      facebook: member.facebook || null,
      instagram: member.instagram || null
    });
    if(error) throw error;
    return true;
  }catch(e){ console.error('save member failed', e); return false; }
}

async function deleteMemberRow(id){
  try{
    const { error } = await window.db.from('members').delete().eq('id', id);
    if(error) throw error;
    return true;
  }catch(e){ console.error('delete member failed', e); return false; }
}

async function insertAttendance(memberId, date, ts){
  try{
    const { error } = await window.db.from('attendance').insert({ member_id: memberId, date, ts });
    if(error) throw error;
    return true;
  }catch(e){ console.error('save attendance failed', e); return false; }
}

async function deleteAttendance(memberId, date){
  try{
    const { error } = await window.db.from('attendance').delete().eq('member_id', memberId).eq('date', date);
    if(error) throw error;
    return true;
  }catch(e){ console.error('remove attendance failed', e); return false; }
}

async function savePasscode(hash){
  try{
    const { error } = await window.db.from('app_settings').upsert({ key: 'leader-passcode', value: hash });
    if(error) throw error;
    return true;
  }catch(e){ console.error('save passcode failed', e); return false; }
}

async function uploadPhoto(file, memberId){
  try{
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${memberId}_${Date.now()}.${ext}`;
    const { error } = await window.db.storage.from('member-photos').upload(path, file, { upsert: true });
    if(error) throw error;
    const { data } = window.db.storage.from('member-photos').getPublicUrl(path);
    return data.publicUrl;
  }catch(e){ console.error('photo upload failed', e); return null; }
}

function isCheckedIn(memberId, date){
  return attendance.some(r => r.memberId === memberId && r.date === date);
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ---- Tabs ----
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    if(btn.dataset.view === 'checkin') gateCheckin();
    if(btn.dataset.view === 'roster') gateRoster();
    if(btn.dataset.view === 'dashboard') gateDashboard();
    updateSidebarVisibility();
  });
});

// ---- Check-in view ----
// ---- Sidebar: recent check-ins ----
function renderSidebar(){
  const recentEl = document.getElementById('recent-checkins');
  if(!recentEl) return;

  const today = todayStr();
  const todayRecords = attendance.filter(r => r.date === today);

  const recent = todayRecords
    .slice()
    .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 8);

  if(recent.length === 0){
    recentEl.innerHTML = '<div class="empty" style="padding:12px 0;">No check-ins yet today.</div>';
    return;
  }

  recentEl.innerHTML = recent.map(r=>{
    const m = members.find(x => x.id === r.memberId);
    const name = m ? checkinDisplayName(m) : 'Unknown';
    const timeStr = r.timestamp
      ? new Date(r.timestamp).toLocaleTimeString('en-PH', {hour:'numeric', minute:'2-digit'})
      : '';
    return `
      <div class="recent-checkin-row">
        <span class="recent-checkin-name">${escapeHtml(name)}</span>
        <span class="recent-checkin-time">${timeStr}</span>
      </div>
    `;
  }).join('');
}

function renderCheckin(){
  renderSidebar();
  const label = document.getElementById('today-label');
  label.textContent = new Date().toLocaleDateString('en-PH', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  const q = document.getElementById('checkin-search').value.trim().toLowerCase();
  const grid = document.getElementById('checkin-grid');
  grid.innerHTML = '';
  const today = todayStr();

  const emptyState = (message)=> `
    <div class="empty-state">
      <img src="images/emmanuelBlack.jpg" alt="" class="empty-logo empty-logo-light">
      <img src="images/emmanuelWhiteremove.jpg" alt="" class="empty-logo empty-logo-dark">
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
    </div>
  `;

  if(!q){
    grid.innerHTML = emptyState();
    return;
  }

  const filtered = members.filter(m =>
    m.name.toLowerCase().includes(q) || checkinDisplayName(m).toLowerCase().includes(q)
  );
  if(members.length === 0){
    grid.innerHTML = emptyState('No members yet. Ask a leader to add the roster first.');
    return;
  }
  if(filtered.length === 0){
    grid.innerHTML = emptyState('No matching name.');
    return;
  }
  filtered.forEach(m=>{
    const checked = isCheckedIn(m.id, today);
    const displayName = checkinDisplayName(m);
    const card = document.createElement('button');
    card.className = 'member-card' + (checked ? ' checked' : '');
    card.innerHTML = `
      <img class="member-photo" src="${m.photo_url || DEFAULT_AVATAR}" alt="${escapeHtml(displayName)}"
           onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
      <p class="name">${escapeHtml(displayName)}</p>
      <p class="ministry">${escapeHtml(m.ministry || '')}</p>
      <span class="undo-hint">Tap again to undo</span>
      <span class="seal"><svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12"/><path d="M9 15l4 4 8-9" stroke="var(--gold)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    `;
    card.addEventListener('click', async ()=>{
      const alreadyChecked = isCheckedIn(m.id, today);
      if(alreadyChecked){
        if(!confirm(`Undo check-in for ${m.name}?`)) return;
        const ok = await deleteAttendance(m.id, today);
        if(ok){
          attendance = attendance.filter(r => !(r.memberId === m.id && r.date === today));
          card.classList.remove('checked','stamp-anim');
          renderSidebar();
        }else{
          alert('Could not undo check-in. Check your connection and try again.');
        }
        return;
      }
      card.classList.add('checked','stamp-anim');
      const ts = Date.now();
      const ok = await insertAttendance(m.id, today, ts);
      if(ok){
        attendance.push({memberId:m.id, date:today, timestamp:ts});
        renderSidebar();
      }else{
        card.classList.remove('checked','stamp-anim');
        alert('Could not save check-in. Check your connection and try again.');
      }
    });
    grid.appendChild(card);
  });
}
document.getElementById('checkin-search').addEventListener('input', renderCheckin);

// ---- Leader lock gate ----
function renderLockScreen(lockElId, contentElId, onUnlocked){
  const lockEl = document.getElementById(lockElId);
  const contentEl = document.getElementById(contentElId);
  contentEl.style.display = 'none';
  lockEl.style.display = 'block';
  const isSetup = !leaderPasscodeHash;
  lockEl.innerHTML = `
    <div class="lock-box">
      <p class="lock-icon">&#128274;</p>
      <h2>${isSetup ? 'Set a leader passcode' : 'Leader login'}</h2>
      <p class="lock-sub">${isSetup ? 'Create a shared passcode leaders will use to open the roster and dashboard. Anyone with this passcode can edit the roster, so share it only with your leaders.' : 'Enter the leader passcode to continue.'}</p>
      <input type="password" id="pc-input-${lockElId}" placeholder="Passcode" autocomplete="off">
      ${isSetup ? `<input type="password" id="pc-confirm-${lockElId}" placeholder="Confirm passcode" autocomplete="off">` : ''}
      <button class="btn-primary" id="pc-submit-${lockElId}">${isSetup ? 'Set passcode' : 'Unlock'}</button>
      <p class="lock-error" id="pc-error-${lockElId}"></p>
    </div>
  `;
  const submit = async ()=>{
    const val = document.getElementById(`pc-input-${lockElId}`).value;
    const errEl = document.getElementById(`pc-error-${lockElId}`);
    if(isSetup){
      const confirmVal = document.getElementById(`pc-confirm-${lockElId}`).value;
      if(!val || val.length < 4){ errEl.textContent = 'Use at least 4 characters.'; return; }
      if(val !== confirmVal){ errEl.textContent = 'Passcodes do not match.'; return; }
      const hash = simpleHash(val);
      const ok = await savePasscode(hash);
      if(!ok){ errEl.textContent = 'Could not save passcode. Check your connection.'; return; }
      leaderPasscodeHash = hash;
      leaderUnlocked = true;
      contentEl.style.display = 'block';
      lockEl.style.display = 'none';
      onUnlocked();
    }else{
      if(!val){ errEl.textContent = 'Enter the passcode.'; return; }
      if(simpleHash(val) === leaderPasscodeHash){
        leaderUnlocked = true;
        contentEl.style.display = 'block';
        lockEl.style.display = 'none';
        onUnlocked();
      }else{
        errEl.textContent = 'Incorrect passcode.';
      }
    }
  };
  document.getElementById(`pc-submit-${lockElId}`).addEventListener('click', submit);
  [`pc-input-${lockElId}`, `pc-confirm-${lockElId}`].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.addEventListener('keydown', e=>{ if(e.key === 'Enter') submit(); });
  });
}

function gateCheckin(){
  if(leaderUnlocked){
    document.getElementById('checkin-lock').style.display = 'none';
    document.getElementById('checkin-content').style.display = 'block';
    renderCheckin();
  }else{
    renderLockScreen('checkin-lock', 'checkin-content', ()=>{ renderCheckin(); updateSidebarVisibility(); });
  }
  updateSidebarVisibility();
}
function gateRoster(){
  if(leaderUnlocked){
    document.getElementById('roster-lock').style.display = 'none';
    document.getElementById('roster-content').style.display = 'block';
    renderRoster();
  }else{
    renderLockScreen('roster-lock', 'roster-content', renderRoster);
  }
}
function gateDashboard(){
  if(leaderUnlocked){
    document.getElementById('dashboard-lock').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';
    renderDashboard();
  }else{
    renderLockScreen('dashboard-lock', 'dashboard-content', renderDashboard);
  }
}
document.getElementById('checkin-lock-btn').addEventListener('click', ()=>{
  leaderUnlocked = false;
  gateCheckin();
});
document.getElementById('roster-lock-btn').addEventListener('click', ()=>{
  leaderUnlocked = false;
  gateRoster();
});
document.getElementById('dashboard-lock-btn').addEventListener('click', ()=>{
  leaderUnlocked = false;
  gateDashboard();
});

function updateSidebarVisibility(){
  const recentCard = document.getElementById('recent-checkins-card');
  if(!recentCard) return;
  const activeBtn = document.querySelector('nav.tabs button.active');
  const activeView = activeBtn ? activeBtn.dataset.view : null;
  recentCard.style.display = (activeView === 'checkin' && leaderUnlocked) ? '' : 'none';
}

function buildEducationLine(m){
  if(!m.education_level) return '';
  if(m.education_level === 'College'){
    return `College${m.college_year ? ' &middot; ' + escapeHtml(m.college_year) : ''}${m.college_program ? ' &middot; ' + escapeHtml(m.college_program) : ''}`;
  }
  if(m.education_level === 'Graduate' || m.education_level === 'Vocational (TESDA)'){
    return `${escapeHtml(m.education_level)}${m.college_program ? ' &middot; ' + escapeHtml(m.college_program) : ''}`;
  }
  if(m.education_level === 'Alternative Learning System (ALS)'){
    return 'Alternative Learning System (ALS)';
  }
  if(m.grade_level){
    return `${escapeHtml(m.education_level)} &middot; ${escapeHtml(m.grade_level)}`;
  }
  return escapeHtml(m.education_level);
}

// ---- Roster view ----
function renderRoster(){
  const q = document.getElementById('roster-search').value.trim().toLowerCase();
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  const filtered = members.filter(m => {
    if(!m.name.toLowerCase().includes(q)) return false;
    if(rosterFilter === 'All') return true;
    if(rosterFilter === 'Scholar') return !!m.is_scholar;
    if(rosterFilter === 'Youth' || rosterFilter === 'YoungAdult' || rosterFilter === 'Adult'){
      return ageCategory(m.birthdate) === rosterFilter;
    }
    return (m.member_type || 'Member') === rosterFilter;
  });
  if(filtered.length === 0){
    list.innerHTML = '<div class="empty">No members found.</div>';
    return;
  }
  filtered.forEach(m=>{
    const age = calcAge(m.birthdate);
    const row = document.createElement('div');
    const contactBits = [m.cellphone, m.email, m.facebook, m.instagram].filter(Boolean);
    const isActive = (m.status || 'Active') === 'Active';
    row.className = 'roster-row';
    const educationLine = buildEducationLine(m);
    row.innerHTML = `
      <div class="roster-header" data-view-profile="${m.id}">
        <img class="roster-photo" src="${m.photo_url || DEFAULT_AVATAR}" alt="${escapeHtml(m.name)}"
             onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
        <div class="roster-name-block">
          <div class="name">${escapeHtml(m.name)}${m.is_scholar ? `<span class="scholar-tag ${isActive ? 'active' : 'inactive'}">Scholar</span>` : ''}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-edit="${m.id}">&#9998;</button>
          <button class="icon-btn" data-del="${m.id}">&times;</button>
        </div>
      </div>
      <div class="info">
        <div class="meta">${escapeHtml(m.member_type || 'Member')} &middot; <span class="status-text ${isActive ? 'active' : 'inactive'}">${escapeHtml(m.status || 'Active')}</span> &middot; ${age !== null ? age + ' yrs old' : 'No birthdate'} &middot; ${escapeHtml(m.ministry || 'No ministry')}</div>
        ${contactBits.length ? `<div class="meta">${contactBits.map(escapeHtml).join(' &middot; ')}</div>` : ''}
        ${educationLine ? `<div class="meta">${educationLine}</div>` : ''}
        ${m.talents_skills ? `<div class="meta">Talents: ${escapeHtml(m.talents_skills)}</div>` : ''}
        ${m.desired_ministry ? `<div class="meta">Interested in: ${escapeHtml(m.desired_ministry)}</div>` : ''}
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', (e)=>{ e.stopPropagation(); openMemberModal(b.dataset.edit); });
  });
  list.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!confirm('Remove this member from the roster?')) return;
      const ok = await deleteMemberRow(b.dataset.del);
      if(!ok){ alert('Could not delete member. Check your connection.'); return; }
      members = members.filter(m=>m.id !== b.dataset.del);
      renderRoster();
      renderCheckin();
    });
  });
  list.querySelectorAll('[data-view-profile]').forEach(h=>{
    h.addEventListener('click', ()=> openProfileModal(h.dataset.viewProfile));
  });
}
document.getElementById('roster-search').addEventListener('input', renderRoster);

document.querySelectorAll('#roster-filter .filter-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#roster-filter .filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    rosterFilter = btn.dataset.filter;
    renderRoster();
  });
});

document.getElementById('filter-toggle-btn').addEventListener('click', function(){
  document.getElementById('roster-filter').classList.toggle('show');
  this.classList.toggle('open');
});

document.getElementById('scholar-toggle-btn').addEventListener('click', function(){
  document.getElementById('scholar-panel').classList.toggle('show');
  this.classList.toggle('open');
});

document.getElementById('report-toggle-btn').addEventListener('click', function(){
  document.getElementById('report-panel').classList.toggle('show');
  this.classList.toggle('open');
});

// ---- Modal ----
function toggleMemberOnlyFields(){
  const selected = document.querySelector('input[name="member-type"]:checked').value;
  const show = selected === 'Member';
  document.getElementById('talents-field').classList.toggle('show', show);
  document.getElementById('desired-ministry-field').classList.toggle('show', show);
}
document.querySelectorAll('input[name="member-type"]').forEach(r=>{
  r.addEventListener('change', toggleMemberOnlyFields);
});

const modal = document.getElementById('member-modal');
function openMemberModal(id){
  document.getElementById('modal-title').textContent = id ? 'Edit member' : 'Add member';
  document.getElementById('member-id').value = id || '';
  document.getElementById('member-photos').value = '';
  if(id){
    const m = members.find(x=>x.id === id);
    document.getElementById('member-first-name').value = m.first_name || '';
    document.getElementById('member-middle-initial').value = m.middle_initial || '';
    document.getElementById('member-surname').value = m.surname || '';
    document.getElementById('member-birthdate').value = m.birthdate || '';
    setCheckedMinistries('ministry-current-group', m.ministry);
    document.querySelector(`input[name="member-type"][value="${m.member_type || 'Member'}"]`).checked = true;
    document.querySelector(`input[name="member-status"][value="${m.status || 'Active'}"]`).checked = true;
    document.getElementById('member-scholar').checked = !!m.is_scholar;
    document.getElementById('member-baptized').checked = !!m.is_baptized;
    document.getElementById('member-baptism-date').value = m.baptism_date || '';
    toggleBaptismDateField();
    document.getElementById('member-education-level').value = m.education_level || '';
    updateEducationFields();
    if(m.grade_level) document.getElementById('member-grade-level').value = m.grade_level;
    document.getElementById('member-college-year').value = m.college_year || '1st Year';
    document.getElementById('member-college-program').value = m.college_program || '';
    document.getElementById('member-talents').value = m.talents_skills || '';
    setCheckedMinistries('ministry-desired-group', m.desired_ministry);
    document.getElementById('member-cellphone').value = m.cellphone || '';
    document.getElementById('member-email').value = m.email || '';
    document.getElementById('member-facebook').value = m.facebook || '';
    document.getElementById('member-instagram').value = m.instagram || '';
  }else{
    document.getElementById('member-first-name').value = '';
    document.getElementById('member-middle-initial').value = '';
    document.getElementById('member-surname').value = '';
    document.getElementById('member-birthdate').value = '';
    setCheckedMinistries('ministry-current-group', '');
    document.querySelector('input[name="member-type"][value="Member"]').checked = true;
    document.querySelector('input[name="member-status"][value="Active"]').checked = true;
    document.getElementById('member-scholar').checked = false;
    document.getElementById('member-baptized').checked = false;
    document.getElementById('member-baptism-date').value = '';
    toggleBaptismDateField();
    document.getElementById('member-education-level').value = '';
    updateEducationFields();
    document.getElementById('member-college-program').value = '';
    document.getElementById('member-talents').value = '';
    setCheckedMinistries('ministry-desired-group', '');
    document.getElementById('member-cellphone').value = '';
    document.getElementById('member-email').value = '';
    document.getElementById('member-facebook').value = '';
    document.getElementById('member-instagram').value = '';
  }
  toggleMemberOnlyFields();
  modal.classList.add('active');
}
document.getElementById('add-member-btn').addEventListener('click', ()=> openMemberModal(null));
document.getElementById('modal-cancel').addEventListener('click', ()=> modal.classList.remove('active'));
document.getElementById('modal-save').addEventListener('click', async ()=>{
  const firstName = document.getElementById('member-first-name').value.trim();
  const middleInitial = document.getElementById('member-middle-initial').value.trim();
  const surname = document.getElementById('member-surname').value.trim();
  if(!firstName || !surname){ alert('Enter at least a first name and surname.'); return; }
  const name = buildFullName(firstName, middleInitial, surname);
  const existingId = document.getElementById('member-id').value;
  const id = existingId || ('m_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
  const existing = members.find(x=>x.id === id);

  const saveBtn = document.getElementById('modal-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  let photo_url = existing ? (existing.photo_url || null) : null;
  const file = document.getElementById('member-photos').files[0];
  if(file){
    const uploaded = await uploadPhoto(file, id);
    if(uploaded) photo_url = uploaded;
  }

  const memberType = document.querySelector('input[name="member-type"]:checked').value;
  const status = document.querySelector('input[name="member-status"]:checked').value;
  const educationLevel = document.getElementById('member-education-level').value;
  const data = {
    id,
    name,
    first_name: firstName,
    middle_initial: middleInitial,
    surname,
    birthdate: document.getElementById('member-birthdate').value,
    ministry: getCheckedMinistries('ministry-current-group').join(', '),
    photo_url,
    member_type: memberType,
    status,
    is_scholar: document.getElementById('member-scholar').checked,
    is_baptized: document.getElementById('member-baptized').checked,
    baptism_date: document.getElementById('member-baptized').checked ? document.getElementById('member-baptism-date').value : '',
    education_level: educationLevel,
    grade_level: GRADE_OPTIONS[educationLevel] ? document.getElementById('member-grade-level').value : '',
    college_year: educationLevel === 'College' ? document.getElementById('member-college-year').value : '',
    college_program: PROGRAM_LABELS[educationLevel] ? document.getElementById('member-college-program').value.trim() : '',
    talents_skills: memberType === 'Member' ? document.getElementById('member-talents').value.trim() : '',
    desired_ministry: memberType === 'Member' ? getCheckedMinistries('ministry-desired-group').join(', ') : '',
    cellphone: document.getElementById('member-cellphone').value.trim(),
    email: document.getElementById('member-email').value.trim(),
    facebook: document.getElementById('member-facebook').value.trim(),
    instagram: document.getElementById('member-instagram').value.trim()
  };

  const ok = await upsertMember(data);
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';
  if(!ok){ alert('Could not save member. Check your connection and try again.'); return; }

  if(existing){ Object.assign(existing, data); }
  else{ members.push(data); }

  modal.classList.remove('active');
  renderRoster();
  renderCheckin();
});

// ---- Backdrop click-to-close ----
[modal, document.getElementById('profile-modal')].forEach(backdrop=>{
  backdrop.addEventListener('click', (e)=>{
    if(e.target === backdrop) backdrop.classList.remove('active');
  });
});

// ---- Profile view modal ----
const profileModal = document.getElementById('profile-modal');
function openProfileModal(id){
  const m = members.find(x=>x.id === id);
  if(!m) return;
  const age = calcAge(m.birthdate);
  const isActive = (m.status || 'Active') === 'Active';
  const contactBits = [
    m.cellphone ? `Cellphone: ${escapeHtml(m.cellphone)}` : '',
    m.email ? `Email: ${escapeHtml(m.email)}` : '',
    m.facebook ? `Facebook: ${escapeHtml(m.facebook)}` : '',
    m.instagram ? `Instagram: ${escapeHtml(m.instagram)}` : ''
  ].filter(Boolean);

  document.getElementById('profile-modal-content').innerHTML = `
    <img class="profile-photo" src="${m.photo_url || DEFAULT_AVATAR}" alt="${escapeHtml(m.name)}"
         onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
    <div class="profile-name">${escapeHtml(m.name)}</div>
    <div class="profile-tags">
      <span class="status-text ${isActive ? 'active' : 'inactive'}">${escapeHtml(m.status || 'Active')}</span>
      ${m.is_scholar ? `<span class="scholar-tag ${isActive ? 'active' : 'inactive'}">Scholar</span>` : ''}
    </div>
    <div class="profile-section">
      <div class="label">Type &amp; age</div>
      <div class="value">${escapeHtml(m.member_type || 'Member')}${age !== null ? ' &middot; ' + age + ' yrs old' : ''}</div>
    </div>
    ${m.birthdate ? `
    <div class="profile-section">
      <div class="label">Birthday</div>
      <div class="value">${formatDateLong(m.birthdate)}</div>
    </div>` : ''}
    <div class="profile-section">
      <div class="label">Current ministry</div>
      <div class="value">${escapeHtml(m.ministry || 'None yet')}</div>
    </div>
    ${m.is_baptized ? `
    <div class="profile-section">
      <div class="label">Baptism</div>
      <div class="value">Baptized${m.baptism_date ? ' &middot; ' + formatDateLong(m.baptism_date) : ''}</div>
    </div>` : ''}
    ${(m.education_level) ? `
    <div class="profile-section">
      <div class="label">Education</div>
      <div class="value">${buildEducationLine(m)}</div>
    </div>` : ''}
    ${m.talents_skills ? `
    <div class="profile-section">
      <div class="label">Talents and skills</div>
      <div class="value">${escapeHtml(m.talents_skills)}</div>
    </div>` : ''}
    ${m.desired_ministry ? `
    <div class="profile-section">
      <div class="label">Interested in joining</div>
      <div class="value">${escapeHtml(m.desired_ministry)}</div>
    </div>` : ''}
    ${contactBits.length ? `
    <div class="profile-section">
      <div class="label">Contact</div>
      <div class="value">${contactBits.join('<br>')}</div>
    </div>` : ''}
    <div class="profile-actions">
      <button class="btn-secondary" id="profile-close-btn">Close</button>
      <button class="btn-primary" id="profile-edit-btn">Edit</button>
    </div>
  `;
  profileModal.classList.add('active');
  document.getElementById('profile-close-btn').addEventListener('click', ()=>{
    profileModal.classList.remove('active');
  });
  document.getElementById('profile-edit-btn').addEventListener('click', ()=>{
    profileModal.classList.remove('active');
    openMemberModal(id);
  });
}

// ---- Dashboard ----
function renderDashboard(){
  const dateInput = document.getElementById('dash-date');
  if(!dateInput.value) dateInput.value = todayStr();
  const date = dateInput.value;
  const presentIds = attendance.filter(r=>r.date === date).map(r=>r.memberId);
  const presentCount = members.filter(m=>presentIds.includes(m.id)).length;

  document.getElementById('stat-present').textContent = presentCount;
  document.getElementById('stat-total').textContent = members.length;
  const pct = members.length ? Math.round((presentCount / members.length) * 100) : 0;
  document.getElementById('stat-pct').textContent = pct + '%';

  renderReport();
  renderScholarReport();
  renderBirthdayCelebrants();
}
document.getElementById('dash-date').addEventListener('change', renderDashboard);

// ---- Attendance report: by month, per year ----
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ---- Birthday celebrants for the current month ----
function renderBirthdayCelebrants(){
  const container = document.getElementById('birthday-celebrants');
  if(!container) return;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const celebrants = members
    .filter(m => {
      if(!m.birthdate) return false;
      const bd = new Date(m.birthdate + 'T00:00:00');
      return !isNaN(bd.getTime()) && bd.getMonth() === currentMonth;
    })
    .map(m => {
      const bd = new Date(m.birthdate + 'T00:00:00');
      return { member: m, day: bd.getDate(), turningAge: currentYear - bd.getFullYear() };
    })
    .sort((a,b) => a.day - b.day);

  if(celebrants.length === 0){
    container.innerHTML = `<div class="empty" style="padding:12px 0;">No birthdays in ${MONTH_NAMES[currentMonth]}.</div>`;
    return;
  }

  container.innerHTML = celebrants.map(c => `
    <div class="birthday-item">
      <span>${escapeHtml(c.member.name)}</span>
      <span class="birthday-item-date">${MONTH_NAMES[currentMonth].slice(0,3)} ${c.day}</span>
    </div>
  `).join('');
}

function renderReport(){
  const yearSelect = document.getElementById('report-year');
  if(!yearSelect) return;

  const yearsFromData = Array.from(new Set(attendance.map(r => (r.date || '').slice(0,4)).filter(Boolean)));
  const currentYear = String(new Date().getFullYear());
  const years = Array.from(new Set([...yearsFromData, currentYear])).sort((a,b) => b.localeCompare(a));

  const prevValue = yearSelect.value;
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = years.includes(prevValue) ? prevValue : years[0];
  const selectedYear = yearSelect.value;

  const counts = new Array(12).fill(0);
  attendance.forEach(r=>{
    if(r.date && r.date.slice(0,4) === selectedYear){
      const monthIdx = parseInt(r.date.slice(5,7), 10) - 1;
      if(monthIdx >= 0 && monthIdx < 12) counts[monthIdx]++;
    }
  });

  const list = document.getElementById('month-select-list');
  list.innerHTML = MONTH_NAMES.map((name, i)=>{
    const isSelected = selectedReportMonth && selectedReportMonth.year === selectedYear && selectedReportMonth.monthIndex === i;
    return `
      <button class="month-option${isSelected ? ' selected' : ''}" data-month="${i}" type="button">
        <span>${name}</span>
        <span class="month-option-count">${counts[i]}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.month-option').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const monthIdx = parseInt(btn.dataset.month, 10);
      selectedReportMonth = { year: selectedYear, monthIndex: monthIdx };
      list.classList.remove('show');
      document.getElementById('month-select-toggle').classList.remove('open');
      updateMonthSelectLabel(selectedYear);
      renderMonthDetail(selectedYear);
    });
  });

  updateMonthSelectLabel(selectedYear);
  renderMonthDetail(selectedYear);
  renderMemberReport();
}
document.getElementById('report-year').addEventListener('change', renderReport);

function updateMonthSelectLabel(selectedYear){
  const label = document.getElementById('month-select-label');
  if(!label) return;
  if(selectedReportMonth && selectedReportMonth.year === selectedYear){
    label.textContent = `${MONTH_NAMES[selectedReportMonth.monthIndex]} ${selectedYear}`;
  }else{
    label.textContent = 'Select a month';
  }
}
document.getElementById('month-select-toggle').addEventListener('click', function(){
  document.getElementById('month-select-list').classList.toggle('show');
  this.classList.toggle('open');
});

// ---- Attendance report: per-date attendee breakdown for a selected month ----
let selectedReportMonth = null;
let expandedReportDates = new Set();

function renderMonthDetail(selectedYear){
  const container = document.getElementById('month-detail');
  if(!container) return;
  if(!selectedReportMonth || selectedReportMonth.year !== selectedYear){
    container.innerHTML = '';
    return;
  }
  const monthIdx = selectedReportMonth.monthIndex;
  const prefix = `${selectedYear}-${String(monthIdx + 1).padStart(2,'0')}`;

  const dateGroups = {};
  attendance.forEach(r=>{
    if(r.date && r.date.startsWith(prefix)){
      dateGroups[r.date] = dateGroups[r.date] || [];
      dateGroups[r.date].push(r);
    }
  });
  const dates = Object.keys(dateGroups).sort();

  if(dates.length === 0){
    container.innerHTML = `<div class="empty" style="padding:16px 0;">No check-ins recorded for ${MONTH_NAMES[monthIdx]} ${selectedYear}.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="section-title">${MONTH_NAMES[monthIdx]} ${selectedYear} &middot; attendees by date</div>
    ${dates.map(date=>{
      const presentIdsForDate = dateGroups[date].map(r=>r.memberId);
      const presentMembersForDate = members.filter(m=>presentIdsForDate.includes(m.id))
        .slice().sort((a,b)=>a.name.localeCompare(b.name));
      const absentMembersForDate = members.filter(m=>!presentIdsForDate.includes(m.id))
        .slice().sort((a,b)=>a.name.localeCompare(b.name));
      const dateLabel = formatDateLong(date) || date;
      const isOpen = expandedReportDates.has(date);
      return `
        <div class="month-date-group" data-date="${date}">
          <div class="month-date-header" data-date="${date}">
            <span class="month-date-header-left">
              ${dateLabel}
              <svg class="filter-arrow month-date-arrow${isOpen ? ' open' : ''}" viewBox="0 0 24 24" width="14" height="14">
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>${presentMembersForDate.length} present</span>
          </div>
          <div class="month-date-columns${isOpen ? ' show' : ''}">
            <div class="month-date-col">
              <div class="month-date-col-title">Present</div>
              ${presentMembersForDate.length ? presentMembersForDate.map(m=>`
                <div class="month-date-member-row" data-member="${m.id}" data-date="${date}">
                  <span>${escapeHtml(m.name)}</span>
                  <button class="icon-btn month-remove-btn" title="Mark absent">&times;</button>
                </div>
              `).join('') : `<div class="month-date-empty">No one yet.</div>`}
            </div>
            <div class="month-date-col">
              <div class="month-date-col-title">Absent</div>
              ${absentMembersForDate.length ? absentMembersForDate.map(m=>`
                <div class="month-date-absent-row" data-member="${m.id}" data-date="${date}">
                  <span>${escapeHtml(m.name)}</span>
                  <button class="icon-btn month-add-btn" title="Mark present">+</button>
                </div>
              `).join('') : `<div class="month-date-empty">Everyone accounted for.</div>`}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  `;

  container.querySelectorAll('.month-date-header').forEach(header=>{
    header.addEventListener('click', ()=>{
      const date = header.dataset.date;
      const group = header.closest('.month-date-group');
      const columns = group.querySelector('.month-date-columns');
      const arrow = header.querySelector('.month-date-arrow');
      if(expandedReportDates.has(date)){
        expandedReportDates.delete(date);
        columns.classList.remove('show');
        arrow.classList.remove('open');
      }else{
        expandedReportDates.add(date);
        columns.classList.add('show');
        arrow.classList.add('open');
      }
    });
  });

  container.querySelectorAll('.month-remove-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = btn.closest('.month-date-member-row');
      const memberId = row.dataset.member;
      const date = row.dataset.date;
      const m = members.find(x=>x.id === memberId);
      if(!confirm(`Mark ${m ? m.name : 'this attendee'} as absent for ${formatDateLong(date) || date}?`)) return;
      const ok = await deleteAttendance(memberId, date);
      if(!ok){ alert('Could not update attendance. Check your connection.'); return; }
      attendance = attendance.filter(r => !(r.memberId === memberId && r.date === date));
      renderDashboard();
      renderCheckin();
    });
  });

  container.querySelectorAll('.month-add-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = btn.closest('.month-date-absent-row');
      const memberId = row.dataset.member;
      const date = row.dataset.date;
      const m = members.find(x=>x.id === memberId);
      if(!confirm(`Mark ${m ? m.name : 'this member'} as present for ${formatDateLong(date) || date}?`)) return;
      const ts = Date.now();
      const ok = await insertAttendance(memberId, date, ts);
      if(!ok){ alert('Could not update attendance. Check your connection.'); return; }
      attendance.push({memberId, date, timestamp: ts});
      renderDashboard();
      renderCheckin();
    });
  });
}

// ---- Scholars report: by month, per year (scholars only) ----
let selectedScholarReportMonth = null;
let expandedScholarReportDates = new Set();

function renderScholarReport(){
  const yearSelect = document.getElementById('scholar-report-year');
  if(!yearSelect) return;

  const scholarMembers = members.filter(m => m.is_scholar);
  const scholarIds = scholarMembers.map(m => m.id);
  const scholarAttendance = attendance.filter(r => scholarIds.includes(r.memberId));

  const yearsFromData = Array.from(new Set(scholarAttendance.map(r => (r.date || '').slice(0,4)).filter(Boolean)));
  const currentYear = String(new Date().getFullYear());
  const years = Array.from(new Set([...yearsFromData, currentYear])).sort((a,b) => b.localeCompare(a));

  const prevValue = yearSelect.value;
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = years.includes(prevValue) ? prevValue : years[0];
  const selectedYear = yearSelect.value;

  if(scholarMembers.length === 0){
    document.getElementById('scholar-month-select-list').innerHTML = '';
    document.getElementById('scholar-month-detail').innerHTML = '<div class="empty" style="padding:16px 0;">No scholars on the roster yet.</div>';
    updateScholarMonthSelectLabel(selectedYear);
    return;
  }

  const counts = new Array(12).fill(0);
  scholarAttendance.forEach(r=>{
    if(r.date && r.date.slice(0,4) === selectedYear){
      const monthIdx = parseInt(r.date.slice(5,7), 10) - 1;
      if(monthIdx >= 0 && monthIdx < 12) counts[monthIdx]++;
    }
  });

  const list = document.getElementById('scholar-month-select-list');
  list.innerHTML = MONTH_NAMES.map((name, i)=>{
    const isSelected = selectedScholarReportMonth && selectedScholarReportMonth.year === selectedYear && selectedScholarReportMonth.monthIndex === i;
    return `
      <button class="month-option${isSelected ? ' selected' : ''}" data-month="${i}" type="button">
        <span>${name}</span>
        <span class="month-option-count">${counts[i]}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.month-option').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const monthIdx = parseInt(btn.dataset.month, 10);
      selectedScholarReportMonth = { year: selectedYear, monthIndex: monthIdx };
      list.classList.remove('show');
      document.getElementById('scholar-month-select-toggle').classList.remove('open');
      updateScholarMonthSelectLabel(selectedYear);
      renderScholarMonthDetail(selectedYear);
    });
  });

  updateScholarMonthSelectLabel(selectedYear);
  renderScholarMonthDetail(selectedYear);
}
document.getElementById('scholar-report-year').addEventListener('change', renderScholarReport);

function updateScholarMonthSelectLabel(selectedYear){
  const label = document.getElementById('scholar-month-select-label');
  if(!label) return;
  if(selectedScholarReportMonth && selectedScholarReportMonth.year === selectedYear){
    label.textContent = `${MONTH_NAMES[selectedScholarReportMonth.monthIndex]} ${selectedYear}`;
  }else{
    label.textContent = 'Select a month';
  }
}
document.getElementById('scholar-month-select-toggle').addEventListener('click', function(){
  document.getElementById('scholar-month-select-list').classList.toggle('show');
  this.classList.toggle('open');
});

function renderScholarMonthDetail(selectedYear){
  const container = document.getElementById('scholar-month-detail');
  if(!container) return;
  if(!selectedScholarReportMonth || selectedScholarReportMonth.year !== selectedYear){
    container.innerHTML = '';
    return;
  }
  const monthIdx = selectedScholarReportMonth.monthIndex;
  const prefix = `${selectedYear}-${String(monthIdx + 1).padStart(2,'0')}`;
  const scholarMembers = members.filter(m => m.is_scholar);
  const scholarIds = scholarMembers.map(m => m.id);

  const dateGroups = {};
  attendance.forEach(r=>{
    if(r.date && r.date.startsWith(prefix) && scholarIds.includes(r.memberId)){
      dateGroups[r.date] = dateGroups[r.date] || [];
      dateGroups[r.date].push(r);
    }
  });
  const dates = Object.keys(dateGroups).sort();

  if(dates.length === 0){
    container.innerHTML = `<div class="empty" style="padding:16px 0;">No scholar check-ins recorded for ${MONTH_NAMES[monthIdx]} ${selectedYear}.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="section-title">${MONTH_NAMES[monthIdx]} ${selectedYear} &middot; scholars by date</div>
    ${dates.map(date=>{
      const presentIdsForDate = dateGroups[date].map(r=>r.memberId);
      const presentScholarsForDate = scholarMembers.filter(m=>presentIdsForDate.includes(m.id))
        .slice().sort((a,b)=>a.name.localeCompare(b.name));
      const absentScholarsForDate = scholarMembers.filter(m=>!presentIdsForDate.includes(m.id))
        .slice().sort((a,b)=>a.name.localeCompare(b.name));
      const dateLabel = formatDateLong(date) || date;
      const isOpen = expandedScholarReportDates.has(date);
      return `
        <div class="month-date-group" data-date="${date}">
          <div class="month-date-header" data-date="${date}">
            <span class="month-date-header-left">
              ${dateLabel}
              <svg class="filter-arrow month-date-arrow${isOpen ? ' open' : ''}" viewBox="0 0 24 24" width="14" height="14">
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>${presentScholarsForDate.length} present</span>
          </div>
          <div class="month-date-columns${isOpen ? ' show' : ''}">
            <div class="month-date-col">
              <div class="month-date-col-title">Present</div>
              ${presentScholarsForDate.length ? presentScholarsForDate.map(m=>`
                <div class="month-date-member-row" data-member="${m.id}" data-date="${date}">
                  <span>${escapeHtml(m.name)}</span>
                  <button class="icon-btn scholar-remove-btn" title="Mark absent">&times;</button>
                </div>
              `).join('') : `<div class="month-date-empty">No one yet.</div>`}
            </div>
            <div class="month-date-col">
              <div class="month-date-col-title">Absent</div>
              ${absentScholarsForDate.length ? absentScholarsForDate.map(m=>`
                <div class="month-date-absent-row" data-member="${m.id}" data-date="${date}">
                  <span>${escapeHtml(m.name)}</span>
                  <button class="icon-btn scholar-add-btn" title="Mark present">+</button>
                </div>
              `).join('') : `<div class="month-date-empty">Everyone accounted for.</div>`}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  `;

  container.querySelectorAll('.month-date-header').forEach(header=>{
    header.addEventListener('click', ()=>{
      const date = header.dataset.date;
      const group = header.closest('.month-date-group');
      const columns = group.querySelector('.month-date-columns');
      const arrow = header.querySelector('.month-date-arrow');
      if(expandedScholarReportDates.has(date)){
        expandedScholarReportDates.delete(date);
        columns.classList.remove('show');
        arrow.classList.remove('open');
      }else{
        expandedScholarReportDates.add(date);
        columns.classList.add('show');
        arrow.classList.add('open');
      }
    });
  });

  container.querySelectorAll('.scholar-remove-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = btn.closest('.month-date-member-row');
      const memberId = row.dataset.member;
      const date = row.dataset.date;
      const m = members.find(x=>x.id === memberId);
      if(!confirm(`Mark ${m ? m.name : 'this scholar'} as absent for ${formatDateLong(date) || date}?`)) return;
      const ok = await deleteAttendance(memberId, date);
      if(!ok){ alert('Could not update attendance. Check your connection.'); return; }
      attendance = attendance.filter(r => !(r.memberId === memberId && r.date === date));
      renderDashboard();
      renderCheckin();
    });
  });

  container.querySelectorAll('.scholar-add-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = btn.closest('.month-date-absent-row');
      const memberId = row.dataset.member;
      const date = row.dataset.date;
      const m = members.find(x=>x.id === memberId);
      if(!confirm(`Mark ${m ? m.name : 'this scholar'} as present for ${formatDateLong(date) || date}?`)) return;
      const ts = Date.now();
      const ok = await insertAttendance(memberId, date, ts);
      if(!ok){ alert('Could not update attendance. Check your connection.'); return; }
      attendance.push({memberId, date, timestamp: ts});
      renderDashboard();
      renderCheckin();
    });
  });
}

// ---- Attendance report: track an individual member ----
let selectedReportMemberId = null;

function renderMemberReportSuggestions(query){
  const box = document.getElementById('report-member-suggestions');
  if(!query){ box.innerHTML = ''; box.classList.remove('show'); return; }
  const q = query.toLowerCase();
  const matches = members.filter(m => m.name.toLowerCase().includes(q)).slice(0, 6);
  if(matches.length === 0){
    box.innerHTML = '<div class="report-suggestion-empty">No matching member.</div>';
    box.classList.add('show');
    return;
  }
  box.innerHTML = matches.map(m => `<div class="report-suggestion-item" data-id="${m.id}">${escapeHtml(m.name)}</div>`).join('');
  box.classList.add('show');
  box.querySelectorAll('.report-suggestion-item').forEach(item=>{
    item.addEventListener('click', ()=>{
      selectedReportMemberId = item.dataset.id;
      const m = members.find(x => x.id === selectedReportMemberId);
      document.getElementById('report-member-search').value = m ? m.name : '';
      box.innerHTML = '';
      box.classList.remove('show');
      renderMemberReport();
    });
  });
}

document.getElementById('report-member-search').addEventListener('input', (e)=>{
  selectedReportMemberId = null;
  document.getElementById('report-member-result').innerHTML = '';
  renderMemberReportSuggestions(e.target.value.trim());
});

function renderMemberReport(){
  const resultEl = document.getElementById('report-member-result');
  if(!resultEl) return;
  if(!selectedReportMemberId){ resultEl.innerHTML = ''; return; }
  const m = members.find(x => x.id === selectedReportMemberId);
  if(!m){ resultEl.innerHTML = ''; return; }

  const year = document.getElementById('report-year').value;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const counts = new Array(12).fill(0);
  attendance.forEach(r=>{
    if(r.memberId === m.id && r.date && r.date.slice(0,4) === year){
      const monthIdx = parseInt(r.date.slice(5,7), 10) - 1;
      if(monthIdx >= 0 && monthIdx < 12) counts[monthIdx]++;
    }
  });
  const total = counts.reduce((a,b) => a + b, 0);
  const maxCount = Math.max(1, ...counts);

  resultEl.innerHTML = `
    <div class="report-member-total">${escapeHtml(m.name)} &middot; ${total} check-in${total === 1 ? '' : 's'} in ${year}</div>
    ${monthNames.map((name, i)=>{
      const pct = Math.round((counts[i] / maxCount) * 100);
      return `
        <div class="ministry-bar-row">
          <div class="ministry-bar-label"><span>${name}</span><span>${counts[i]}</span></div>
          <div class="ministry-bar-track"><div class="ministry-bar-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('')}
  `;
}

// ---- Init ----
(async function init(){
  await loadData();
  gateCheckin();
})();