// leave-module.js - 假期管理 J1~J4
const LEAVE_API = 'http://localhost:3001/api';

const LEAVE_BADGE = {
  '待审批': 'badge-warning', '已批准': 'badge-success', '已拒绝': 'badge-danger'
};

function lvUser() { return sessionStorage.getItem('currentUsername') || ''; }
function lvRole() { return sessionStorage.getItem('currentRole') || ''; }
function lvIsHR() { return ['HR专员', '管理员'].includes(lvRole()) || lvUser() === 'root'; }
function lvIsMgr() { return lvRole() === '部门主管'; }
function lvCanApprove() { return lvIsMgr() || lvIsHR(); }
function lvCanExport() { return lvCanApprove(); }

document.addEventListener('DOMContentLoaded', function () {
  initLeaveModule();
});

function initLeaveModule() {
  setupLeaveUI();
  bindLeavePanel();
}

function setupLeaveUI() {
  const add = document.getElementById('lvAddBtn');
  const isRoot = lvUser() === 'root' || !sessionStorage.getItem('empId');
  if (add) {
    add.style.display = isRoot ? 'none' : '';
    if (isRoot) add.title = '管理员账号请使用员工账号提交请假';
  }
  if (lvCanExport()) {
    ['lvExportBtn', 'lvFilterDept', 'lvPendingBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
  }
  const tip = document.getElementById('lvPanelTip');
  if (tip) {
    if (lvUser() === 'root') {
      tip.textContent = '管理员：可查看/审批全部请假、导出报表；「待审批」数量与控制台一致';
    } else if (lvCanApprove()) {
      tip.textContent = '部门主管/HR：可审批本部门（或全部）待办请假；批准后将同步考勤为「请假」';
    } else {
      tip.textContent = '可提交请假申请、查看个人记录；待审批状态可撤销';
    }
  }
  loadLvDeptOptions();
}

async function loadLvDeptOptions() {
  if (!lvCanExport()) return;
  try {
    const depts = await fetch(LEAVE_API + '/departments/list').then(r => r.json());
    const sel = document.getElementById('lvFilterDept');
    if (!sel || sel.options.length > 1) return;
    depts.forEach(d => sel.add(new Option(d.name, d.id)));
    if (lvIsMgr() && !lvIsHR()) {
      const deptId = sessionStorage.getItem('departmentId');
      if (deptId) { sel.value = deptId; sel.disabled = true; }
      if (typeof ensureMyDeptId === 'function') {
        ensureMyDeptId().then(id => { if (id) { sel.value = id; sel.disabled = true; } });
      }
    }
  } catch (e) { /* ignore */ }
}

function lvQueryBody(extra) {
  return Object.assign({
    operator: lvUser(),
    status: document.getElementById('lvFilterStatus')?.value || null,
    leave_type: document.getElementById('lvFilterType')?.value || null,
    date_from: document.getElementById('lvDateFrom')?.value || null,
    date_to: document.getElementById('lvDateTo')?.value || null,
    keyword: document.getElementById('lvKeyword')?.value.trim() || null,
    department_id: document.getElementById('lvFilterDept')?.value || null
  }, extra || {});
}

let lvListCache = [];

async function loadLeaveMySummary() {
  const el = document.getElementById('lvMySummary');
  if (!el) return;
  try {
    const res = await fetch(LEAVE_API + '/leave/my?username=' + encodeURIComponent(lvUser())).then(r => r.json());
    if (!res.success) { el.textContent = res.error || '加载失败'; return; }
    if (res.is_admin) {
      el.innerHTML = `管理员视图 · 全系统待审批 <strong>${res.pending_all || 0}</strong> 条（与控制台「待审假期」一致）`;
      return;
    }
    el.innerHTML = `本年度已批准请假 <strong>${res.used_days_year || 0}</strong> 天 · 我的申请共 <strong>${(res.records || []).length}</strong> 条`;
  } catch (e) {
    el.textContent = '加载失败，请确认后端已启动';
  }
}

async function loadLeaveList(extra) {
  const tbody = document.getElementById('lvListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await fetch(LEAVE_API + '/leave/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lvQueryBody(extra))
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    lvListCache = res.data || [];
    renderLeaveList(lvListCache);
    loadLeaveSummary();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function renderLeaveList(list) {
  const tbody = document.getElementById('lvListBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">无数据</td></tr>';
    return;
  }
  const myEmp = sessionStorage.getItem('empId') || '';
  tbody.innerHTML = list.map(r => {
    const badge = LEAVE_BADGE[r.status] || 'badge-info';
    let acts = `<button class="row-btn" onclick="openLeaveDetail('${r.apply_id}')">查看</button>`;
    if (r.status === '待审批' && lvCanApprove()) {
      acts += ` <button class="row-btn primary" onclick="approveLeave('${r.apply_id}','approve')">批准</button>`;
      acts += ` <button class="row-btn danger" onclick="approveLeave('${r.apply_id}','reject')">拒绝</button>`;
    }
    if (r.status === '待审批' && (r.emp_id === myEmp || lvIsHR())) {
      acts += ` <button class="row-btn danger" onclick="cancelLeave('${r.apply_id}','${(r.name || '').replace(/'/g, "\\'")}')">撤销</button>`;
    }
    return `<tr><td>${r.apply_id}</td><td>${r.name}</td><td>${r.emp_id}</td><td>${r.leave_type}</td>
      <td>${r.start_date}</td><td>${r.end_date}</td><td>${r.days}</td>
      <td><span class="badge ${badge}">${r.status}</span></td><td>${acts}</td></tr>`;
  }).join('');
}

async function loadLeaveSummary() {
  try {
    const res = await fetch(LEAVE_API + '/leave/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lvQueryBody())
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('lvStatMonth', s.month_apply || 0);
    set('lvStatApproved', s.已批准 || 0);
    set('lvStatPending', s.pending_all != null ? s.pending_all : (s.待审批 || 0));
  } catch (e) { /* ignore */ }
}

function openLeaveApply() {
  if (lvUser() === 'root' || !sessionStorage.getItem('empId')) {
    alert('管理员（root）账号无员工档案，请使用员工或 HR 账号提交请假申请');
    return;
  }
  document.getElementById('lvApplyForm').reset();
  document.getElementById('lvApplyResult').textContent = '';
  const n = new Date();
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  document.getElementById('lvApplyStart').value = today;
  document.getElementById('lvApplyEnd').value = today;
  openModal('modalLeaveApply');
}

function openLeaveDetail(applyId) {
  const r = lvListCache.find(x => x.apply_id === applyId);
  if (!r) { alert('记录不存在'); return; }
  let msg = `申请编号：${r.apply_id}\n员工：${r.name}（${r.emp_id}）\n类型：${r.leave_type}\n`;
  msg += `日期：${r.start_date} 至 ${r.end_date}（${r.days}天）\n原因：${r.reason || '-'}\n状态：${r.status}`;
  if (r.approve_comment) msg += `\n审批意见：${r.approve_comment}`;
  alert(msg);
}

async function approveLeave(applyId, action) {
  const label = action === 'approve' ? '批准' : '拒绝';
  const comment = prompt(`请输入${label}意见（可选）：`, '') || '';
  if (action === 'reject' && !confirm(`确定拒绝申请 ${applyId}？`)) return;
  if (action === 'approve' && !confirm(`确定批准申请 ${applyId}？\n批准后将同步考勤记录为「请假」。`)) return;
  try {
    const res = await fetch(LEAVE_API + '/leave/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: lvUser(), apply_id: applyId, action, comment })
    }).then(r => r.json());
    alert(res.success ? (res.message + '\n请到「考勤管理」将状态筛选为「请假」或扩大日期范围查看同步记录。') : (res.error || '操作失败'));
    if (res.success) loadLeaveList();
  } catch (e) { alert('请求失败'); }
}

async function cancelLeave(applyId, name) {
  const warn =
    '【谨慎操作】确定撤销请假申请？\n\n' +
    '申请编号：' + applyId + '\n员工：' + name + '\n\n' +
    '· 仅待审批状态可撤销\n' +
    '· 此操作不可恢复\n\n' +
    '确定继续吗？';
  if (!confirm(warn)) return;
  try {
    const res = await fetch(
      LEAVE_API + '/leave/' + encodeURIComponent(applyId) + '?operator=' + encodeURIComponent(lvUser()),
      { method: 'DELETE' }
    ).then(r => r.json());
    alert(res.success ? res.message : (res.error || '撤销失败'));
    if (res.success) { loadLeaveList(); loadLeaveMySummary(); }
  } catch (e) { alert('撤销失败'); }
}

async function exportLeave() {
  try {
    const res = await fetch(LEAVE_API + '/leave/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lvQueryBody())
    });
    if (!res.ok) { alert('导出失败'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '假期导出_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) { alert('导出失败'); }
}

function bindLeavePanel() {
  const add = document.getElementById('lvAddBtn');
  const q = document.getElementById('lvQueryBtn');
  const exp = document.getElementById('lvExportBtn');
  const pend = document.getElementById('lvPendingBtn');
  const form = document.getElementById('lvApplyForm');
  if (add) add.addEventListener('click', openLeaveApply);
  if (q) q.addEventListener('click', () => loadLeaveList());
  if (exp) exp.addEventListener('click', exportLeave);
  if (pend) pend.addEventListener('click', () => loadLeaveList({ scope: 'pending' }));
  if (form) form.addEventListener('submit', submitLeaveApply);
}

async function submitLeaveApply(e) {
  e.preventDefault();
  const result = document.getElementById('lvApplyResult');
  result.textContent = '提交中...';
  try {
    const res = await fetch(LEAVE_API + '/leave/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: lvUser(),
        leave_type: document.getElementById('lvApplyType').value,
        start_date: document.getElementById('lvApplyStart').value,
        end_date: document.getElementById('lvApplyEnd').value,
        reason: document.getElementById('lvApplyReason').value.trim()
      })
    }).then(r => r.json());
    result.textContent = res.success ? res.message : (res.error || '提交失败');
    result.className = 'reg-result ' + (res.success ? 'success' : 'error');
    if (res.success) {
      setTimeout(() => { closeModal('modalLeaveApply'); loadLeaveList(); loadLeaveMySummary(); }, 1000);
    }
  } catch (err) {
    result.textContent = '请求失败';
    result.className = 'reg-result error';
  }
}

function onLeavePanelShow() {
  loadLeaveMySummary();
  loadLeaveList();
}
