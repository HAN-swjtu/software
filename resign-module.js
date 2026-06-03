// resign-module.js - 离职管理 P1~P4
const RS_API = 'http://localhost:3001/api';

const RS_BADGE = {
  '待主管审批': 'badge-warning',
  '待HR审批': 'badge-info',
  '已批准': 'badge-success',
  '已拒绝': 'badge-danger',
  '已撤销': 'badge-danger'
};

function rsUser() { return sessionStorage.getItem('currentUsername') || ''; }
function rsRole() { return sessionStorage.getItem('currentRole') || ''; }
function rsIsHR() { return ['HR专员', '管理员'].includes(rsRole()) || rsUser() === 'root'; }
function rsIsMgr() { return rsRole() === '部门主管'; }
function rsCanMgrApprove() { return rsIsMgr() || rsIsHR(); }
function rsCanHrApprove() { return rsIsHR(); }
function rsCanExport() { return rsCanMgrApprove(); }

let rsAppCache = [];
let rsArchCache = [];
let rsViewMode = 'apply';

document.addEventListener('DOMContentLoaded', function () {
  initResignModule();
});

function initResignModule() {
  setupResignUI();
  bindResignPanel();
}

function setupResignUI() {
  const add = document.getElementById('rsAddBtn');
  const isRoot = rsUser() === 'root' || !sessionStorage.getItem('empId');
  if (add) add.style.display = isRoot ? 'none' : '';
  ['rsPendingMgrBtn', 'rsPendingHrBtn', 'rsExportBtn', 'rsArchExportBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'rsPendingHrBtn') el.style.display = rsCanHrApprove() ? '' : 'none';
    else if (id === 'rsExportBtn' || id === 'rsArchExportBtn') el.style.display = rsCanExport() ? '' : 'none';
    else el.style.display = rsCanMgrApprove() ? '' : 'none';
  });
  if (rsIsHR() || rsIsMgr()) {
    const dept = document.getElementById('rsFilterDept');
    if (dept) dept.style.display = '';
    loadRsDeptOptions();
  }
  const tip = document.getElementById('rsPanelTip');
  if (tip) {
    if (rsCanHrApprove()) {
      tip.textContent = '流程：员工申请 → 部门主管审批 → HR 终审 → 自动归档并更新为「已离职」';
    } else if (rsIsMgr()) {
      tip.textContent = '部门主管：可审批本部门「待主管审批」的离职申请';
    } else {
      tip.textContent = '可提交离职申请并查看进度；审批通过后系统自动归档';
    }
  }
}

async function loadRsDeptOptions() {
  try {
    const depts = await fetch(RS_API + '/departments/list').then(r => r.json());
    const sel = document.getElementById('rsFilterDept');
    if (!sel || sel.options.length > 1) return;
    depts.forEach(d => sel.add(new Option(d.name, d.id)));
    if (rsIsMgr() && !rsIsHR()) {
      const deptId = sessionStorage.getItem('departmentId');
      if (deptId) { sel.value = deptId; sel.disabled = true; }
    }
  } catch (e) { /* ignore */ }
}

function rsQueryBody(extra) {
  return {
    operator: rsUser(),
    department_id: document.getElementById('rsFilterDept')?.value || null,
    status: document.getElementById('rsFilterStatus')?.value || null,
    date_from: document.getElementById('rsDateFrom')?.value || null,
    date_to: document.getElementById('rsDateTo')?.value || null,
    keyword: document.getElementById('rsKeyword')?.value?.trim() || null,
    scope: extra?.scope || null
  };
}

function setRsView(mode) {
  rsViewMode = mode;
  document.getElementById('rsViewApply')?.classList.toggle('active', mode === 'apply');
  document.getElementById('rsViewArch')?.classList.toggle('active', mode === 'arch');
  document.getElementById('rsApplySection').style.display = mode === 'apply' ? '' : 'none';
  document.getElementById('rsArchSection').style.display = mode === 'arch' ? '' : 'none';
  if (mode === 'apply') loadResignList();
  else loadResignArchives();
}

async function loadResignSummary() {
  try {
    const res = await fetch(RS_API + '/resign/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: rsUser(), department_id: document.getElementById('rsFilterDept')?.value || null })
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rsStatMonth', s.month_apply || 0);
    set('rsStatPendingMgr', s.pending_mgr || 0);
    set('rsStatPendingHr', s.pending_hr || 0);
    set('rsStatArchive', s.archive_total || 0);
  } catch (e) { /* ignore */ }
}

async function loadResignList(extra) {
  const tbody = document.getElementById('rsListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">加载中...</td></tr>';
  try {
    const resp = await fetch(RS_API + '/resign/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rsQueryBody(extra))
    });
    const text = await resp.text();
    let res;
    try { res = JSON.parse(text); } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">接口未就绪，请重启「启动后端服务.bat」后刷新页面</td></tr>';
      return;
    }
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    rsAppCache = res.data || [];
    renderResignList(rsAppCache);
    loadResignSummary();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function renderResignList(list) {
  const tbody = document.getElementById('rsListBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">无数据</td></tr>';
    return;
  }
  const myEmp = sessionStorage.getItem('empId') || '';
  tbody.innerHTML = list.map(r => {
    const badge = RS_BADGE[r.status] || 'badge-info';
    let acts = `<button class="row-btn" onclick="openResignDetail('${r.apply_id}')">查看</button>`;
    if (r.status === '待主管审批' && rsCanMgrApprove()) {
      acts += ` <button class="row-btn primary" onclick="approveResign('${r.apply_id}','mgr_approve')">主管通过</button>`;
      acts += ` <button class="row-btn danger" onclick="approveResign('${r.apply_id}','mgr_reject')">主管拒绝</button>`;
    }
    if (r.status === '待HR审批' && rsCanHrApprove()) {
      acts += ` <button class="row-btn primary" onclick="approveResign('${r.apply_id}','hr_approve')">HR批准</button>`;
      acts += ` <button class="row-btn danger" onclick="approveResign('${r.apply_id}','hr_reject')">HR拒绝</button>`;
    }
    if (['待主管审批', '待HR审批'].includes(r.status) && (r.emp_id === myEmp || rsIsHR())) {
      acts += ` <button class="row-btn danger" onclick="cancelResign('${r.apply_id}')">撤销</button>`;
    }
    return `<tr><td>${r.apply_id}</td><td>${r.name}</td><td>${r.emp_id}</td><td>${r.department || '-'}</td>
      <td>${fmtRsDate(r.expected_resign_date)}</td><td>${(r.resign_reason || '').slice(0, 20)}${(r.resign_reason || '').length > 20 ? '…' : ''}</td>
      <td><span class="badge ${badge}">${r.status}</span></td><td>${acts}</td></tr>`;
  }).join('');
}

async function loadResignArchives() {
  const tbody = document.getElementById('rsArchBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">加载中...</td></tr>';
  try {
    const kw = document.getElementById('rsArchKeyword')?.value?.trim() || '';
    const dept = document.getElementById('rsFilterDept')?.value || '';
    let url = RS_API + '/resigned-archives?operator=' + encodeURIComponent(rsUser());
    if (dept) url += '&department_id=' + dept;
    if (kw) url += '&keyword=' + encodeURIComponent(kw);
    const resp = await fetch(url);
    const text = await resp.text();
    let res;
    try { res = JSON.parse(text); } catch (e) {
      tbody.innerHTML = '<tr><td colspan="9" style="color:red;text-align:center">接口未就绪，请重启后端后刷新</td></tr>';
      return;
    }
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    rsArchCache = res.data || [];
    document.getElementById('rsStatArchive').textContent = rsArchCache.length;
    renderResignArchives(rsArchCache);
    loadResignSummary();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function renderResignArchives(list) {
  const tbody = document.getElementById('rsArchBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">暂无离职归档</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((a, i) => `<tr>
    <td>${a.archive_id}</td><td>${a.emp_id}</td><td>${a.name}</td><td>${a.department || '-'}</td>
    <td>${a.role_name || '-'}</td><td>${fmtRsDate(a.hire_date)}</td><td>${fmtRsDate(a.resign_date)}</td>
    <td>${(a.resign_reason || '').slice(0, 16)}</td>
    <td><button class="row-btn" onclick="showResignArchive(${i})">档案</button></td>
  </tr>`).join('');
}

function fmtRsDate(d) {
  if (!d) return '-';
  return String(d).slice(0, 10);
}

function rsLocalDate(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rsTomorrow() {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  return rsLocalDate(n);
}

function openResignApply() {
  if (rsUser() === 'root' || !sessionStorage.getItem('empId')) {
    alert('请使用员工账号提交离职申请');
    return;
  }
  document.getElementById('rsApplyForm').reset();
  document.getElementById('rsApplyResult').textContent = '';
  const minDate = rsTomorrow();
  document.getElementById('rsApplyDate').value = minDate;
  document.getElementById('rsApplyDate').min = minDate;
  openModal('modalResignApply');
}

function openResignDetail(applyId) {
  const r = rsAppCache.find(x => x.apply_id === applyId);
  if (!r) { alert('记录不存在'); return; }
  let msg = `申请编号：${r.apply_id}\n员工：${r.name}（${r.emp_id}）\n部门：${r.department}\n预计离职：${r.expected_resign_date}\n`;
  msg += `原因：${r.resign_reason || '-'}\n交接计划：${r.handover_plan || '-'}\n状态：${r.status}`;
  if (r.mgr_time) msg += `\n主管意见：${r.mgr_comment || '-'}（${r.mgr_approver_id}）`;
  if (r.hr_time) msg += `\nHR意见：${r.hr_comment || '-'}（${r.hr_approver_id}）`;
  alert(msg);
}

function showResignArchive(idx) {
  const a = rsArchCache[idx];
  document.getElementById('archiveDetailBody').innerHTML = `
    <div class="mine-info-list">${[
      ['归档编号', a.archive_id], ['申请编号', a.apply_id], ['工号', a.emp_id], ['姓名', a.name],
      ['部门', a.department], ['角色', a.role_name], ['入职', a.hire_date], ['离职', a.resign_date],
      ['工龄(年)', a.work_years], ['离职原因', a.resign_reason], ['工作经历', a.work_history],
      ['绩效记录', a.performance_record], ['交接情况', a.handover_status],
      ['归档状态', a.archive_status], ['归档时间', a.archived_at]
    ].map(([k, v]) => `<div class="mine-info-item"><span class="mine-info-label">${k}</span><span class="mine-info-val">${v || '-'}</span></div>`).join('')}
    </div>`;
  openModal('modalArchiveDetail');
}

async function approveResign(applyId, action) {
  const labels = {
    mgr_approve: '主管通过', mgr_reject: '主管拒绝',
    hr_approve: 'HR批准离职', hr_reject: 'HR拒绝'
  };
  const comment = prompt(`请输入${labels[action]}意见（可选）：`, '') || '';
  if (action.includes('reject') && !confirm(`确定${labels[action]}申请 ${applyId}？`)) return;
  if (action === 'hr_approve' && !confirm(`确定批准 ${applyId}？\n将更新员工为「已离职」并写入离职档案。`)) return;
  try {
    const res = await fetch(RS_API + '/resign/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: rsUser(), apply_id: applyId, action, comment })
    }).then(r => r.json());
    alert(res.success ? res.message : (res.error || '操作失败'));
    if (res.success) {
      loadResignList();
      if (action === 'hr_approve') loadResignArchives();
    }
  } catch (e) { alert('请求失败'); }
}

async function cancelResign(applyId) {
  if (!confirm('确定撤销该离职申请？')) return;
  try {
    const res = await fetch(
      RS_API + '/resign/' + encodeURIComponent(applyId) + '?operator=' + encodeURIComponent(rsUser()),
      { method: 'DELETE' }
    ).then(r => r.json());
    alert(res.success ? res.message : (res.error || '撤销失败'));
    if (res.success) loadResignList();
  } catch (e) { alert('请求失败'); }
}

async function exportResignApps() {
  try {
    const res = await fetch(RS_API + '/resign/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rsQueryBody())
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '离职申请_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) { alert('导出失败'); }
}

async function exportResignArch() {
  try {
    const res = await fetch(RS_API + '/resign/archives/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: rsUser(),
        keyword: document.getElementById('rsArchKeyword')?.value?.trim() || null
      })
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '离职归档_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) { alert('导出失败'); }
}

function bindResignPanel() {
  document.getElementById('rsAddBtn')?.addEventListener('click', openResignApply);
  document.getElementById('rsQueryBtn')?.addEventListener('click', () => loadResignList());
  document.getElementById('rsPendingMgrBtn')?.addEventListener('click', () => loadResignList({ scope: 'pending_mgr' }));
  document.getElementById('rsPendingHrBtn')?.addEventListener('click', () => loadResignList({ scope: 'pending_hr' }));
  document.getElementById('rsExportBtn')?.addEventListener('click', exportResignApps);
  document.getElementById('rsArchQueryBtn')?.addEventListener('click', loadResignArchives);
  document.getElementById('rsArchExportBtn')?.addEventListener('click', exportResignArch);
  document.getElementById('rsViewApply')?.addEventListener('click', () => setRsView('apply'));
  document.getElementById('rsViewArch')?.addEventListener('click', () => setRsView('arch'));
  document.getElementById('rsApplyForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('rsApplyResult');
    result.textContent = '提交中...';
    try {
      const res = await fetch(RS_API + '/resign/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: rsUser(),
          expected_resign_date: document.getElementById('rsApplyDate').value,
          resign_reason: document.getElementById('rsApplyReason').value.trim(),
          handover_plan: document.getElementById('rsApplyHandover').value.trim()
        })
      }).then(r => r.json());
      result.textContent = res.success ? res.message : (res.error || '提交失败');
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalResignApply'); loadResignList(); }, 1000);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });
}

function onResignPanelShow() {
  setRsView('apply');
  loadResignSummary();
}
