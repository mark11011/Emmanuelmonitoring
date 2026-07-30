let members = [];
let attendance = [];
let leaderPasscodeHash = null;
let leaderUnlocked = false;
let rosterFilter = 'All';
const todayStr = () => new Date().toISOString().slice(0,10);

// ---- Theme toggle (per-device preference, not shared church data) ----
function applyTheme(theme){
  document.body.classList.toggle('light-theme', theme === 'light');
  const checkbox = document.getElementById('theme-toggle-checkbox');
  if(checkbox) checkbox.checked = (theme === 'light');
}
(function initTheme(){
  let saved = 'dark';
  try{ saved = localStorage.getItem('theme-preference') || 'dark'; }catch(e){}
  applyTheme(saved);
})();
document.getElementById('theme-toggle-checkbox').addEventListener('change', (e)=>{
  const next = e.target.checked ? 'light' : 'dark';
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

const MINISTRIES = [
  'Praise and Worship','Ushering','Media and Tech','Kids Ministry',
  'Discipleship and Small Groups','Outreach and Missions',
  'Hospitality','Prayer Team','Administration'
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

function calcAge(birthdate){
  if(!birthdate) return null;
  const b = new Date(birthdate);
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if(m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
  return age;
}

// ---- Supabase data layer ----
async function loadData(){
  try{
    const { data, error } = await window.db.from('members').select('*').order('name');
    if(error) throw error;
    members = (data || []).map(m => ({
      id: m.id, name: m.name, birthdate: m.birthdate || '',
      ministry: m.ministry || '', photo_url: m.photo_url || '',
      member_type: m.member_type || 'Member',
      is_scholar: !!m.is_scholar,
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
      birthdate: member.birthdate || null,
      ministry: member.ministry,
      photo_url: member.photo_url || null,
      member_type: member.member_type || 'Member',
      is_scholar: !!member.is_scholar,
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
    if(btn.dataset.view === 'roster') gateRoster();
    if(btn.dataset.view === 'dashboard') gateDashboard();
  });
});

// ---- Check-in view ----
function renderCheckin(){
  const label = document.getElementById('today-label');
  label.textContent = new Date().toLocaleDateString('en-PH', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
  const q = document.getElementById('checkin-search').value.trim().toLowerCase();
  const grid = document.getElementById('checkin-grid');
  grid.innerHTML = '';
  const today = todayStr();
  const filtered = members.filter(m => m.name.toLowerCase().includes(q));
  if(members.length === 0){
    grid.innerHTML = '<div class="empty">No members yet. Ask a leader to add the roster first.</div>';
    return;
  }
  if(filtered.length === 0){
    grid.innerHTML = '<div class="empty">No matching name.</div>';
    return;
  }
  filtered.forEach(m=>{
    const checked = isCheckedIn(m.id, today);
    const card = document.createElement('button');
    card.className = 'member-card' + (checked ? ' checked' : '');
    card.innerHTML = `
      <img class="member-photo" src="${m.photo_url || DEFAULT_AVATAR}" alt="${escapeHtml(m.name)}"
           onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
      <p class="name">${escapeHtml(m.name)}</p>
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
document.getElementById('roster-lock-btn').addEventListener('click', ()=>{
  leaderUnlocked = false;
  gateRoster();
});
document.getElementById('dashboard-lock-btn').addEventListener('click', ()=>{
  leaderUnlocked = false;
  gateDashboard();
});

// ---- Roster view ----
function renderRoster(){
  const q = document.getElementById('roster-search').value.trim().toLowerCase();
  const list = document.getElementById('roster-list');
  list.innerHTML = '';
  const filtered = members.filter(m => {
    if(!m.name.toLowerCase().includes(q)) return false;
    if(rosterFilter === 'All') return true;
    if(rosterFilter === 'Scholar') return !!m.is_scholar;
    return (m.member_type || 'Member') === rosterFilter;
  });
  if(filtered.length === 0){
    list.innerHTML = '<div class="empty">No members found.</div>';
    return;
  }
  filtered.forEach(m=>{
    const age = calcAge(m.birthdate);
    const row = document.createElement('div');
    row.className = 'roster-row';
    const contactBits = [m.cellphone, m.email, m.facebook, m.instagram].filter(Boolean);
    row.innerHTML = `
      <div class="roster-header">
        <img class="roster-photo" src="${m.photo_url || DEFAULT_AVATAR}" alt="${escapeHtml(m.name)}"
             onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
        <div class="roster-name-block">
          <div class="name">${escapeHtml(m.name)}${m.is_scholar ? '<span class="scholar-tag">Scholar</span>' : ''}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-edit="${m.id}">&#9998;</button>
          <button class="icon-btn" data-del="${m.id}">&times;</button>
        </div>
      </div>
      <div class="info">
        <div class="meta">${escapeHtml(m.member_type || 'Member')} &middot; ${age !== null ? age + ' yrs old' : 'No birthdate'} &middot; ${escapeHtml(m.ministry || 'No ministry')}</div>
        ${contactBits.length ? `<div class="meta">${contactBits.map(escapeHtml).join(' &middot; ')}</div>` : ''}
        ${m.talents_skills ? `<div class="meta">Talents: ${escapeHtml(m.talents_skills)}</div>` : ''}
        ${m.desired_ministry ? `<div class="meta">Interested in: ${escapeHtml(m.desired_ministry)}</div>` : ''}
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-edit]').forEach(b=>{
    b.addEventListener('click', ()=> openMemberModal(b.dataset.edit));
  });
  list.querySelectorAll('[data-del]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Remove this member from the roster?')) return;
      const ok = await deleteMemberRow(b.dataset.del);
      if(!ok){ alert('Could not delete member. Check your connection.'); return; }
      members = members.filter(m=>m.id !== b.dataset.del);
      renderRoster();
      renderCheckin();
    });
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
    document.getElementById('member-name').value = m.name || '';
    document.getElementById('member-birthdate').value = m.birthdate || '';
    setCheckedMinistries('ministry-current-group', m.ministry);
    document.querySelector(`input[name="member-type"][value="${m.member_type || 'Member'}"]`).checked = true;
    document.getElementById('member-scholar').checked = !!m.is_scholar;
    document.getElementById('member-talents').value = m.talents_skills || '';
    setCheckedMinistries('ministry-desired-group', m.desired_ministry);
    document.getElementById('member-cellphone').value = m.cellphone || '';
    document.getElementById('member-email').value = m.email || '';
    document.getElementById('member-facebook').value = m.facebook || '';
    document.getElementById('member-instagram').value = m.instagram || '';
  }else{
    document.getElementById('member-name').value = '';
    document.getElementById('member-birthdate').value = '';
    setCheckedMinistries('ministry-current-group', '');
    document.querySelector('input[name="member-type"][value="Member"]').checked = true;
    document.getElementById('member-scholar').checked = false;
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
  const name = document.getElementById('member-name').value.trim();
  if(!name){ alert('Enter a name.'); return; }
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
  const data = {
    id,
    name,
    birthdate: document.getElementById('member-birthdate').value,
    ministry: getCheckedMinistries('ministry-current-group').join(', '),
    photo_url,
    member_type: memberType,
    is_scholar: document.getElementById('member-scholar').checked,
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

// ---- Dashboard ----
function renderDashboard(){
  const dateInput = document.getElementById('dash-date');
  if(!dateInput.value) dateInput.value = todayStr();
  const date = dateInput.value;
  const presentIds = attendance.filter(r=>r.date === date).map(r=>r.memberId);
  const presentMembers = members.filter(m=>presentIds.includes(m.id));
  const absentMembers = members.filter(m=>!presentIds.includes(m.id));

  document.getElementById('stat-present').textContent = presentMembers.length;
  document.getElementById('stat-total').textContent = members.length;
  const pct = members.length ? Math.round((presentMembers.length / members.length) * 100) : 0;
  document.getElementById('stat-pct').textContent = pct + '%';

  const byMinistry = {};
  members.forEach(m=>{
    const list = (m.ministry || '').split(',').map(s=>s.trim()).filter(Boolean);
    const keys = list.length ? list : ['None yet'];
    keys.forEach(key=>{
      byMinistry[key] = byMinistry[key] || {total:0, present:0};
      byMinistry[key].total++;
      if(presentIds.includes(m.id)) byMinistry[key].present++;
    });
  });
  const breakdown = document.getElementById('ministry-breakdown');
  breakdown.innerHTML = '';
  Object.entries(byMinistry).forEach(([name, v])=>{
    const rowPct = v.total ? Math.round((v.present / v.total) * 100) : 0;
    const div = document.createElement('div');
    div.className = 'ministry-bar-row';
    div.innerHTML = `
      <div class="ministry-bar-label"><span>${escapeHtml(name)}</span><span>${v.present}/${v.total}</span></div>
      <div class="ministry-bar-track"><div class="ministry-bar-fill" style="width:${rowPct}%"></div></div>
    `;
    breakdown.appendChild(div);
  });
  if(Object.keys(byMinistry).length === 0){
    breakdown.innerHTML = '<div class="empty">No members yet.</div>';
  }

  const scholarMembers = members.filter(m => m.is_scholar);
  const scholarPresentCount = scholarMembers.filter(m => presentIds.includes(m.id)).length;
  const scholarBreakdown = document.getElementById('scholar-breakdown');
  if(scholarMembers.length === 0){
    scholarBreakdown.innerHTML = '<div class="empty">No scholars on the roster yet.</div>';
  }else{
    const scholarPct = Math.round((scholarPresentCount / scholarMembers.length) * 100);
    scholarBreakdown.innerHTML = `
      <div class="ministry-bar-row">
        <div class="ministry-bar-label"><span>Scholars</span><span>${scholarPresentCount}/${scholarMembers.length}</span></div>
        <div class="ministry-bar-track"><div class="ministry-bar-fill" style="width:${scholarPct}%"></div></div>
      </div>
    `;
  }

  const presentList = document.getElementById('present-list');
  presentList.innerHTML = '';
  if(presentMembers.length === 0){
    presentList.innerHTML = '<span class="empty" style="padding:6px 0;">No one checked in yet for this date.</span>';
  }else{
    presentMembers.forEach(m=>{
      const pill = document.createElement('button');
      pill.className = 'pill pill-clickable';
      pill.textContent = m.name;
      pill.title = 'Click to mark absent';
      pill.addEventListener('click', async ()=>{
        if(!confirm(`Mark ${m.name} as absent for this date?`)) return;
        const ok = await deleteAttendance(m.id, date);
        if(!ok){ alert('Could not update attendance. Check your connection.'); return; }
        const { data, error } = await window.db.from('attendance').select('*');
        if(!error){
          attendance = (data || []).map(r => ({ memberId: r.member_id, date: r.date, timestamp: r.ts }));
        }else{
          attendance = attendance.filter(r => !(r.memberId === m.id && r.date === date));
        }
        renderDashboard();
        renderCheckin();
      });
      presentList.appendChild(pill);
    });
  }

  const absentList = document.getElementById('absent-list');
  absentList.innerHTML = absentMembers.length
    ? absentMembers.map(m=>`<span class="pill absent">${escapeHtml(m.name)}</span>`).join('')
    : '<span class="empty" style="padding:6px 0;">Everyone is accounted for.</span>';
}
document.getElementById('dash-date').addEventListener('change', renderDashboard);

// ---- Init ----
(async function init(){
  await loadData();
  renderCheckin();
})();