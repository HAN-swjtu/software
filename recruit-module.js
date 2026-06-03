// recruit-module.js - 招聘管理 文档 3.3.7（P1~P5）
const RC_API = 'http://localhost:3001/api';
const RC_JSON = { 'Content-Type': 'application/json; charset=utf-8' };

const RC_BADGE = {
  '草稿': 'badge-danger', '招聘中': 'badge-warning', '已关闭': 'badge-info', '已招满': 'badge-success',
  '待筛选': 'badge-warning', '通过': 'badge-success', '未通过': 'badge-danger',
  '已安排': 'badge-info', '已完成': 'badge-success', '已取消': 'badge-danger',
  '待主管审批': 'badge-warning', '已通过': 'badge-success', '已驳回': 'badge-danger',
  '待确认': 'badge-warning', '已接受': 'badge-success', '已拒绝': 'badge-danger'
};

function rcUser() { return sessionStorage.getItem('currentUsername') || ''; }
function rcRole() { return sessionStorage.getItem('currentRole') || ''; }
function rcIsHR() { return ['HR专员', '管理员'].includes(rcRole()) || rcUser() === 'root'; }
function rcIsRecruiter() { return rcRole() === '招聘专员'; }
function rcIsMgr() { return rcRole() === '部门主管'; }
function rcCanManage() { return rcIsHR() || rcIsRecruiter(); }
function rcLocalDate(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let rcJobCache = [];
let rcViewMode = 'job';

document.addEventListener('DOMContentLoaded', function () {
  initRecruitModule();
});

function initRecruitModule() {
  setupRecruitUI();
  bindRecruitPanel();
}

function setupRecruitUI() {
  ['rcAddJobBtn', 'rcJobExportBtn', 'rcResumeExportBtn', 'rcAddResumeBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = rcCanManage() ? '' : 'none';
  });
  const pendingWrap = document.getElementById('rcStatPendingWrap');
  if (pendingWrap) pendingWrap.style.display = (rcIsMgr() || rcIsHR()) ? '' : 'none';
  const pendingBtn = document.getElementById('rcPendingHireBtn');
  if (pendingBtn) pendingBtn.style.display = rcIsMgr() ? '' : 'none';

  const tip = document.getElementById('rcPanelTip');
  if (tip) {
    if (rcCanManage()) {
      tip.textContent = '流程：发布岗位 → 简历筛选 → 面试评价 → 录用审批 → 发放 Offer → 入职同步';
    } else if (rcIsMgr()) {
      tip.textContent = '部门主管：可审批本部门录用申请、提交面试评价';
    } else {
      tip.textContent = '可查看本部门相关招聘进度';
    }
  }
  loadRcDeptOptions();
}

async function loadRcDeptOptions() {
  try {
    const depts = await fetch(RC_API + '/departments/list').then(r => r.json());
    ['rcJobDept', 'rcJobDeptSel'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel || sel.options.length > 1) return;
      depts.forEach(d => sel.add(new Option(d.name, d.id)));
    });
  } catch (e) { /* ignore */ }
}

async function loadRcJobSelects() {
  try {
    const res = await fetch(RC_API + '/recruit/job/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({ operator: rcUser(), status: '招聘中' })
    }).then(r => r.json());
    const jobs = res.data || [];
    ['rcResumeJob', 'rcResumeJobSel'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = id === 'rcResumeJob' ? '<option value="">全部岗位</option>' : '';
      jobs.forEach(j => sel.add(new Option(j.title + ' (' + j.job_id + ')', j.job_id)));
      if (cur) sel.value = cur;
    });
  } catch (e) { /* ignore */ }
}

function setRcView(mode) {
  rcViewMode = mode;
  ['job', 'resume', 'interview', 'hire'].forEach(m => {
    document.getElementById('rcView' + m.charAt(0).toUpperCase() + m.slice(1))?.classList.toggle('active', mode === m);
    const secId = m === 'job' ? 'rcJobSection' : m === 'resume' ? 'rcResumeSection' : m === 'interview' ? 'rcInterviewSection' : 'rcHireSection';
    const sec = document.getElementById(secId);
    if (sec) sec.style.display = mode === m ? '' : 'none';
  });
  if (mode === 'job') loadRecruitJobs();
  else if (mode === 'resume') { loadRcJobSelects(); loadRecruitResumes(); }
  else if (mode === 'interview') loadRecruitInterviews();
  else { loadRecruitHires(); loadRecruitOffers(); }
}

async function loadRecruitSummary() {
  try {
    const res = await fetch(RC_API + '/recruit/summary', {
      method: 'POST', headers: RC_JSON, body: '{}'
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rcStatJobs', s.active_jobs || 0);
    set('rcStatResumes', s.resume_total || 0);
    set('rcStatHired', s.hired_month || 0);
    set('rcStatPending', s.pending_approval || 0);
  } catch (e) { /* ignore */ }
}

async function parseJsonResp(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch (e) {
    return { success: false, error: '接口未就绪，请重启后端后刷新' };
  }
}

async function loadRecruitJobs() {
  const tbody = document.getElementById('rcJobBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await parseJsonResp(await fetch(RC_API + '/recruit/job/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({
        operator: rcUser(),
        status: document.getElementById('rcJobStatus')?.value || null,
        department_id: document.getElementById('rcJobDept')?.value || null,
        keyword: document.getElementById('rcJobKeyword')?.value?.trim() || null
      })
    }));
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    rcJobCache = res.data || [];
    loadRecruitSummary();
    if (!rcJobCache.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">暂无岗位</td></tr>';
      return;
    }
    tbody.innerHTML = rcJobCache.map(j => {
      const badge = RC_BADGE[j.status] || 'badge-info';
      let acts = `<button class="row-btn" onclick="rcViewResumesForJob('${j.job_id}')">简历</button>`;
      if (rcCanManage()) {
        if (j.status === '草稿') {
          acts += `<button class="row-btn" onclick="editRecruitJob('${j.job_id}')">编辑</button>`;
          acts += `<button class="row-btn" onclick="publishRecruitJob('${j.job_id}')">发布</button>`;
          acts += `<button class="row-btn danger" onclick="deleteRecruitJob('${j.job_id}')">删除</button>`;
        } else if (j.status === '招聘中') {
          acts += `<button class="row-btn" onclick="editRecruitJob('${j.job_id}')">编辑</button>`;
        }
      }
      return `<tr>
        <td>${j.job_id}</td><td>${j.title}</td><td>${j.department || '-'}</td><td>${j.headcount}</td>
        <td>${j.deadline || '-'}</td><td>${j.resume_count}</td>
        <td><span class="badge ${badge}">${j.status}</span></td><td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function rcViewResumesForJob(jobId) {
  document.getElementById('rcResumeJob').value = jobId;
  setRcView('resume');
}

async function loadRecruitResumes() {
  const tbody = document.getElementById('rcResumeBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await parseJsonResp(await fetch(RC_API + '/recruit/resume/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({
        operator: rcUser(),
        job_id: document.getElementById('rcResumeJob')?.value || null,
        screen_status: document.getElementById('rcResumeStatus')?.value || null,
        keyword: document.getElementById('rcResumeKeyword')?.value?.trim() || null
      })
    }));
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">暂无简历</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const badge = RC_BADGE[r.screen_status] || 'badge-info';
      let acts = '';
      if (rcCanManage() && r.screen_status === '待筛选') {
        acts += `<button class="row-btn" onclick="screenResume('${r.resume_id}','pass')">通过</button>`;
        acts += `<button class="row-btn" onclick="screenResume('${r.resume_id}','reject')">拒绝</button>`;
      }
      if (rcCanManage() && r.screen_status === '通过') {
        acts += `<button class="row-btn" onclick="openRecruitInterview('${r.resume_id}')">面试</button>`;
        acts += `<button class="row-btn" onclick="applyRecruitHire('${r.resume_id}')">录用</button>`;
      }
      return `<tr>
        <td>${r.resume_id}</td><td>${r.name}</td><td>${r.job_title}</td><td>${r.education || '-'}</td>
        <td>${r.expected_salary || '-'}</td>
        <td><span class="badge ${badge}">${r.screen_status}</span></td>
        <td>${String(r.applied_at).slice(0, 16)}</td><td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadRecruitInterviews() {
  const tbody = document.getElementById('rcInterviewBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await parseJsonResp(await fetch(RC_API + '/recruit/interview/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({ operator: rcUser() })
    }));
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">暂无面试</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(iv => {
      const badge = RC_BADGE[iv.status] || 'badge-info';
      let acts = '';
      if ((rcIsMgr() || rcCanManage()) && iv.status === '已安排') {
        acts = `<button class="row-btn" onclick="evalRecruitInterview('${iv.interview_id}','${iv.resume_id}')">评价</button>`;
      }
      return `<tr>
        <td>${iv.interview_id}</td><td>${iv.candidate_name}</td><td>${iv.job_title}</td>
        <td>${iv.interviewer_name || iv.interviewer_emp_id || '-'}</td>
        <td>${String(iv.interview_time).slice(0, 16)}</td><td>${iv.location || '-'}</td>
        <td><span class="badge ${badge}">${iv.status}</span></td><td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadRecruitHires(extra) {
  const tbody = document.getElementById('rcHireBody');
  if (!tbody) return;
  try {
    const res = await parseJsonResp(await fetch(RC_API + '/recruit/hire/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({ operator: rcUser(), scope: extra?.scope || null })
    }));
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">暂无审批</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(h => {
      const badge = RC_BADGE[h.status] || 'badge-info';
      let acts = '';
      if (rcIsMgr() && h.status === '待主管审批') {
        acts += `<button class="row-btn" onclick="approveRecruitHire('${h.approval_id}','approve')">通过</button>`;
        acts += `<button class="row-btn" onclick="approveRecruitHire('${h.approval_id}','reject')">驳回</button>`;
      }
      if (rcCanManage() && h.status === '已通过') {
        acts += `<button class="row-btn" onclick="issueRecruitOffer('${h.resume_id}')">发Offer</button>`;
      }
      return `<tr>
        <td>${h.approval_id}</td><td>${h.candidate_name}</td><td>${h.job_title}</td>
        <td>${h.proposed_salary || '-'}</td>
        <td><span class="badge ${badge}">${h.status}</span></td><td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadRecruitOffers() {
  const tbody = document.getElementById('rcOfferBody');
  if (!tbody) return;
  try {
    const res = await parseJsonResp(await fetch(RC_API + '/recruit/offer/query', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({ operator: rcUser() })
    }));
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">暂无 Offer</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(o => {
      const badge = RC_BADGE[o.confirm_status] || 'badge-info';
      let acts = '';
      if (o.confirm_status === '待确认') {
        acts += `<button class="row-btn" onclick="confirmOffer('${o.offer_id}','accept')">模拟接受</button>`;
        acts += `<button class="row-btn" onclick="confirmOffer('${o.offer_id}','reject')">拒绝</button>`;
      }
      if (rcCanManage() && o.confirm_status === '已接受' && !o.synced_emp_id) {
        acts += `<button class="row-btn primary" onclick="syncRecruitOnboard('${o.offer_id}')">入职同步</button>`;
      }
      if (o.synced_emp_id) acts += `<span style="font-size:12px;color:#666">已同步 ${o.synced_emp_id}</span>`;
      return `<tr>
        <td>${o.offer_id}</td><td>${o.candidate_name}</td><td>${o.job_title}</td>
        <td>${o.salary || '-'}</td><td>${o.onboard_date ? String(o.onboard_date).slice(0, 10) : '-'}</td>
        <td><span class="badge ${badge}">${o.confirm_status}</span></td><td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

function openRecruitJobModal(edit) {
  document.getElementById('rcJobEditId').value = edit?.job_id || '';
  document.getElementById('rcJobModalTitle').textContent = edit ? '编辑职位' : '发布职位';
  document.getElementById('rcJobTitle').value = edit?.title || '';
  document.getElementById('rcJobDeptSel').value = edit?.department_id || '';
  document.getElementById('rcJobHeadcount').value = edit?.headcount || 1;
  document.getElementById('rcJobSalary').value = edit?.salary_range || '';
  document.getElementById('rcJobLocation').value = edit?.location || '';
  document.getElementById('rcJobDeadline').value = edit?.deadline || '';
  document.getElementById('rcJobDuties').value = edit?.job_duties || '';
  document.getElementById('rcJobReqs').value = edit?.job_requirements || '';
  document.getElementById('rcJobResult').textContent = '';
  openModal('modalRecruitJob');
}

function editRecruitJob(jobId) {
  const j = rcJobCache.find(x => x.job_id === jobId);
  if (j) openRecruitJobModal(j);
}

async function publishRecruitJob(jobId) {
  if (!confirm('确认发布该职位？')) return;
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/job/publish', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), job_id: jobId })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitJobs();
}

async function deleteRecruitJob(jobId) {
  if (!confirm('确认删除草稿？')) return;
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/job/' + jobId + '?operator=' + encodeURIComponent(rcUser()), { method: 'DELETE' }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitJobs();
}

async function screenResume(resumeId, action) {
  const comment = action === 'reject' ? (prompt('拒绝原因（可选）') || '') : '';
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/resume/screen', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), resume_id: resumeId, action, comment })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitResumes();
}

function openRecruitInterview(resumeId) {
  document.getElementById('rcIvResumeId').value = resumeId;
  document.getElementById('rcIvResult').textContent = '';
  openModal('modalRecruitInterview');
}

async function evalRecruitInterview(interviewId, resumeId) {
  const score = prompt('面试评分（0-100）', '85');
  if (score == null) return;
  const content = prompt('评价内容', '') || '';
  const recommend = confirm('是否推荐录用？确定=是，取消=否') ? '是' : '否';
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/interview/eval', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), interview_id: interviewId, resume_id: resumeId, score, content, recommend_hire: recommend })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitInterviews();
}

async function applyRecruitHire(resumeId) {
  const salary = prompt('拟录用薪资', '10K') || '';
  const onboard = prompt('拟入职日期 YYYY-MM-DD', rcLocalDate()) || '';
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/hire/apply', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), resume_id: resumeId, proposed_salary: salary, proposed_onboard: onboard })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) { loadRecruitResumes(); loadRecruitHires(); }
}

async function approveRecruitHire(approvalId, action) {
  const comment = prompt('审批意见（可选）', '') || '';
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/hire/approve', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({
      operator: rcUser(), approval_id: approvalId,
      action: action === 'approve' ? 'approve' : 'reject', comment
    })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) { loadRecruitHires(); loadRecruitSummary(); }
}

async function issueRecruitOffer(resumeId) {
  const salary = prompt('Offer 薪资', '10K') || '';
  const onboard = prompt('入职日期', rcLocalDate()) || '';
  const expire = prompt('Offer 有效期', '') || '';
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/offer/issue', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), resume_id: resumeId, salary, onboard_date: onboard, expire_date: expire || null })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitOffers();
}

async function confirmOffer(offerId, action) {
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/offer/confirm', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ offer_id: offerId, action })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitOffers();
}

async function syncRecruitOnboard(offerId) {
  if (!confirm('确认将候选人同步为员工档案？')) return;
  const res = await parseJsonResp(await fetch(RC_API + '/recruit/onboard/sync', {
    method: 'POST', headers: RC_JSON,
    body: JSON.stringify({ operator: rcUser(), offer_id: offerId })
  }));
  alert(res.message || res.error || '完成');
  if (res.success) loadRecruitOffers();
}

async function exportRecruit(type) {
  try {
    const res = await fetch(RC_API + '/recruit/export', {
      method: 'POST', headers: RC_JSON,
      body: JSON.stringify({ operator: rcUser(), type })
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (type === 'resume' ? '招聘简历_' : '招聘岗位_') + rcLocalDate() + '.csv';
    a.click();
  } catch (e) { alert('导出失败'); }
}

function bindRecruitPanel() {
  document.getElementById('rcViewJob')?.addEventListener('click', () => setRcView('job'));
  document.getElementById('rcViewResume')?.addEventListener('click', () => setRcView('resume'));
  document.getElementById('rcViewInterview')?.addEventListener('click', () => setRcView('interview'));
  document.getElementById('rcViewHire')?.addEventListener('click', () => setRcView('hire'));
  document.getElementById('rcJobQueryBtn')?.addEventListener('click', loadRecruitJobs);
  document.getElementById('rcResumeQueryBtn')?.addEventListener('click', loadRecruitResumes);
  document.getElementById('rcInterviewQueryBtn')?.addEventListener('click', loadRecruitInterviews);
  document.getElementById('rcHireQueryBtn')?.addEventListener('click', () => loadRecruitHires());
  document.getElementById('rcOfferQueryBtn')?.addEventListener('click', loadRecruitOffers);
  document.getElementById('rcPendingHireBtn')?.addEventListener('click', () => loadRecruitHires({ scope: 'pending_mgr' }));
  document.getElementById('rcAddJobBtn')?.addEventListener('click', () => openRecruitJobModal());
  document.getElementById('rcAddResumeBtn')?.addEventListener('click', () => {
    loadRcJobSelects();
    document.getElementById('rcResumeResult').textContent = '';
    openModal('modalRecruitResume');
  });
  document.getElementById('rcJobExportBtn')?.addEventListener('click', () => exportRecruit('job'));
  document.getElementById('rcResumeExportBtn')?.addEventListener('click', () => exportRecruit('resume'));

  document.getElementById('rcJobForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('rcJobResult');
    const editId = document.getElementById('rcJobEditId').value;
    const body = {
      operator: rcUser(),
      title: document.getElementById('rcJobTitle').value.trim(),
      department_id: document.getElementById('rcJobDeptSel').value,
      headcount: document.getElementById('rcJobHeadcount').value,
      salary_range: document.getElementById('rcJobSalary').value.trim(),
      location: document.getElementById('rcJobLocation').value.trim(),
      deadline: document.getElementById('rcJobDeadline').value || null,
      job_duties: document.getElementById('rcJobDuties').value.trim(),
      job_requirements: document.getElementById('rcJobReqs').value.trim()
    };
    try {
      const url = editId ? RC_API + '/recruit/job/' + editId : RC_API + '/recruit/job';
      const res = await parseJsonResp(await fetch(url, {
        method: editId ? 'PUT' : 'POST', headers: RC_JSON, body: JSON.stringify(body)
      }));
      result.textContent = res.message || res.error || '';
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalRecruitJob'); loadRecruitJobs(); }, 800);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });

  document.getElementById('rcResumeForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('rcResumeResult');
    const body = {
      job_id: document.getElementById('rcResumeJobSel').value,
      name: document.getElementById('rcResumeName').value.trim(),
      phone: document.getElementById('rcResumePhone').value.trim(),
      email: document.getElementById('rcResumeEmail').value.trim(),
      education: document.getElementById('rcResumeEdu').value.trim(),
      expected_salary: document.getElementById('rcResumeSalary').value.trim(),
      work_experience: document.getElementById('rcResumeWork').value.trim()
    };
    try {
      const res = await parseJsonResp(await fetch(RC_API + '/recruit/resume/apply', {
        method: 'POST', headers: RC_JSON, body: JSON.stringify(body)
      }));
      result.textContent = res.message || res.error || '';
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalRecruitResume'); loadRecruitResumes(); loadRecruitSummary(); }, 800);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });

  document.getElementById('rcInterviewForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('rcIvResult');
    const t = document.getElementById('rcIvTime').value;
    try {
      const res = await parseJsonResp(await fetch(RC_API + '/recruit/interview', {
        method: 'POST', headers: RC_JSON,
        body: JSON.stringify({
          operator: rcUser(),
          resume_id: document.getElementById('rcIvResumeId').value,
          round_num: document.getElementById('rcIvRound').value,
          interview_time: t.replace('T', ' ') + ':00',
          location: document.getElementById('rcIvLocation').value.trim(),
          interviewer_emp_id: document.getElementById('rcIvInterviewer').value.trim()
        })
      }));
      result.textContent = res.message || res.error || '';
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalRecruitInterview'); loadRecruitInterviews(); }, 800);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });
}

function onRecruitPanelShow() {
  setRcView('job');
  loadRecruitSummary();
}
