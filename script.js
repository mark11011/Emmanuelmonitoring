let members = [];
let attendance = [];
let leaderPasscodeHash = null;
let leaderUnlocked = false;
const todayStr = () => new Date().toISOString().slice(0,10);

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

async function loadData(){
  try{
    const m = await window.storage.get('members-roster', true);
    members = m ? JSON.parse(m.value) : [];
  }catch(e){ members = []; }
  try{
    const a = await window.storage.get('attendance-log', true);
    attendance = a ? JSON.parse(a.value) : [];
  }catch(e){ attendance = []; }
  try{
    const p = await window.storage.get('leader-passcode', true);
    leaderPasscodeHash = p ? p.value : null;
  }catch(e){ leaderPasscodeHash = null; }
}

async function saveMembers(){
  try{ await window.storage.set('members-roster', JSON.stringify(members), true); }
  catch(e){ console.error('save members failed', e); }
}
async function saveAttendance(){
  try{ await window.storage.set('attendance-log', JSON.stringify(attendance), true); }
  catch(e){ console.error('save attendance failed', e); }
}

function isCheckedIn(memberId, date){
  return attendance.some(r => r.memberId === memberId && r.date === date);
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
      <p class="name">${escapeHtml(m.name)}</p>
      <p class="ministry">${escapeHtml(m.ministry || '')}</p>
      <span class="seal"><svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="12"/><path d="M9 15l4 4 8-9" stroke="var(--gold)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    `;
    card.addEventListener('click', async ()=>{
      if(isCheckedIn(m.id, today)) return;
      attendance.push({memberId:m.id, date:today, timestamp:Date.now()});
      card.classList.add('checked','stamp-anim');
      await saveAttendance();
    });
    grid.appendChild(card);
  });
}
document.getElementById('checkin-search').addEventListener('input', renderCheckin);

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

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
      leaderPasscodeHash = simpleHash(val);
      try{ await window.storage.set('leader-passcode', leaderPasscodeHash, true); }
      catch(e){ errEl.textContent = 'Could not save passcode. Try again.'; return; }
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
  const filtered = members.filter(m => m.name.toLowerCase().includes(q));
  if(filtered.length === 0){
    list.innerHTML = '<div class="empty">No members found.</div>';
    return;
  }
  filtered.forEach(m=>{
    const age = calcAge(m.birthdate);
    const row = document.createElement('div');
    row.className = 'roster-row';
    row.innerHTML = `
      <div class="info">
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="meta">${age !== null ? age + ' yrs old' : 'No birthdate'} &middot; ${escapeHtml(m.ministry || 'No ministry')}${m.contact ? ' &middot; ' + escapeHtml(m.contact) : ''}</div>
      </div>
      <div class="actions">
        <button class="icon-btn" data-edit="${m.id}">&#9998;</button>
        <button class="icon-btn" data-del="${m.id}">&times;</button>
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
      members = members.filter(m=>m.id !== b.dataset.del);
      await saveMembers();
      renderRoster();
    });
  });
}
document.getElementById('roster-search').addEventListener('input', renderRoster);

// ---- Modal ----
const modal = document.getElementById('member-modal');
function openMemberModal(id){
  document.getElementById('modal-title').textContent = id ? 'Edit member' : 'Add member';
  document.getElementById('member-id').value = id || '';
  if(id){
    const m = members.find(x=>x.id === id);
    document.getElementById('member-name').value = m.name || '';
    document.getElementById('member-birthdate').value = m.birthdate || '';
    document.getElementById('member-ministry').value = m.ministry || 'Praise and Worship';
    document.getElementById('member-contact').value = m.contact || '';
  }else{
    document.getElementById('member-name').value = '';
    document.getElementById('member-birthdate').value = '';
    document.getElementById('member-ministry').value = 'Praise and Worship';
    document.getElementById('member-contact').value = '';
  }
  modal.classList.add('active');
}
document.getElementById('add-member-btn').addEventListener('click', ()=> openMemberModal(null));
document.getElementById('modal-cancel').addEventListener('click', ()=> modal.classList.remove('active'));
document.getElementById('modal-save').addEventListener('click', async ()=>{
  const name = document.getElementById('member-name').value.trim();
  if(!name){ alert('Enter a name.'); return; }
  const id = document.getElementById('member-id').value;
  const data = {
    name,
    birthdate: document.getElementById('member-birthdate').value,
    ministry: document.getElementById('member-ministry').value,
    contact: document.getElementById('member-contact').value.trim()
  };
  if(id){
    const m = members.find(x=>x.id === id);
    Object.assign(m, data);
  }else{
    members.push({id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), ...data});
  }
  await saveMembers();
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
    const key = m.ministry || 'None yet';
    byMinistry[key] = byMinistry[key] || {total:0, present:0};
    byMinistry[key].total++;
    if(presentIds.includes(m.id)) byMinistry[key].present++;
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

  const presentList = document.getElementById('present-list');
  presentList.innerHTML = presentMembers.length
    ? presentMembers.map(m=>`<span class="pill">${escapeHtml(m.name)}</span>`).join('')
    : '<span class="empty" style="padding:6px 0;">No one checked in yet for this date.</span>';

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