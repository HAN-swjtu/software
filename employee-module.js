// employee-module.js - 员工管理模块 P1~P4 前端
const EMS_API = 'http://localhost:3001/api';

function emsUser() { return sessionStorage.getItem('currentUsername') || ''; }
function emsRole() { return sessionStorage.getItem('currentRole') || ''; }
function isHR() { return ['HR专员', '管理员'].includes(emsRole()) || emsUser() === 'root'; }
function isManager() { return emsRole() === '部门主管' || isHR(); }
function isDeptManagerOnly() { return emsRole() === '部门主管'; }
function myDeptId() { return sessionStorage.getItem('departmentId') || ''; }

async function ensureMyDeptId() {
  let id = myDeptId();
  if (id) return id;
  const uname = emsUser();
  if (!uname || uname === 'root') return '';
  try {
    const p = await fetch(EMS_API + '/my-profile?username=' + encodeURIComponent(uname)).then(r => r.json());
    if (p.department_id) {
      sessionStorage.setItem('departmentId', String(p.department_id));
      return String(p.department_id);
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function fetchDeptManageList() {
  const res = await fetch(EMS_API + '/departments/manage');
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error('服务未更新，请重启后端后刷新页面（接口返回非 JSON）');
  }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  if (data.success === false) throw new Error(data.error || '请求失败');
  if (data.success && data.data) return data.data;

  const fallback = await fetch(EMS_API + '/department-stats').then(r => r.json());
  return (fallback.data || []).map(d => ({
    id: d.department_id,
    name: d.department_name,
    manager_name: '-',
    active_count: d.active_count,
    probation_count: d.probation_count,
    resigned_count: d.resigned_count,
    stat_time: d.stat_time,
    total_employees: (d.active_count || 0) + (d.probation_count || 0)
  }));
}

const STATUS_BADGE = { '在职': 'badge-success', '试用期': 'badge-warning', '已离职': 'badge-danger' };

function formatHireDate(e) {
  const d = e.hire_date || e.created_at;
  if (!d) return '-';
  if (typeof d === 'string') return d.slice(0, 10);
  return d;
}

document.addEventListener('DOMContentLoaded', function () {
  initEmployeeModule();
});

function initEmployeeModule() {
  setupRoleUI();
  bindEmployeePanel();
  bindDepartmentPanel();
  bindProfileEdit();
  bindProbation();
  bindStatusChange();
}

function setupRoleUI() {
  if (isHR()) {
    const exp = document.getElementById('empExportBtn');
    const add = document.getElementById('empAddBtn');
    const col = document.getElementById('empActionCol');
    if (exp) exp.style.display = '';
    if (add) add.style.display = '';
    if (col) col.style.display = '';
  }
  if (emsRole() === '普通员工' || emsRole() === '部门主管') {
    const btn = document.getElementById('btnEditProfile');
    if (btn) btn.style.display = '';
  }
  if (emsRole() === '普通员工') {
    const sec = document.getElementById('probationSection');
    if (sec) sec.style.display = '';
  }
  if (isManager()) {
    const sec = document.getElementById('probationApproveSection');
    if (sec) sec.style.display = '';
  }
  loadFilterOptions();
}

async function loadFilterOptions() {
  try {
    const [depts, roles] = await Promise.all([
      fetch(EMS_API + '/departments/list').then(r => r.json()),
      fetch(EMS_API + '/roles').then(r => r.json())
    ]);
    const dSel = document.getElementById('empFilterDept');
    if (dSel && dSel.options.length <= 1) depts.forEach(d => dSel.add(new Option(d.name, d.id)));
    const rSel = document.getElementById('empFilterRole');
    if (rSel && rSel.options.length <= 1) roles.forEach(r => rSel.add(new Option(r.name, r.id)));
  } catch (e) { /* ignore */ }
}

// ========== 员工列表 P4 ==========
let empListData = [];

async function loadEmployeeList() {
  const tbody = document.getElementById('empListBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px">加载中...</td></tr>';
  try {
    const list = await fetch(EMS_API + '/employees').then(r => r.json());
    empListData = list;
    renderEmpList(list);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function renderEmpList(list) {
  const tbody = document.getElementById('empListBody');
  const showAct = isHR();
  const cols = showAct ? 7 : 6;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center">无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(e => {
    const badge = STATUS_BADGE[e.emp_status] || 'badge-info';
    const act = showAct ? `<td>
      <button class="row-btn" onclick="openStatusChange('${e.emp_id}','${e.name}','${e.emp_status}')">变更状态</button>
      <button class="row-btn danger" onclick="deleteEmployee('${e.emp_id}','${(e.name || '').replace(/'/g, "\\'")}')">删除</button>
    </td>` : '';
    return `<tr>
      <td>${e.emp_id}</td><td>${e.name}</td><td>${e.department || '-'}</td><td>${e.role || '-'}</td>
      <td><span class="badge ${badge}">${e.emp_status || '在职'}</span></td><td>${formatHireDate(e)}</td>${act}
    </tr>`;
  }).join('');
}

async function deleteEmployee(empId, name) {
  const warn =
    '【谨慎操作】您即将永久删除员工「' + name + '」（' + empId + '）。\n\n' +
    '· 此操作不可恢复\n' +
    '· 该员工的考勤、请假、转正申请等关联数据将一并删除\n' +
    '· 若其为部门负责人，将自动解除负责人职务\n\n' +
    '确定要继续吗？';
  if (!confirm(warn)) return;
  if (!confirm('请再次确认：是否永久删除该员工？')) return;
  try {
    const res = await fetch(
      EMS_API + '/employees/' + encodeURIComponent(empId) + '?operator=' + encodeURIComponent(emsUser()),
      { method: 'DELETE' }
    ).then(r => r.json());
    if (res.success) {
      alert(res.message || '已删除');
      allEmployees = [];
      empListData = [];
      loadEmployeeList();
      loadDepartmentStats();
      loadFilterOptions();
    } else {
      alert(res.error || '删除失败');
    }
  } catch (e) {
    alert('删除失败：' + e.message);
  }
}

function bindEmployeePanel() {
  const search = document.getElementById('empListSearch');
  const filterBtn = document.getElementById('empFilterBtn');
  const exportBtn = document.getElementById('empExportBtn');
  if (search) search.addEventListener('input', function () {
    const kw = this.value.trim().toLowerCase();
    if (!kw) { renderEmpList(empListData); return; }
    renderEmpList(empListData.filter(e => [e.emp_id, e.name, e.department, e.role].some(v => v && String(v).toLowerCase().includes(kw))));
  });
  if (filterBtn) filterBtn.addEventListener('click', doEmployeeFilter);
  if (exportBtn) exportBtn.addEventListener('click', doEmployeeExport);
}

async function doEmployeeFilter() {
  const info = document.getElementById('empReportInfo');
  info.textContent = '筛选中...';
  const body = {
    operator: emsUser(),
    department_id: document.getElementById('empFilterDept').value || null,
    role_id: document.getElementById('empFilterRole').value || null,
    emp_status: document.getElementById('empFilterStatus').value || null,
    hire_from: document.getElementById('empFilterFrom').value || null,
    hire_to: document.getElementById('empFilterTo').value || null,
    sort_by: 'hire_date', sort_order: 'desc'
  };
  try {
    const res = await fetch(EMS_API + '/employees/filter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    if (res.success) {
      empListData = res.report.employees;
      renderEmpList(empListData);
      info.textContent = `报表 ${res.report.report_id}：共 ${res.report.total} 人（${new Date(res.report.generated_at).toLocaleString()}）`;
      info.className = 'reg-result success';
    } else { info.textContent = res.error || '筛选失败'; info.className = 'reg-result error'; }
  } catch (e) { info.textContent = '请求失败'; info.className = 'reg-result error'; }
}

async function doEmployeeExport() {
  const body = {
    operator: emsUser(), format: 'Excel',
    department_id: document.getElementById('empFilterDept').value || null,
    role_id: document.getElementById('empFilterRole').value || null,
    emp_status: document.getElementById('empFilterStatus').value || null,
    hire_from: document.getElementById('empFilterFrom').value || null,
    hire_to: document.getElementById('empFilterTo').value || null
  };
  try {
    const res = await fetch(EMS_API + '/employees/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'employees.csv';
    a.click();
  } catch (e) { alert('导出失败：' + e.message); }
}

// ========== 部门管理 P3 / D3 ==========
let deptManageList = [];
let currentDeptQueryId = null;

function setupDeptPanelUI() {
  const addBtn = document.getElementById('deptAddBtn');
  const expStats = document.getElementById('deptExportStatsBtn');
  const deptSelect = document.getElementById('deptSelect');
  const tip = document.getElementById('deptPanelTip');
  if (isHR()) {
    if (addBtn) addBtn.style.display = '';
    if (expStats) expStats.style.display = '';
    if (deptSelect) deptSelect.style.display = '';
    if (tip) tip.textContent = 'HR/管理员：可维护全部部门，并联动员工列表、离职归档等模块。';
    if (tip) tip.className = 'reg-result';
  } else if (isDeptManagerOnly()) {
    if (deptSelect) deptSelect.style.display = 'none';
    if (tip) {
      tip.textContent = '部门主管：仅可查看本部门员工状态（文档 P3 部门员工查询）。';
      tip.className = 'reg-result';
    }
  }
}

async function loadDepartmentStats() {
  const tbody = document.getElementById('deptStatsBody');
  if (!tbody) return;
  setupDeptPanelUI();
  try {
    if (isDeptManagerOnly()) {
      const deptId = await ensureMyDeptId();
      currentDeptQueryId = deptId ? parseInt(deptId, 10) : null;
      if (!deptId) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#e05252">未获取到所属部门，请退出后重新登录</td></tr>';
        return;
      }
    }
    deptManageList = await fetchDeptManageList();
    const showAdmin = isHR();
    if (isDeptManagerOnly() && currentDeptQueryId) {
      deptManageList = deptManageList.filter(d => String(d.id) === String(currentDeptQueryId));
    }
    const sel = document.getElementById('deptSelect');
    if (sel && sel.options.length <= 1) {
      deptManageList.forEach(d => sel.add(new Option(d.name, d.id)));
    }
    if (!deptManageList.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">无部门数据</td></tr>';
      return;
    }
    tbody.innerHTML = deptManageList.map(d => {
      const adminBtns = showAdmin ? `
        <button class="row-btn" onclick="openDeptForm(${d.id})">编辑</button>
        <button class="row-btn danger" onclick="deleteDept(${d.id})">删除</button>` : '';
      return `<tr>
        <td>D${String(d.id).padStart(3, '0')}</td><td>${d.name}</td>
        <td>${d.manager_name || '-'}</td>
        <td>${d.active_count ?? 0}</td><td>${d.probation_count ?? 0}</td><td>${d.resigned_count ?? 0}</td>
        <td>${d.total_employees ?? 0}</td>
        <td>
          <button class="row-btn" onclick="queryDeptEmployees(${d.id})">查看员工</button>
          <button class="row-btn" onclick="goEmployeeListByDept(${d.id})">员工列表</button>
          ${adminBtns}
        </td>
      </tr>`;
    }).join('');
    if (isDeptManagerOnly() && currentDeptQueryId) {
      queryDeptEmployees(currentDeptQueryId);
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败：' + (e.message || '') + '</td></tr>';
  }
}

function bindDepartmentPanel() {
  const qBtn = document.getElementById('deptEmpQueryBtn');
  const refreshBtn = document.getElementById('deptRefreshBtn');
  const expStats = document.getElementById('deptExportStatsBtn');
  const expEmp = document.getElementById('deptExportEmpBtn');
  const addBtn = document.getElementById('deptAddBtn');
  const form = document.getElementById('deptForm');
  const sel = document.getElementById('deptSelect');
  if (qBtn) qBtn.addEventListener('click', () => {
    const id = sel && sel.style.display !== 'none' && sel.value ? parseInt(sel.value) : currentDeptQueryId;
    queryDeptEmployees(id, document.getElementById('deptEmpSearch').value);
  });
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadDepartmentStats());
  if (expStats) expStats.addEventListener('click', () => window.open(EMS_API + '/departments/export-stats', '_blank'));
  if (expEmp) expEmp.addEventListener('click', exportDeptEmployees);
  if (addBtn) addBtn.addEventListener('click', () => openDeptForm(null));
  if (form) form.addEventListener('submit', saveDeptForm);
  if (sel) sel.addEventListener('change', function () {
    if (this.value) queryDeptEmployees(parseInt(this.value, 10));
  });
}

function goEmployeeListByDept(deptId) {
  sessionStorage.setItem('pendingDeptFilter', String(deptId));
  const nav = document.querySelector('.nav-item[data-panel="employees"]');
  if (nav) nav.click();
}

function applyPendingDeptFilter() {
  const id = sessionStorage.getItem('pendingDeptFilter');
  if (!id) return;
  sessionStorage.removeItem('pendingDeptFilter');
  const sel = document.getElementById('empFilterDept');
  if (sel) { sel.value = id; doEmployeeFilter(); }
}

async function exportDeptEmployees() {
  const sel = document.getElementById('deptSelect');
  let deptId = currentDeptQueryId || await ensureMyDeptId();
  if (sel && sel.style.display !== 'none' && sel.value) deptId = sel.value;
  if (!deptId) { alert('请先选择部门或查询部门员工'); return; }
  const kw = document.getElementById('deptEmpSearch').value.trim();
  const params = new URLSearchParams({ username: emsUser(), department_id: deptId });
  if (kw) params.set('keyword', kw);
  window.open(EMS_API + '/dept-employees/export?' + params.toString(), '_blank');
}

async function openDeptForm(deptId) {
  if (!isHR()) return;
  document.getElementById('deptFormResult').textContent = '';
  document.getElementById('deptFormId').value = deptId || '';
  document.getElementById('deptFormTitle').textContent = deptId ? '✎ 编辑部门' : '➕ 新增部门';
  const mgrSel = document.getElementById('deptFormManager');
  mgrSel.innerHTML = '<option value="">暂不指定</option>';
  const emps = await fetch(EMS_API + '/employees').then(r => r.json());
  const id = deptId ? parseInt(deptId, 10) : null;
  const candidates = id
    ? emps.filter(e => String(e.department_id) === String(id) && e.emp_status !== '已离职')
    : [];
  if (id && !candidates.length) {
    mgrSel.add(new Option('（本部门暂无员工，请先添加员工）', ''));
  }
  candidates.forEach(e => {
    mgrSel.add(new Option(`${e.name}（${e.emp_id}）${e.role === '部门主管' ? ' ★当前主管' : ''}`, e.emp_id));
  });
  const hint = document.getElementById('deptManagerHint');
  if (hint) {
    hint.textContent = id
      ? '每部门仅可设置一名部门主管，保存后将自动调整本部门角色'
      : '新建部门后可在「员工列表」添加员工，再指定负责人';
  }
  if (deptId) {
    const d = deptManageList.find(x => x.id === deptId);
    document.getElementById('deptFormName').value = d?.name || '';
    mgrSel.value = d?.manager_emp_id || '';
  } else {
    document.getElementById('deptFormName').value = '';
    mgrSel.value = '';
  }
  openModal('modalDeptForm');
}

async function saveDeptForm(e) {
  e.preventDefault();
  const result = document.getElementById('deptFormResult');
  const id = document.getElementById('deptFormId').value;
  const body = {
    operator: emsUser(),
    name: document.getElementById('deptFormName').value.trim(),
    manager_emp_id: document.getElementById('deptFormManager').value || null
  };
  result.textContent = '保存中...';
  try {
    const url = id ? EMS_API + '/departments/' + id : EMS_API + '/departments';
    const res = await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
    result.textContent = res.success ? res.message : (res.error || '失败');
    result.className = 'reg-result ' + (res.success ? 'success' : 'error');
    if (res.success) {
      closeModal('modalDeptForm');
      loadDepartmentStats();
      loadFilterOptions();
    }
  } catch (err) {
    result.textContent = '请求失败';
    result.className = 'reg-result error';
  }
}

async function deleteDept(id) {
  const d = deptManageList.find(x => x.id === id);
  if (!confirm(`确定删除部门「${d?.name || id}」？`)) return;
  const res = await fetch(EMS_API + '/departments/' + id + '?operator=' + encodeURIComponent(emsUser()), { method: 'DELETE' }).then(r => r.json());
  alert(res.message || res.error);
  if (res.success) { loadDepartmentStats(); loadFilterOptions(); }
}

async function queryDeptEmployees(deptId, keyword) {
  const el = document.getElementById('deptEmpResult');
  if (!el) return;
  if (deptId) currentDeptQueryId = deptId;
  el.innerHTML = '<div class="mine-loading">查询中...</div>';
  const params = new URLSearchParams({ username: emsUser() });
  if (deptId) params.set('department_id', deptId);
  if (keyword) params.set('keyword', keyword);
  try {
    const res = await fetch(EMS_API + '/dept-employees/status?' + params).then(r => r.json());
    if (!res.success) { el.innerHTML = `<div class="reg-result error">${res.error}</div>`; return; }
    el.innerHTML = `<div class="dept-section"><div class="dept-section-title">部门员工状态 <span class="dept-count">${res.data.length} 人</span></div>
      <table class="data-table"><thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>角色</th><th>状态</th><th>入职时间</th><th>合同到期</th></tr></thead>
      <tbody>${res.data.map(e => `<tr><td>${e.emp_id}</td><td>${e.name}</td><td>${e.department}</td><td>${e.role || '-'}</td>
        <td><span class="badge ${STATUS_BADGE[e.emp_status] || 'badge-info'}">${e.emp_status}</span></td>
        <td>${e.hire_date || '-'}</td><td>${e.contract_end || '-'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) { el.innerHTML = '<div class="reg-result error">查询失败</div>'; }
}

// ========== P1 个人信息修改（添加邮箱校验 BUG-7） ==========
let profileData = null;

function bindProfileEdit() {
  const btn = document.getElementById('btnEditProfile');
  const form = document.getElementById('editProfileForm');
  if (btn) btn.addEventListener('click', openEditProfile);
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('epResult');
    result.textContent = '保存中...';

    // 邮箱格式校验（BUG-7）
    const email = document.getElementById('epEmail').value.trim();
    if (email !== '' && !/^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/.test(email)) {
      result.textContent = '邮箱格式不正确，应包含 @ 和域名';
      result.className = 'reg-result error';
      return;
    }

    try {
      const res = await fetch(EMS_API + '/profile/update', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: emsUser(),
          name: document.getElementById('epName').value.trim(),
          phone: document.getElementById('epPhone').value.trim(),
          email: email,
          address: document.getElementById('epAddress').value.trim(),
          emergency_contact: document.getElementById('epEmergency').value.trim(),
          emergency_phone: document.getElementById('epEmergencyPhone').value.trim()
        })
      }).then(r => r.json());
      if (res.success) {
        result.textContent = res.message; result.className = 'reg-result success';
        window.resetMyProfile(); closeModal('modalEditProfile');
        if (typeof loadMyProfile === 'function') loadMyProfile();
      } else { result.textContent = res.error; result.className = 'reg-result error'; }
    } catch (err) { result.textContent = '保存失败'; result.className = 'reg-result error'; }
  });
}

async function openEditProfile() {
  try {
    const res = await fetch(EMS_API + '/profile/detail?username=' + encodeURIComponent(emsUser())).then(r => r.json());
    if (!res.success) return alert(res.error);
    profileData = res.data;
    document.getElementById('epName').value = profileData.name || '';
    document.getElementById('epPhone').value = profileData.phone || '';
    document.getElementById('epEmail').value = profileData.email || '';
    document.getElementById('epAddress').value = profileData.address || '';
    document.getElementById('epEmergency').value = profileData.emergency_contact || '';
    document.getElementById('epEmergencyPhone').value = profileData.emergency_phone || '';
    openModal('modalEditProfile');
  } catch (e) { alert('加载失败'); }
}

// ========== P2 转正 ==========
function bindProbation() {
  const form = document.getElementById('probationForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('probResult');
    result.textContent = '提交中...';
    try {
      const res = await fetch(EMS_API + '/probation/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: emsUser(),
          work_summary: document.getElementById('probWorkSummary').value.trim(),
          self_evaluation: document.getElementById('probSelfEval').value.trim()
        })
      }).then(r => r.json());
      result.textContent = res.success ? res.message : (res.error || '提交失败');
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) form.reset();
    } catch (err) { result.textContent = '提交失败'; result.className = 'reg-result error'; }
  });
  loadProbationNotifications();
  if (isManager()) loadProbationPending();
}

async function loadProbationNotifications() {
  const el = document.getElementById('probNotifyList');
  if (!el || emsUser() === 'root') return;
  try {
    const res = await fetch(EMS_API + '/probation/notifications?username=' + encodeURIComponent(emsUser())).then(r => r.json());
    if (!res.data || !res.data.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="mine-section-title" style="font-size:14px">转正结果通知</div>' +
      res.data.map(n => `<div class="mine-info-item"><span class="mine-info-label">${n.apply_id}</span>
        <span class="mine-info-val">${n.approve_status} - ${n.approve_comment || ''} (${n.notify_time ? new Date(n.notify_time).toLocaleString() : ''})</span></div>`).join('');
  } catch (e) { /* ignore */ }
}

async function loadProbationPending() {
  const el = document.getElementById('probPendingList');
  if (!el) return;
  try {
    const res = await fetch(EMS_API + '/probation/list?username=' + encodeURIComponent(emsUser()) + '&scope=pending').then(r => r.json());
    if (!res.data || !res.data.length) { el.innerHTML = '<div class="mine-empty">暂无待审批转正申请</div>'; return; }
    el.innerHTML = res.data.map(a => `
      <div class="dept-section" style="margin-bottom:12px">
        <div><strong>${a.name}</strong> (${a.emp_id}) - ${a.department} / ${a.role_name || a.role || '-'}</div>
        <div style="font-size:13px;color:#666;margin:6px 0">试用期：${a.probation_start} ~ ${a.probation_end}</div>
        <div style="font-size:13px">工作总结：${a.work_summary || '-'}</div>
        <div style="margin-top:8px">
          <button class="row-btn" onclick="approveProbation('${a.apply_id}','通过')">通过</button>
          <button class="row-btn danger" onclick="approveProbation('${a.apply_id}','驳回')">驳回</button>
        </div>
      </div>`).join('');
  } catch (e) { el.innerHTML = '<div class="mine-empty">加载失败</div>'; }
}

async function approveProbation(applyId, status) {
  const comment = prompt('请输入审批意见：') || '';
  const score = status === '通过' ? prompt('考核评分(0-10)：', '8') : null;
  try {
    const res = await fetch(EMS_API + '/probation/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: emsUser(), apply_id: applyId, approve_status: status, approve_comment: comment, approve_score: score })
    }).then(r => r.json());
    alert(res.message || res.error);
    loadProbationPending();
    loadEmployeeList();
  } catch (e) { alert('审批失败'); }
}

// ========== P3 状态变更（添加主管离职限制 BUG-8） ==========
function bindStatusChange() {
  const form = document.getElementById('statusChangeForm');
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('scResult');
    const empId = document.getElementById('scEmpId').value;
    const newStatus = document.getElementById('scNewStatus').value;

    // ----- 校验：如果是主管且要离职，阻止操作 -----
    if (newStatus === '已离职') {
      try {
        const empInfo = await fetch(EMS_API + '/employees/' + empId).then(r => r.json());
        if (empInfo && empInfo.role === '部门主管') {
          result.textContent = '该员工是部门主管，请先解除主管职务再操作离职';
          result.className = 'reg-result error';
          return;
        }
      } catch (err) {
        console.warn('主管校验失败', err);
      }
    }

    result.textContent = '处理中...';
    try {
      const res = await fetch(EMS_API + '/employee/status-change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator: emsUser(),
          emp_id: empId,
          new_status: newStatus,
          reason: document.getElementById('scReason').value.trim()
        })
      }).then(r => r.json());
      result.textContent = res.success ? res.message : (res.error || '失败');
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => {
          closeModal('modalStatusChange');
          loadEmployeeList();
          loadDepartmentStats();
          if (typeof loadResignArchives === 'function') loadResignArchives();
        }, 1200);
      }
    } catch (err) { result.textContent = '请求失败'; result.className = 'reg-result error'; }
  });
}

function openStatusChange(empId, name, status) {
  document.getElementById('scEmpId').value = empId;
  document.getElementById('scEmpName').value = name + '（当前：' + status + '）';
  document.getElementById('scNewStatus').value = status === '在职' ? '试用期' : '在职';
  document.getElementById('scReason').value = '';
  document.getElementById('scResult').textContent = '';
  openModal('modalStatusChange');
}

// 面板切换时加载
function onEmployeePanelShow(panel) {
  if (panel === 'employees') { loadEmployeeList(); applyPendingDeptFilter(); }
  if (panel === 'departments') loadDepartmentStats();
  if (panel === 'resign' && typeof onResignPanelShow === 'function') onResignPanelShow();
  if (panel === 'attendance' && typeof onAttendancePanelShow === 'function') onAttendancePanelShow();
  if (panel === 'salary' && typeof onSalaryPanelShow === 'function') onSalaryPanelShow();
  if (panel === 'leave' && typeof onLeavePanelShow === 'function') onLeavePanelShow();
  if (panel === 'training' && typeof onTrainingPanelShow === 'function') onTrainingPanelShow();
  if (panel === 'recruit' && typeof onRecruitPanelShow === 'function') onRecruitPanelShow();
  if (panel === 'mine') {
    loadProbationNotifications();
    if (isManager()) loadProbationPending();
  }
}