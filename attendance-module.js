// attendance-module.js - 考勤管理 K1~K4
const ATT_API = 'http://localhost:3001/api';

const ATT_BADGE = {
  '正常': 'badge-success', '迟到': 'badge-warning', '早退': 'badge-warning',
  '缺勤': 'badge-danger', '请假': 'badge-info'
};

function attUser() { return sessionStorage.getItem('currentUsername') || ''; }
function attRole() { return sessionStorage.getItem('currentRole') || ''; }
function attIsHR() { return ['HR专员', '管理员'].includes(attRole()) || attUser() === 'root'; }
function attIsMgr() { return attRole() === '部门主管'; }
function attCanManage() { return attIsHR(); }
function attCanExport() { return attIsHR() || attIsMgr(); }

document.addEventListener('DOMContentLoaded', function () {
  initAttendanceModule();
});

function initAttendanceModule() {
  setupAttUI();
  bindAttPanel();
  setDefaultAttDates();
}

function setupAttUI() {
  if (attCanExport()) {
    const exp = document.getElementById('attExportBtn');
    const stats = document.getElementById('attStatsRow');
    if (exp) exp.style.display = '';
    if (stats) stats.style.display = '';
  }
  if (attIsHR() || attIsMgr()) {
    const dept = document.getElementById('attFilterDept');
    if (dept) dept.style.display = '';
    loadAttDeptOptions();
  }
  if (attCanManage()) {
    const add = document.getElementById('attAddBtn');
    const sync = document.getElementById('attSyncLeaveBtn');
    const col = document.getElementById('attActionCol');
    if (add) add.style.display = '';
    if (sync) sync.style.display = '';
    if (col) col.style.display = '';
  }
  const tip = document.getElementById('attPanelTip');
  if (tip) {
    if (attCanManage()) {
      tip.textContent = 'HR/管理员：假期批准后自动同步为「请假」；每日 9:00 后未签到记「迟到」（已请假除外）。状态筛选可选「请假」查看';
    } else if (attIsMgr()) {
      tip.textContent = '部门主管：可查看本部门考勤；已批准假期会显示为「请假」';
    } else {
      tip.textContent = '签到/签退：9:05 后签到记迟到；已批准请假日无需打卡';
    }
  }
}

function attLocalDate(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setDefaultAttDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const fEl = document.getElementById('attDateFrom');
  const tEl = document.getElementById('attDateTo');
  if (fEl && !fEl.value) fEl.value = attLocalDate(from);
  if (tEl && !tEl.value) tEl.value = attLocalDate(to);
}

async function loadAttDeptOptions() {
  try {
    const depts = await fetch(ATT_API + '/departments/list').then(r => r.json());
    const sel = document.getElementById('attFilterDept');
    if (!sel || sel.options.length > 1) return;
    depts.forEach(d => sel.add(new Option(d.name, d.id)));
    if (attIsMgr() && !attIsHR()) {
      const deptId = sessionStorage.getItem('departmentId');
      if (deptId) { sel.value = deptId; sel.disabled = true; }
    }
  } catch (e) { /* ignore */ }
}

async function loadAttToday() {
  const info = document.getElementById('attTodayInfo');
  const inBtn = document.getElementById('attCheckInBtn');
  const outBtn = document.getElementById('attCheckOutBtn');
  if (!info) return;
  try {
    const res = await fetch(ATT_API + '/attendance/today?username=' + encodeURIComponent(attUser())).then(r => r.json());
    if (!res.success) { info.textContent = res.error || '加载失败'; return; }
    const d = res.data;
    const todayLabel = d.today || '';
    if (d.on_leave) {
      info.innerHTML = `<strong>${d.name}</strong> · ${todayLabel} 已批准请假，无需打卡`;
      if (inBtn) inBtn.disabled = true;
      if (outBtn) outBtn.disabled = true;
      return;
    }
    const rec = d.record;
    if (rec) {
      const day = rec.check_date || todayLabel;
      info.innerHTML = `<strong>${d.name}</strong> · ${day} · 签到 ${rec.check_in || '-'} · 签退 ${rec.check_out || '-'} · <span class="badge ${ATT_BADGE[rec.status] || 'badge-info'}">${rec.status}</span>`;
      if (inBtn) inBtn.disabled = !!rec.check_in;
      if (outBtn) outBtn.disabled = !rec.check_in || !!rec.check_out;
    } else {
      info.innerHTML = `<strong>${d.name}</strong> · ${todayLabel} 尚未签到（标准：09:00 前正常，17:30 后签退）`;
      if (inBtn) inBtn.disabled = false;
      if (outBtn) outBtn.disabled = true;
    }
  } catch (e) {
    info.textContent = '加载失败，请确认后端已启动';
  }
}

function attQueryBody() {
  return {
    operator: attUser(),
    department_id: document.getElementById('attFilterDept')?.value || null,
    status: document.getElementById('attFilterStatus')?.value || null,
    date_from: document.getElementById('attDateFrom')?.value || null,
    date_to: document.getElementById('attDateTo')?.value || null,
    keyword: document.getElementById('attKeyword')?.value.trim() || null
  };
}

async function loadAttList() {
  const tbody = document.getElementById('attListBody');
  const showAct = attCanManage();
  const cols = showAct ? 9 : 8;
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center">加载中...</td></tr>`;
  try {
    const res = await fetch(ATT_API + '/attendance/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attQueryBody())
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="${cols}" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    renderAttList(res.data || []);
    loadAttSummary();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${cols}" style="color:red;text-align:center">加载失败</td></tr>`;
  }
}

function renderAttList(list) {
  const tbody = document.getElementById('attListBody');
  const showAct = attCanManage();
  const cols = showAct ? 9 : 8;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center">无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(a => {
    const badge = ATT_BADGE[a.status] || 'badge-info';
    const act = showAct ? `<td>
      <button class="row-btn" onclick="openAttEdit(${a.id},'${a.emp_id}','${a.check_date}','${(a.check_in||'').replace(/'/g,"\\'")}','${(a.check_out||'').replace(/'/g,"\\'")}','${a.status}','${(a.remark||'').replace(/'/g,"\\'")}')">编辑</button>
      <button class="row-btn danger" onclick="deleteAttRecord(${a.id},'${a.emp_id}','${a.check_date}')">删除</button>
    </td>` : '';
    return `<tr>
      <td>${a.emp_id}</td><td>${a.name}</td><td>${a.department || '-'}</td><td>${a.check_date}</td>
      <td><span class="badge ${badge}">${a.status}</span></td>
      <td>${a.check_in || '-'}</td><td>${a.check_out || '-'}</td><td>${a.remark || '-'}</td>${act}
    </tr>`;
  }).join('');
}

async function loadAttSummary() {
  if (!attCanExport()) return;
  try {
    const res = await fetch(ATT_API + '/attendance/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attQueryBody())
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('attStatNormal', s.正常 || 0);
    set('attStatLate', s.迟到 || 0);
    set('attStatEarly', s.早退 || 0);
    set('attStatAbsent', s.缺勤 || 0);
    set('attStatLeave', s.请假 || 0);
  } catch (e) { /* ignore */ }
}

async function doCheckIn() {
  const msg = document.getElementById('attPunchMsg');
  if (msg) { msg.textContent = '签到中...'; msg.className = 'reg-result'; }
  try {
    const res = await fetch(ATT_API + '/attendance/check-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: attUser() })
    }).then(r => r.json());
    if (msg) {
      msg.textContent = res.success ? res.message : (res.error || '签到失败');
      msg.className = 'reg-result ' + (res.success ? 'success' : 'error');
    }
    if (res.success) { loadAttToday(); loadAttList(); }
  } catch (e) {
    if (msg) { msg.textContent = '请求失败'; msg.className = 'reg-result error'; }
  }
}

async function doCheckOut() {
  const msg = document.getElementById('attPunchMsg');
  if (msg) { msg.textContent = '签退中...'; msg.className = 'reg-result'; }
  try {
    const res = await fetch(ATT_API + '/attendance/check-out', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: attUser() })
    }).then(r => r.json());
    if (msg) {
      msg.textContent = res.success ? res.message : (res.error || '签退失败');
      msg.className = 'reg-result ' + (res.success ? 'success' : 'error');
    }
    if (res.success) { loadAttToday(); loadAttList(); }
  } catch (e) {
    if (msg) { msg.textContent = '请求失败'; msg.className = 'reg-result error'; }
  }
}

async function syncAttLeave() {
  if (!confirm('将把所有「已批准」请假同步到考勤（覆盖同日期迟到记录），并清理错误日期的请假记录。继续吗？')) return;
  const btn = document.getElementById('attSyncLeaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '同步中...'; }
  try {
    const res = await fetch(ATT_API + '/attendance/sync-leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: attUser() })
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      alert('同步失败：服务器返回异常（' + res.status + '）。请重启「启动后端服务.bat」后再试。');
      return;
    }
    alert(data.success ? data.message : (data.error || '同步失败'));
    if (data.success) { loadAttList(); loadAttSummary(); }
  } catch (e) {
    alert('无法连接后端，请确认已运行 启动后端服务.bat');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '同步假期到考勤'; }
  }
}

async function exportAtt() {
  try {
    const res = await fetch(ATT_API + '/attendance/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attQueryBody())
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || '导出失败');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '考勤导出_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) { alert('导出失败：' + e.message); }
}

function openAttAdd() {
  if (!attCanManage()) return;
  document.getElementById('attFormId').value = '';
  document.getElementById('attFormTitle').textContent = '➕ 补录考勤';
  document.getElementById('attFormEmpId').value = '';
  document.getElementById('attFormEmpId').readOnly = false;
  document.getElementById('attFormDate').value = attLocalDate();
  document.getElementById('attFormCheckIn').value = '';
  document.getElementById('attFormCheckOut').value = '';
  document.getElementById('attFormStatus').value = '';
  document.getElementById('attFormRemark').value = '';
  document.getElementById('attFormResult').textContent = '';
  openModal('modalAttForm');
}

function openAttEdit(id, empId, date, checkIn, checkOut, status, remark) {
  if (!attCanManage()) return;
  document.getElementById('attFormId').value = id;
  document.getElementById('attFormTitle').textContent = '✎ 编辑考勤';
  document.getElementById('attFormEmpId').value = empId;
  document.getElementById('attFormEmpId').readOnly = true;
  document.getElementById('attFormDate').value = date;
  document.getElementById('attFormCheckIn').value = checkIn ? checkIn.slice(0, 5) : '';
  document.getElementById('attFormCheckOut').value = checkOut ? checkOut.slice(0, 5) : '';
  document.getElementById('attFormStatus').value = status || '';
  document.getElementById('attFormRemark').value = remark || '';
  document.getElementById('attFormResult').textContent = '';
  openModal('modalAttForm');
}

async function deleteAttRecord(id, empId, date) {
  const warn =
    '【谨慎操作】您即将删除考勤记录：\n\n' +
    '工号：' + empId + '\n日期：' + date + '\n\n' +
    '· 此操作不可恢复\n' +
    '· 可能影响薪资核算与统计报表\n\n' +
    '确定要继续吗？';
  if (!confirm(warn)) return;
  if (!confirm('请再次确认：是否永久删除该考勤记录？')) return;
  try {
    const res = await fetch(
      ATT_API + '/attendance/' + id + '?operator=' + encodeURIComponent(attUser()),
      { method: 'DELETE' }
    ).then(r => r.json());
    if (res.success) {
      alert(res.message || '已删除');
      loadAttList();
      loadAttSummary();
    } else alert(res.error || '删除失败');
  } catch (e) { alert('删除失败：' + e.message); }
}

function bindAttPanel() {
  const inBtn = document.getElementById('attCheckInBtn');
  const outBtn = document.getElementById('attCheckOutBtn');
  const qBtn = document.getElementById('attQueryBtn');
  const expBtn = document.getElementById('attExportBtn');
  const addBtn = document.getElementById('attAddBtn');
  const syncBtn = document.getElementById('attSyncLeaveBtn');
  const form = document.getElementById('attForm');
  if (inBtn) inBtn.addEventListener('click', doCheckIn);
  if (outBtn) outBtn.addEventListener('click', doCheckOut);
  if (qBtn) qBtn.addEventListener('click', loadAttList);
  if (expBtn) expBtn.addEventListener('click', exportAtt);
  if (syncBtn) syncBtn.addEventListener('click', syncAttLeave);
  if (addBtn) addBtn.addEventListener('click', openAttAdd);
  if (form) form.addEventListener('submit', submitAttForm);
}

async function submitAttForm(e) {
  e.preventDefault();
  const result = document.getElementById('attFormResult');
  const id = document.getElementById('attFormId').value;
  const empId = document.getElementById('attFormEmpId').value.trim();
  const date = document.getElementById('attFormDate').value;
  const checkIn = document.getElementById('attFormCheckIn').value;
  const checkOut = document.getElementById('attFormCheckOut').value;
  const status = document.getElementById('attFormStatus').value;
  const remark = document.getElementById('attFormRemark').value.trim();

  // ----- 新增前端校验（BUG-9,10,11）-----
  // 1. 日期不能晚于今天
  const today = new Date().toISOString().slice(0,10);
  if (date > today) {
    result.textContent = '不能补录未来的考勤日期';
    result.className = 'reg-result error';
    return;
  }
  // 2. 员工ID存在性校验（调用后端接口快速检查）
  try {
    const checkEmp = await fetch(`${ATT_API}/employees/${empId}`).then(r => r.json());
    if (!checkEmp || !checkEmp.emp_id) {
      result.textContent = '员工ID不存在，请检查';
      result.className = 'reg-result error';
      return;
    }
  } catch (err) {
    // 如果后端没有单个查询接口，可以忽略（后端最终会校验）
    console.warn('员工存在性预检失败', err);
  }
  // 3. 签退时间不能早于签到时间（如果两者都填写）
  if (checkIn && checkOut && checkOut <= checkIn) {
    result.textContent = '签退时间必须晚于签到时间';
    result.className = 'reg-result error';
    return;
  }

  const body = {
    operator: attUser(),
    emp_id: empId,
    check_date: date,
    check_in: checkIn ? checkIn + ':00' : null,
    check_out: checkOut ? checkOut + ':00' : null,
    status: status || undefined,
    remark
  };
  result.textContent = '保存中...';
  result.className = 'reg-result';
  try {
    let res;
    if (id) {
      res = await fetch(ATT_API + '/attendance/' + id, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    } else {
      res = await fetch(ATT_API + '/attendance/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(r => r.json());
    }
    result.textContent = res.success ? res.message : (res.error || '保存失败');
    result.className = 'reg-result ' + (res.success ? 'success' : 'error');
    if (res.success) {
      setTimeout(() => { closeModal('modalAttForm'); loadAttList(); loadAttSummary(); }, 1000);
    }
  } catch (err) {
    result.textContent = '请求失败';
    result.className = 'reg-result error';
  }
}

function onAttendancePanelShow() {
  if (attIsMgr() && !attIsHR()) {
    if (typeof ensureMyDeptId === 'function') ensureMyDeptId().then(() => loadAttDeptOptions());
  }
  loadAttToday();
  loadAttList();
}