// performance-module.js - 绩效管理（指标库/自评/主管评/归档）
const PF_API = 'http://localhost:3001/api';

function pfUser() { return sessionStorage.getItem('currentUsername') || ''; }
function pfRole() { return sessionStorage.getItem('currentRole') || ''; }
function pfIsHR() { return ['HR专员', '管理员'].includes(pfRole()) || pfUser() === 'root'; }
function pfIsMgr() { return pfRole() === '部门主管'; }
function pfIsRecruit() { return pfRole() === '招聘专员'; }

document.addEventListener('DOMContentLoaded', function () {
  initPerformanceModule();
});

function initPerformanceModule() {
  setupPerformanceUI();
  bindPerformancePanel();
}

function setupPerformanceUI() {
  const tip = document.getElementById('pfPanelTip');
  if (!tip) return;
  if (pfIsHR()) tip.textContent = '配置 KPI 指标并发布考核 → 主管完成评分后 → 在此归档绩效结果';
  else if (pfIsMgr()) tip.textContent = '查看下属自评并完成绩效评分与面谈';
  else if (pfIsRecruit()) tip.textContent = '可查询已归档的绩效记录，用于招聘参考';
  else tip.textContent = '对照 KPI 指标填写本考核周期工作成果自评';

  applyPfStatsVisibility();

  const tabBar = document.getElementById('pfTabBar');
  ['pfTabMgr', 'pfTabSelf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (tabBar) tabBar.style.display = 'none';

  if (pfIsHR()) {
    showPfSection('hr');
  } else if (pfIsMgr()) {
    const e = document.getElementById('pfTabMgr'); if (e) e.style.display = '';
    if (tabBar) tabBar.style.display = '';
    showPfSection('mgr');
  } else if (pfIsRecruit()) {
    showPfSection(null);
  } else {
    const e = document.getElementById('pfTabSelf'); if (e) e.style.display = '';
    if (tabBar) tabBar.style.display = '';
    showPfSection('self');
  }
}

function applyPfStatsVisibility() {
  const show = (key, visible) => {
    const el = document.querySelector(`#pfStats [data-pf-stat="${key}"]`);
    if (el) el.style.display = visible ? '' : 'none';
  };
  if (pfIsHR()) {
    ['tpl', 'self', 'mgr', 'done', 'arch'].forEach(k => show(k, true));
  } else if (pfIsMgr()) {
    show('tpl', false); show('self', false);
    show('mgr', true); show('done', true); show('arch', true);
  } else if (pfIsRecruit()) {
    show('tpl', false); show('self', false); show('mgr', false);
    show('done', false); show('arch', true);
  } else {
    show('tpl', false); show('self', true);
    show('mgr', false); show('done', true); show('arch', true);
  }
}

function showPfSection(name) {
  ['pfSecHr', 'pfSecMgr', 'pfSecSelf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (!name) return;
  const map = { hr: 'pfSecHr', mgr: 'pfSecMgr', self: 'pfSecSelf' };
  const target = document.getElementById(map[name]);
  if (target) target.style.display = '';
}

function bindPerformancePanel() {
  document.getElementById('pfTabMgr')?.addEventListener('click', () => showPfSection('mgr'));
  document.getElementById('pfTabSelf')?.addEventListener('click', () => showPfSection('self'));
  document.getElementById('pfTplSaveBtn')?.addEventListener('click', savePfTemplate);
  document.getElementById('pfTplNewBtn')?.addEventListener('click', newPfTemplate);
  document.getElementById('pfTplDeleteBtn')?.addEventListener('click', deletePfTemplate);
  document.getElementById('pfTplUnlockBtn')?.addEventListener('click', unlockPfTemplate);
  document.getElementById('pfTplPublishBtn')?.addEventListener('click', publishPfTemplate);
  document.getElementById('pfAddIndicatorBtn')?.addEventListener('click', addPfIndicatorRow);
  document.getElementById('pfSelfSubmitBtn')?.addEventListener('click', submitPfSelf);
  document.getElementById('pfMgrRefreshBtn')?.addEventListener('click', loadPfManagerList);
  document.getElementById('pfArchiveBtn')?.addEventListener('click', archivePfResults);
  document.getElementById('pfQueryBtn')?.addEventListener('click', loadPfRecordList);
}

function onPerformancePanelShow() {
  setupPerformanceUI();
  loadPfSummary();
  loadPfTemplates();
  loadPfRecordList();
  if (pfIsMgr()) loadPfManagerList();
  if (!pfIsHR() && !pfIsMgr() && !pfIsRecruit()) loadPfMyRecords();
}

async function loadPfSummary() {
  try {
    const res = await fetch(PF_API + '/performance/summary?operator=' + encodeURIComponent(pfUser())).then(r => r.json());
    if (!res.success) return;
    const d = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('pfStatTpl', d.active_templates);
    set('pfStatSelf', d.pending_self);
    set('pfStatMgr', d.pending_manager);
    set('pfStatCal', d.pending_frozen ?? 0);
    set('pfStatArch', d.archived);
  } catch (e) { /* ignore */ }
}

function getPfIndicatorsFromForm() {
  const rows = document.querySelectorAll('#pfIndicatorBody tr');
  const list = [];
  rows.forEach(tr => {
    const name = tr.querySelector('.pf-ind-name')?.value.trim();
    const weight = tr.querySelector('.pf-ind-weight')?.value;
    const role = tr.querySelector('.pf-ind-role')?.value.trim();
    const std = tr.querySelector('.pf-ind-std')?.value.trim();
    if (name) list.push({ name, weight: parseFloat(weight) || 0, role: role || '通用', standard: std || '' });
  });
  return list;
}

function addPfIndicatorRow(data) {
  const tbody = document.getElementById('pfIndicatorBody');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="search-input pf-ind-name" value="${data?.name || ''}" placeholder="指标名称" /></td>
    <td><input class="search-input pf-ind-weight" type="number" min="0" max="100" step="1" value="${data?.weight ?? 20}" /></td>
    <td><input class="search-input pf-ind-role" value="${data?.role || '通用'}" placeholder="适用岗位" /></td>
    <td><input class="search-input pf-ind-std" value="${data?.standard || ''}" placeholder="考核标准" /></td>
    <td><button type="button" class="row-btn danger pf-ind-del">删</button></td>`;
  tr.querySelector('.pf-ind-del').addEventListener('click', () => tr.remove());
  tbody.appendChild(tr);
}

let pfTemplateCache = [];

async function loadPfTemplates() {
  if (!pfIsHR()) return;
  try {
    const res = await fetch(PF_API + '/performance/templates?operator=' + encodeURIComponent(pfUser())).then(r => r.json());
    const sel = document.getElementById('pfTemplateSelect');
    if (!sel || !res.success) return;
    pfTemplateCache = res.data || [];
    sel.innerHTML = '<option value="">选择已保存模板</option>';
    pfTemplateCache.forEach(t => {
      sel.add(new Option(`${t.name} (${t.cycle}) [${t.status}]`, t.template_id));
    });
    sel.onchange = () => {
      if (sel.value) loadPfTemplateIntoForm(sel.value);
      else updatePfTemplateActions();
    };
    updatePfTemplateActions();
  } catch (e) { /* ignore */ }
}

function getSelectedPfTemplate() {
  const selId = document.getElementById('pfTemplateSelect')?.value;
  const hidId = document.getElementById('pfTplId')?.value;
  const id = selId || hidId;
  if (!id) return null;
  return pfTemplateCache.find(x => x.template_id === id) || { template_id: id, status: '' };
}

function updatePfTemplateActions() {
  const t = getSelectedPfTemplate();
  const delBtn = document.getElementById('pfTplDeleteBtn');
  const unlockBtn = document.getElementById('pfTplUnlockBtn');
  if (delBtn) {
    delBtn.style.display = '';
    delBtn.title = t?.status === '草稿'
      ? `删除草稿 ${t.template_id}`
      : (t ? '当前选中非草稿，仅草稿可删除' : '请在下拉框选择要删除的草稿');
  }
  if (unlockBtn) {
    unlockBtn.style.display = t?.status === '已锁定' ? '' : 'none';
  }
}

function loadPfTemplateIntoForm(templateId) {
  if (!templateId) return;
  const t = pfTemplateCache.find(x => x.template_id === templateId);
  if (!t) return;
  document.getElementById('pfTplId').value = t.template_id;
  document.getElementById('pfTplName').value = t.name;
  document.getElementById('pfTplCycle').value = t.cycle;
  const body = document.getElementById('pfIndicatorBody');
  if (body) { body.innerHTML = ''; t.indicators.forEach(i => addPfIndicatorRow(i)); }
  const rep = document.getElementById('pfTplReplace');
  if (rep) rep.checked = false;
  updatePfTemplateActions();
}

function updatePfDraftActions() { updatePfTemplateActions(); }

function newPfTemplate() {
  document.getElementById('pfTplId').value = '';
  document.getElementById('pfTplName').value = '';
  document.getElementById('pfTemplateSelect').value = '';
  const rep = document.getElementById('pfTplReplace');
  if (rep) rep.checked = false;
  const body = document.getElementById('pfIndicatorBody');
  if (body) {
    body.innerHTML = '';
    [['工作质量', 30], ['工作效率', 25], ['团队协作', 25], ['创新能力', 20]].forEach(([n, w]) => addPfIndicatorRow({ name: n, weight: w }));
  }
  const el = document.getElementById('pfTplResult');
  if (el) { el.textContent = ''; el.className = 'reg-result'; }
  updatePfTemplateActions();
}

async function deletePfTemplate() {
  const template_id = document.getElementById('pfTemplateSelect')?.value
    || document.getElementById('pfTplId')?.value;
  if (!template_id) { alert('请在下拉框中选择要删除的草稿'); return; }
  const t = pfTemplateCache.find(x => x.template_id === template_id);
  if (t && t.status !== '草稿') {
    alert('仅「草稿」状态可删除。已发布/已锁定请使用「取消锁定」或「替换发布」。');
    return;
  }
  if (!confirm(`确认删除草稿 ${template_id}？此操作不可恢复。`)) return;
  let res;
  try {
    const resp = await fetch(PF_API + '/performance/template/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: pfUser(), template_id })
    });
    res = await resp.json();
    if (!resp.ok && !res.error) res = { success: false, error: '删除接口不可用，请重启后端服务' };
  } catch (e) {
    res = { success: false, error: '请求失败，请确认后端已启动并已更新代码' };
  }
  const el = document.getElementById('pfTplResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '删除失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  if (res.success) newPfTemplate();
  await loadPfTemplates();
}

async function unlockPfTemplate() {
  const template_id = document.getElementById('pfTemplateSelect')?.value
    || document.getElementById('pfTplId')?.value;
  if (!template_id) { alert('请选择已锁定的模板'); return; }
  const t = pfTemplateCache.find(x => x.template_id === template_id);
  if (t && t.status !== '已锁定') { alert('仅「已锁定」状态可取消锁定'); return; }
  if (!confirm('取消锁定后，该周期主管已评记录将恢复为「待主管评」，部门主管可重新评分。确认？')) return;
  let res;
  try {
    const resp = await fetch(PF_API + '/performance/template/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator: pfUser(), template_id })
    });
    res = await resp.json();
    if (!resp.ok && !res.error) res = { success: false, error: '取消锁定接口不可用，请重启后端服务' };
  } catch (e) {
    res = { success: false, error: '请求失败，请确认后端已启动' };
  }
  const el = document.getElementById('pfTplResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '操作失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  if (res.success) {
    await loadPfTemplates();
    loadPfSummary();
    loadPfRecordList();
  }
}

async function savePfTemplate() {
  const body = {
    operator: pfUser(),
    template_id: document.getElementById('pfTplId')?.value || null,
    name: document.getElementById('pfTplName')?.value.trim(),
    cycle: document.getElementById('pfTplCycle')?.value.trim(),
    indicators: getPfIndicatorsFromForm(),
    grade_distribution: { A: 0.10, B: 0.30, C: 0.40, D: 0.20 }
  };
  const res = await fetch(PF_API + '/performance/template/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json());
  const el = document.getElementById('pfTplResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '保存失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  if (res.success && res.template_id) document.getElementById('pfTplId').value = res.template_id;
  await loadPfTemplates();
  if (res.template_id) {
    const sel = document.getElementById('pfTemplateSelect');
    if (sel) sel.value = res.template_id;
  }
  updatePfTemplateActions();
}

async function publishPfTemplate() {
  const template_id = document.getElementById('pfTplId')?.value;
  if (!template_id) { alert('请先保存模板'); return; }
  const replace = !!document.getElementById('pfTplReplace')?.checked;
  const msg = replace
    ? '将替换该周期已发布的指标库，并清除尚未提交自评的考核任务后重新下发通知。确认？'
    : '发布后本考核周期内指标库不可修改，并下发全员考核通知。确认发布？';
  if (!confirm(msg)) return;
  const res = await fetch(PF_API + '/performance/template/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator: pfUser(), template_id, replace_existing: replace })
  }).then(r => r.json());
  const el = document.getElementById('pfTplResult');
  if (el) {
    el.textContent = res.success ? res.message : (res.error || '发布失败');
    el.className = 'reg-result ' + (res.success ? 'success' : 'error');
  }
  if (!res.success && res.can_replace && !replace) {
    if (confirm('该周期已有发布的指标库。是否勾选「替换已发布指标库」并立即重新发布？')) {
      const rep = document.getElementById('pfTplReplace');
      if (rep) rep.checked = true;
      return publishPfTemplate();
    }
  }
  if (res.success) {
    const rep = document.getElementById('pfTplReplace');
    if (rep) rep.checked = false;
    loadPfTemplates();
  }
  loadPfSummary();
  loadPfRecordList();
}

async function loadPfSelfIndicators(cycle) {
  const meta = document.getElementById('pfSelfTplMeta');
  const tbody = document.getElementById('pfSelfKpiBody');
  const card = document.getElementById('pfSelfKpiCard');
  if (!tbody) return;
  if (!cycle) {
    if (meta) meta.textContent = '暂无考核周期';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px">暂无 KPI 指标</td></tr>';
    return;
  }
  try {
    const res = await fetch(
      PF_API + '/performance/template/active?operator=' + encodeURIComponent(pfUser()) + '&cycle=' + encodeURIComponent(cycle)
    ).then(r => r.json());
    if (!res.success || !res.data) {
      if (meta) meta.textContent = `考核周期 ${cycle}：未找到已发布的 KPI 指标库`;
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px">请联系 HR 确认指标库是否已发布</td></tr>';
      return;
    }
    const tpl = res.data;
    if (meta) meta.textContent = `${tpl.name || '考核模板'} · 周期 ${tpl.cycle} · 共 ${tpl.indicators.length} 项指标（权重合计 100%）`;
    if (!tpl.indicators.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px">指标库为空</td></tr>';
      return;
    }
    tbody.innerHTML = tpl.indicators.map(ind => `
      <tr>
        <td><strong>${escapePfHtml(ind.name || '-')}</strong></td>
        <td>${ind.weight ?? '-'}</td>
        <td>${escapePfHtml(ind.role || '通用')}</td>
        <td>${escapePfHtml(ind.standard || '—')}</td>
      </tr>`).join('');
    if (card) card.style.display = '';
  } catch (e) {
    if (meta) meta.textContent = 'KPI 指标加载失败';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:16px">加载失败，请刷新重试</td></tr>';
  }
}

function escapePfHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadPfMyRecords() {
  try {
    const res = await fetch(PF_API + '/performance/my?username=' + encodeURIComponent(pfUser())).then(r => r.json());
    if (!res.success) return;
    const tbody = document.getElementById('pfSelfBody');
    if (!tbody) return;
    if (!res.records.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px">暂无考核任务</td></tr>';
      loadPfSelfIndicators(null);
      return;
    }
    const pending = res.records.find(r => r.status === '待自评');
    const focus = pending || res.records[0];
    if (focus) {
      document.getElementById('pfSelfRecordId').value = pending ? pending.record_id : '';
      document.getElementById('pfSelfCycle').textContent = focus.cycle;
      loadPfSelfIndicators(focus.cycle);
    }
    const formCard = document.getElementById('pfSelfFormCard');
    const submitBtn = document.getElementById('pfSelfSubmitBtn');
    if (formCard) formCard.style.display = pending ? '' : 'none';
    if (submitBtn) submitBtn.style.display = pending ? '' : 'none';
    tbody.innerHTML = res.records.map(r => `
      <tr><td>${r.record_id}</td><td>${r.cycle}</td><td>${r.status}</td>
      <td>${r.self_score ?? '-'}</td><td>${r.final_grade || r.suggested_grade || '-'}</td>
      <td>${r.performance_coefficient ?? '-'}</td></tr>`).join('');
    if (res.notifications?.length) {
      const n = document.getElementById('pfNotifyBox');
      if (n) n.textContent = res.notifications.map(x => x.title + '：' + x.content).join(' | ');
    }
  } catch (e) { /* ignore */ }
}

async function submitPfSelf() {
  const body = {
    username: pfUser(),
    record_id: document.getElementById('pfSelfRecordId')?.value,
    self_tasks: document.getElementById('pfSelfTasks')?.value.trim(),
    self_score: document.getElementById('pfSelfScore')?.value,
    self_summary: document.getElementById('pfSelfSummary')?.value.trim()
  };
  const res = await fetch(PF_API + '/performance/self/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json());
  const el = document.getElementById('pfSelfResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '提交失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  loadPfMyRecords();
  loadPfSummary();
}

async function loadPfManagerList() {
  try {
    const res = await fetch(PF_API + '/performance/manager/pending?operator=' + encodeURIComponent(pfUser())).then(r => r.json());
    const tbody = document.getElementById('pfMgrBody');
    if (!tbody || !res.success) return;
    if (!res.data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px">无待评记录</td></tr>';
      return;
    }
    tbody.innerHTML = res.data.map(r => `
      <tr>
        <td>${r.record_id}</td><td>${r.name}</td><td>${r.emp_id}</td><td>${r.cycle}</td>
        <td>${r.status === '已冻结' ? '主管已评' : r.status}</td><td>${r.self_score ?? '-'}</td>
        <td>${r.status === '待主管评' ? `<button class="row-btn" onclick="openPfMgrReview('${r.record_id}','${(r.name||'').replace(/'/g,"\\'")}')">评分</button>` : '-'}</td>
      </tr>`).join('');
  } catch (e) { /* ignore */ }
}

function openPfMgrReview(recordId, name) {
  document.getElementById('pfMgrRecordId').value = recordId;
  document.getElementById('pfMgrEmpName').textContent = name;
  document.getElementById('pfMgrScore').value = '';
  document.getElementById('pfMgrGrade').value = 'B';
  document.getElementById('pfMgrInterview').value = '';
  document.getElementById('pfMgrImprove').value = '';
  document.getElementById('pfMgrResult').textContent = '';
  openModal('modalPfMgrReview');
}

async function submitPfMgrReview() {
  const body = {
    operator: pfUser(),
    record_id: document.getElementById('pfMgrRecordId').value,
    manager_score: document.getElementById('pfMgrScore').value,
    suggested_grade: document.getElementById('pfMgrGrade').value,
    interview_feedback: document.getElementById('pfMgrInterview').value.trim(),
    improvement_suggestions: document.getElementById('pfMgrImprove').value.trim()
  };
  const res = await fetch(PF_API + '/performance/manager/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(r => r.json());
  const el = document.getElementById('pfMgrResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '提交失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  if (res.success) {
    setTimeout(() => closeModal('modalPfMgrReview'), 800);
    loadPfManagerList();
    loadPfSummary();
  }
}

async function archivePfResults() {
  const cycle = document.getElementById('pfArchCycle')?.value.trim();
  if (!cycle) { alert('请填写考核周期'); return; }
  if (!confirm('归档后结果不可修改，确认？')) return;
  const res = await fetch(PF_API + '/performance/archive', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operator: pfUser(), cycle })
  }).then(r => r.json());
  const el = document.getElementById('pfArchResult');
  if (el) { el.textContent = res.success ? res.message : (res.error || '归档失败'); el.className = 'reg-result ' + (res.success ? 'success' : 'error'); }
  loadPfSummary();
  loadPfRecordList();
}

function pfStatusLabel(status) {
  const map = { '已冻结': '主管已评', '待校准': '主管已评', '待主管评': '待主管评', '待自评': '待自评', '已归档': '已归档' };
  return map[status] || status;
}

async function loadPfRecordList() {
  try {
    const body = {
      operator: pfUser(),
      cycle: document.getElementById('pfFilterCycle')?.value.trim() || null,
      status: document.getElementById('pfFilterStatus')?.value || null,
      keyword: document.getElementById('pfKeyword')?.value.trim() || null
    };
    const res = await fetch(PF_API + '/performance/query', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    const tbody = document.getElementById('pfListBody');
    if (!tbody) return;
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:16px;color:#e05252">${res.error || '查询失败'}</td></tr>`;
      return;
    }
    if (!res.data.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px">无数据</td></tr>';
      return;
    }
    tbody.innerHTML = res.data.map(r => `
      <tr><td>${r.record_id}</td><td>${r.name}</td><td>${r.emp_id}</td><td>${r.cycle}</td>
      <td>${pfStatusLabel(r.status)}</td><td>${r.self_score ?? '-'}</td><td>${r.final_grade || r.suggested_grade || '-'}</td>
      <td>${r.performance_coefficient ?? '-'}</td></tr>`).join('');
  } catch (e) {
    const tbody = document.getElementById('pfListBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;color:#e05252">查询失败，请确认后端已启动</td></tr>';
  }
}

// 初始化默认 KPI 行
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('pfIndicatorBody') && !document.getElementById('pfIndicatorBody').children.length) {
    [['工作质量', 30], ['工作效率', 25], ['团队协作', 25], ['创新能力', 20]].forEach(([n, w]) => addPfIndicatorRow({ name: n, weight: w }));
  }
});

window.openPfMgrReview = openPfMgrReview;
window.submitPfMgrReview = submitPfMgrReview;
