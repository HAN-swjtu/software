// salary-module.js - 薪资管理 X1~X4
const SAL_API = 'http://localhost:3001/api';

const SAL_STATUS_BADGE = { '草稿': 'badge-warning', '已发放': 'badge-success' };

function salUser() { return sessionStorage.getItem('currentUsername') || ''; }
function salRole() { return sessionStorage.getItem('currentRole') || ''; }
function salIsHR() { return ['HR专员', '管理员'].includes(salRole()) || salUser() === 'root'; }

function fmtMoney(n) {
  const v = Number(n);
  if (isNaN(v)) return '0.00';
  return v.toFixed(2);
}

document.addEventListener('DOMContentLoaded', function () {
  initSalaryModule();
});

function initSalaryModule() {
  setupSalUI();
  bindSalPanel();
  setDefaultSalMonth();
}

function setupSalUI() {
  if (salIsHR()) {
    ['salStatsRow', 'salExportBtn', 'salStructBtn', 'salGenerateBtn', 'salPublishBtn', 'salFilterDept']
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
    loadSalDeptOptions();
  }
  const tip = document.getElementById('salPanelTip');
  if (tip) {
    tip.textContent = salIsHR()
      ? 'HR：维护薪资结构 → 核算工资（联动考勤扣款）→ 审核后批量发放；删除工资单请谨慎操作'
      : '您可查看个人薪资结构与历史工资单（仅已发放记录）';
  }
}

function setDefaultSalMonth() {
  const el = document.getElementById('salFilterMonth');
  if (el && !el.value) {
    const d = new Date();
    el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
}

async function loadSalDeptOptions() {
  try {
    const depts = await fetch(SAL_API + '/departments/list').then(r => r.json());
    const sel = document.getElementById('salFilterDept');
    if (!sel || sel.options.length > 1) return;
    depts.forEach(d => sel.add(new Option(d.name, d.id)));
  } catch (e) { /* ignore */ }
}

function salQueryBody() {
  const monthEl = document.getElementById('salFilterMonth');
  return {
    operator: salUser(),
    pay_month: monthEl?.value || null,
    pay_status: document.getElementById('salFilterStatus')?.value || null,
    department_id: document.getElementById('salFilterDept')?.value || null,
    keyword: document.getElementById('salKeyword')?.value.trim() || null
  };
}

async function loadSalMyStruct() {
  const el = document.getElementById('salMyStruct');
  if (!el) return;
  try {
    const res = await fetch(SAL_API + '/salary/my?username=' + encodeURIComponent(salUser())).then(r => r.json());
    if (!res.success && res.error) { el.textContent = res.error; return; }
    const s = res.structure;
    if (!s) {
      el.textContent = '暂无薪资结构，请联系 HR 维护';
      return;
    }
    el.innerHTML = `基本工资 <strong>${fmtMoney(s.base_salary)}</strong> · 绩效 <strong>${fmtMoney(s.performance_bonus)}</strong> · 津贴 <strong>${fmtMoney(s.allowance)}</strong> · 社保公积金 <strong>${fmtMoney(s.social_insurance)}</strong>`;
  } catch (e) {
    el.textContent = '加载失败，请确认后端已启动';
  }
}

let salListCache = [];

async function loadSalList() {
  const tbody = document.getElementById('salListBody');
  const cols = 9;
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center">加载中...</td></tr>`;
  try {
    const body = salQueryBody();
    if (!salIsHR()) body.pay_status = '已发放';
    const res = await fetch(SAL_API + '/salary/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="${cols}" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    salListCache = res.data || [];
    renderSalList(salListCache);
    if (salIsHR()) loadSalSummary();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="${cols}" style="color:red;text-align:center">加载失败</td></tr>`;
  }
}

function renderSalList(list) {
  const tbody = document.getElementById('salListBody');
  const cols = 9;
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center">无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(r => {
    const badge = SAL_STATUS_BADGE[r.pay_status] || 'badge-info';
    let act;
    if (salIsHR()) {
      act = `<td>
        <button class="row-btn" onclick="openSalRecord(${r.id},true)">编辑</button>
        <button class="row-btn" onclick="openSalRecord(${r.id},false)">详情</button>
        <button class="row-btn danger" onclick="deleteSalRecord(${r.id},'${r.pay_id}','${(r.name||'').replace(/'/g,"\\'")}')">删除</button>
      </td>`;
    } else {
      act = `<td><button class="row-btn" onclick="openSalRecord(${r.id},false)">详情</button></td>`;
    }
    return `<tr><td>${r.pay_id}</td><td>${r.emp_id}</td><td>${r.name}</td><td>${r.department || '-'}</td><td>${r.pay_month}</td>
      <td>${fmtMoney(r.gross_pay)}</td><td>${fmtMoney(r.net_pay)}</td><td><span class="badge ${badge}">${r.pay_status}</span></td>${act}</tr>`;
  }).join('');
}

async function loadSalSummary() {
  try {
    const res = await fetch(SAL_API + '/salary/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salQueryBody())
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('salStatCount', s.headcount);
    set('salStatGross', fmtMoney(s.total_gross));
    set('salStatNet', fmtMoney(s.total_net));
    set('salStatDeduct', fmtMoney(s.total_deduct));
  } catch (e) { /* ignore */ }
}

let salStructCache = [];

async function openSalStructModal() {
  if (!salIsHR()) return;
  openModal('modalSalStruct');
  loadSalStructures();
  const search = document.getElementById('salStructSearch');
  if (search && !search._bound) {
    search._bound = true;
    search.addEventListener('input', function () {
      const kw = this.value.trim().toLowerCase();
      renderSalStructList(kw ? salStructCache.filter(s =>
        [s.emp_id, s.name, s.department].some(v => v && String(v).toLowerCase().includes(kw))) : salStructCache);
    });
  }
}

async function loadSalStructures() {
  const tbody = document.getElementById('salStructBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">加载中...</td></tr>';
  try {
    const kw = document.getElementById('salStructSearch')?.value.trim() || '';
    const res = await fetch(SAL_API + '/salary/structures?operator=' + encodeURIComponent(salUser()) + '&keyword=' + encodeURIComponent(kw)).then(r => r.json());
    salStructCache = res.data || [];
    renderSalStructList(salStructCache);
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function renderSalStructList(list) {
  const tbody = document.getElementById('salStructBody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">无数据</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => `<tr>
    <td>${s.emp_id}</td><td>${s.name}</td><td>${s.department || '-'}</td>
    <td>${fmtMoney(s.base_salary)}</td><td>${fmtMoney(s.performance_bonus)}</td>
    <td>${fmtMoney(s.allowance)}</td><td>${fmtMoney(s.social_insurance)}</td>
    <td><button class="row-btn" onclick="openSalStructEdit('${s.emp_id}','${(s.name||'').replace(/'/g,"\\'")}',${s.base_salary},${s.performance_bonus},${s.allowance},${s.social_insurance},'${s.effective_date || ''}')">编辑</button></td>
  </tr>`).join('');
}

function openSalStructEdit(empId, name, base, bonus, allow, ins, effDate) {
  document.getElementById('salStructEmpId').value = empId;
  document.getElementById('salStructEmpName').value = name + '（' + empId + '）';
  document.getElementById('salStructBase').value = base;
  document.getElementById('salStructBonus').value = bonus;
  document.getElementById('salStructAllow').value = allow;
  document.getElementById('salStructIns').value = ins;
  document.getElementById('salStructDate').value = effDate ? String(effDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('salStructResult').textContent = '';
  openModal('modalSalStructEdit');
}

async function generateSal() {
  if (!salIsHR()) return;
  const month = document.getElementById('salFilterMonth')?.value;
  if (!month) { alert('请先选择发薪月份'); return; }
  if (!confirm(`确定核算 ${month} 月工资？\n将根据薪资结构与考勤记录自动计算扣款。`)) return;
  try {
    const res = await fetch(SAL_API + '/salary/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: salUser(),
        pay_month: month,
        department_id: document.getElementById('salFilterDept')?.value || null
      })
    }).then(r => r.json());
    alert(res.success ? res.message : (res.error || '核算失败'));
    if (res.success) loadSalList();
  } catch (e) { alert('请求失败'); }
}

async function publishSal() {
  if (!salIsHR()) return;
  const month = document.getElementById('salFilterMonth')?.value;
  if (!month) { alert('请先选择发薪月份'); return; }
  if (!confirm(`【谨慎操作】确定批量发放 ${month} 月所有「草稿」工资单？\n发放后员工可在系统中查看。`)) return;
  if (!confirm('请再次确认：是否执行批量发放？')) return;
  try {
    const res = await fetch(SAL_API + '/salary/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: salUser(), pay_month: month })
    }).then(r => r.json());
    alert(res.success ? res.message : (res.error || '发放失败'));
    if (res.success) loadSalList();
  } catch (e) { alert('请求失败'); }
}

async function exportSal() {
  try {
    const res = await fetch(SAL_API + '/salary/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salQueryBody())
    });
    if (!res.ok) { alert('导出失败'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '工资导出_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  } catch (e) { alert('导出失败'); }
}

async function openSalRecord(id, editable) {
  const row = salListCache.find(x => x.id === id);
  if (!row) { alert('记录不存在'); return; }
  fillSalRecordForm(row, editable);
}

function fillSalRecordForm(r, editable) {
  const canEdit = salIsHR() && editable && r.pay_status !== '已发放';
  document.getElementById('salRecordId').value = r.id;
  document.getElementById('salRecordTitle').textContent = canEdit ? '✎ 编辑工资单' : '📄 工资单详情';
  document.getElementById('salRecordPayId').value = r.pay_id;
  document.getElementById('salRecordEmp').value = r.name + '（' + r.emp_id + '）';
  document.getElementById('salRecordMonth').value = r.pay_month;
  ['Base', 'Bonus', 'Allow', 'Ot', 'Deduct', 'Ins', 'Tax'].forEach((k, i) => {
    const map = ['base_salary', 'performance_bonus', 'allowance', 'overtime_pay', 'attendance_deduct', 'social_insurance', 'tax'];
    const el = document.getElementById('salRecord' + k);
    if (el) { el.value = r[map[i]]; el.readOnly = !canEdit; }
  });
  const st = document.getElementById('salRecordStatus');
  if (st) { st.value = r.pay_status; st.disabled = !canEdit; }
  const rm = document.getElementById('salRecordRemark');
  if (rm) { rm.value = r.remark || ''; rm.readOnly = !canEdit; }
  const btn = document.getElementById('salRecordSaveBtn');
  if (btn) btn.style.display = canEdit ? '' : 'none';
  document.getElementById('salRecordResult').textContent = canEdit ? '' : `应发 ${fmtMoney(r.gross_pay)} · 实发 ${fmtMoney(r.net_pay)}`;
  openModal('modalSalRecord');
}

async function deleteSalRecord(id, payId, name) {
  const warn =
    '【谨慎操作】您即将删除工资单：\n\n' +
    '单号：' + payId + '\n员工：' + name + '\n\n' +
    '· 此操作不可恢复\n' +
    '· 可能影响财务对账与员工查询\n\n' +
    '确定要继续吗？';
  if (!confirm(warn)) return;
  if (!confirm('请再次确认：是否永久删除该工资单？')) return;
  try {
    const res = await fetch(SAL_API + '/salary/record/' + id + '?operator=' + encodeURIComponent(salUser()), { method: 'DELETE' }).then(r => r.json());
    if (res.success) { alert(res.message); loadSalList(); }
    else alert(res.error || '删除失败');
  } catch (e) { alert('删除失败'); }
}

function bindSalPanel() {
  const q = document.getElementById('salQueryBtn');
  const exp = document.getElementById('salExportBtn');
  const st = document.getElementById('salStructBtn');
  const gen = document.getElementById('salGenerateBtn');
  const pub = document.getElementById('salPublishBtn');
  const sf = document.getElementById('salStructForm');
  const rf = document.getElementById('salRecordForm');
  if (q) q.addEventListener('click', loadSalList);
  if (exp) exp.addEventListener('click', exportSal);
  if (st) st.addEventListener('click', openSalStructModal);
  if (gen) gen.addEventListener('click', generateSal);
  if (pub) pub.addEventListener('click', publishSal);
  if (sf) sf.addEventListener('submit', submitSalStruct);
  if (rf) rf.addEventListener('submit', submitSalRecord);
}

async function submitSalStruct(e) {
  e.preventDefault();
  const result = document.getElementById('salStructResult');
  result.textContent = '保存中...';
  try {
    const res = await fetch(SAL_API + '/salary/structure', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: salUser(),
        emp_id: document.getElementById('salStructEmpId').value,
        base_salary: document.getElementById('salStructBase').value,
        performance_bonus: document.getElementById('salStructBonus').value,
        allowance: document.getElementById('salStructAllow').value,
        social_insurance: document.getElementById('salStructIns').value,
        effective_date: document.getElementById('salStructDate').value
      })
    }).then(r => r.json());
    result.textContent = res.success ? res.message : (res.error || '失败');
    result.className = 'reg-result ' + (res.success ? 'success' : 'error');
    if (res.success) {
      setTimeout(() => { closeModal('modalSalStructEdit'); loadSalStructures(); loadSalMyStruct(); }, 900);
    }
  } catch (err) { result.textContent = '请求失败'; result.className = 'reg-result error'; }
}

async function submitSalRecord(e) {
  e.preventDefault();
  const result = document.getElementById('salRecordResult');
  result.textContent = '保存中...';
  try {
    const res = await fetch(SAL_API + '/salary/record/' + document.getElementById('salRecordId').value, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator: salUser(),
        base_salary: document.getElementById('salRecordBase').value,
        performance_bonus: document.getElementById('salRecordBonus').value,
        allowance: document.getElementById('salRecordAllow').value,
        overtime_pay: document.getElementById('salRecordOt').value,
        attendance_deduct: document.getElementById('salRecordDeduct').value,
        social_insurance: document.getElementById('salRecordIns').value,
        tax: document.getElementById('salRecordTax').value,
        pay_status: document.getElementById('salRecordStatus').value,
        remark: document.getElementById('salRecordRemark').value
      })
    }).then(r => r.json());
    result.textContent = res.success ? res.message : (res.error || '失败');
    result.className = 'reg-result ' + (res.success ? 'success' : 'error');
    if (res.success) setTimeout(() => { closeModal('modalSalRecord'); loadSalList(); }, 900);
  } catch (err) { result.textContent = '请求失败'; result.className = 'reg-result error'; }
}

function onSalaryPanelShow() {
  loadSalMyStruct();
  loadSalList();
}
