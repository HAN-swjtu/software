// training-module.js - 培训管理 文档 3.3.6（1.1~1.5）
const TR_API = 'http://localhost:3001/api';
const TR_JSON = { 'Content-Type': 'application/json; charset=utf-8' };

const TR_BADGE = {
  '草稿': 'badge-danger', '报名中': 'badge-info', '未开始': 'badge-info',
  '进行中': 'badge-warning', '已完成': 'badge-success',
  '待汇总': 'badge-warning', '已汇总': 'badge-success', '已立项': 'badge-info',
  '已签到': 'badge-success', '迟到': 'badge-warning', '缺勤': 'badge-danger',
  '待评定': 'badge-warning', '合格': 'badge-success', '优秀': 'badge-info', '不合格': 'badge-danger'
};

function trUser() { return sessionStorage.getItem('currentUsername') || ''; }
function trRole() { return sessionStorage.getItem('currentRole') || ''; }
function trIsHR() { return ['HR专员', '管理员'].includes(trRole()) || trUser() === 'root'; }
function trIsMgr() { return trRole() === '部门主管'; }
function trLocalDate(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let trCourseCache = [];
let trViewMode = 'course';
let trMyEnrollIds = new Set();

document.addEventListener('DOMContentLoaded', function () {
  initTrainingModule();
});

function initTrainingModule() {
  setupTrainingUI();
  bindTrainingPanel();
}

function setupTrainingUI() {
  const isRoot = trUser() === 'root' || !sessionStorage.getItem('empId');
  ['trAddCourseBtn', 'trExportBtn', 'trSummarizeBtn', 'trAttExportBtn', 'trViewAtt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = trIsHR() ? '' : 'none';
  });
  const resultBtn = document.getElementById('trViewResult');
  if (resultBtn) resultBtn.style.display = (trIsHR() || trIsMgr()) ? '' : 'none';
  const needBtn = document.getElementById('trNeedBtn');
  if (needBtn) needBtn.style.display = (trIsMgr() || trIsHR()) && !isRoot ? '' : 'none';
  const needWrap = document.getElementById('trStatNeedWrap');
  if (needWrap) needWrap.style.display = trIsHR() ? '' : 'none';
  const chkTh = document.getElementById('trNeedChkTh');
  if (chkTh) chkTh.style.display = trIsHR() ? '' : 'none';

  const tip = document.getElementById('trPanelTip');
  if (tip) {
    if (trIsHR()) {
      tip.textContent = 'HR：汇总部门需求 → 创建并发布课程 → 查看报名与培训考勤；员工可报名、现场签到';
    } else if (trIsMgr()) {
      tip.textContent = '部门主管：可发起培训需求；员工可浏览已发布课程并报名、签到';
    } else if (isRoot) {
      tip.textContent = '管理员：可查看全部培训数据；员工业务请使用员工账号';
    } else {
      tip.textContent = '浏览已发布课程，报名后请在培训当天完成签到';
    }
  }
}

function setTrView(mode) {
  trViewMode = mode;
  document.getElementById('trViewCourse')?.classList.toggle('active', mode === 'course');
  document.getElementById('trViewNeed')?.classList.toggle('active', mode === 'need');
  document.getElementById('trViewAtt')?.classList.toggle('active', mode === 'att');
  document.getElementById('trViewResult')?.classList.toggle('active', mode === 'result');
  document.getElementById('trCourseSection').style.display = mode === 'course' ? '' : 'none';
  document.getElementById('trNeedSection').style.display = mode === 'need' ? '' : 'none';
  document.getElementById('trAttSection').style.display = mode === 'att' ? '' : 'none';
  document.getElementById('trResultSection').style.display = mode === 'result' ? '' : 'none';
  if (mode === 'course') loadTrainingCourses();
  else if (mode === 'need') loadTrainingNeeds();
  else if (mode === 'att') loadTrainingAttendance();
  else loadTrainingResults();
}

async function loadTrainingSummary() {
  try {
    const res = await fetch(TR_API + '/training/summary', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({})
    }).then(r => r.json());
    if (!res.success || !res.data) return;
    const s = res.data;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('trStatCourses', s.course_total || 0);
    set('trStatEnroll', s.enroll_total || 0);
    set('trStatDone', s.course_done || 0);
    set('trStatNeed', s.need_pending || 0);
  } catch (e) { /* ignore */ }
}

async function refreshMyEnrollments() {
  trMyEnrollIds = new Set();
  if (!sessionStorage.getItem('empId')) return;
  try {
    const res = await fetch(TR_API + '/training/my?username=' + encodeURIComponent(trUser())).then(r => r.json());
    if (res.success && res.enrollments) {
      res.enrollments.forEach(e => trMyEnrollIds.add(e.course_id));
    }
  } catch (e) { /* ignore */ }
}

async function loadTrainingCourses() {
  const tbody = document.getElementById('trCourseBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">加载中...</td></tr>';
  await refreshMyEnrollments();
  try {
    const resp = await fetch(TR_API + '/training/course/query', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({
        operator: trUser(),
        status: document.getElementById('trFilterStatus')?.value || null,
        train_type: document.getElementById('trFilterType')?.value || null,
        keyword: document.getElementById('trKeyword')?.value?.trim() || null
      })
    });
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
    trCourseCache = res.data || [];
    loadTrainingSummary();
    if (!trCourseCache.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">暂无课程</td></tr>';
      return;
    }
    tbody.innerHTML = trCourseCache.map(c => {
      const badge = TR_BADGE[c.status] || 'badge-info';
      let acts = `<button class="row-btn" onclick="showTrainingDetail('${c.course_id}')">详情</button>`;
      if (trIsHR()) {
        if (c.status === '草稿') {
          acts += `<button class="row-btn" onclick="editTrainingCourse('${c.course_id}')">编辑</button>`;
          acts += `<button class="row-btn" onclick="publishTrainingCourse('${c.course_id}')">发布</button>`;
          acts += `<button class="row-btn danger" onclick="deleteTrainingCourse('${c.course_id}')">删除</button>`;
        } else if (c.status !== '已完成') {
          acts += `<button class="row-btn" onclick="editTrainingCourse('${c.course_id}')">编辑</button>`;
        }
      }
      if (!trIsHR() && trUser() !== 'root' && sessionStorage.getItem('empId')) {
        const enrolled = trMyEnrollIds.has(c.course_id);
        if (['报名中', '进行中', '未开始'].includes(c.status)) {
          if (enrolled) {
            acts += `<button class="row-btn" onclick="cancelTrainingEnroll('${c.course_id}')">取消报名</button>`;
            if (['进行中', '报名中'].includes(c.status)) {
              acts += `<button class="row-btn primary" onclick="trainingCheckin('${c.course_id}')">签到</button>`;
            }
          } else if (c.enroll_count < c.capacity) {
            acts += `<button class="row-btn primary" onclick="enrollTraining('${c.course_id}')">报名</button>`;
          }
        }
      }
      return `<tr>
        <td>${c.course_id}</td><td>${c.title}</td><td>${c.train_type}</td><td>${c.trainer || '-'}</td>
        <td>${c.start_date}</td><td>${c.end_date}</td>
        <td>${c.enroll_count}/${c.capacity}</td>
        <td><span class="badge ${badge}">${c.status}</span></td>
        <td>${acts}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadTrainingNeeds() {
  const tbody = document.getElementById('trNeedBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await fetch(TR_API + '/training/need/query', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({
        operator: trUser(),
        status: document.getElementById('trNeedStatus')?.value || null
      })
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">暂无培训需求</td></tr>';
      return;
    }
    const showChk = trIsHR();
    tbody.innerHTML = rows.map(r => {
      const chk = showChk && r.status === '待汇总'
        ? `<td><input type="checkbox" class="tr-need-chk" value="${r.need_id}" /></td>` : (showChk ? '<td></td>' : '');
      const badge = TR_BADGE[r.status] || 'badge-info';
      return `<tr>${chk}
        <td>${r.need_id}</td><td>${r.department_name}</td><td>${r.theme}</td>
        <td>${(r.goal || '').slice(0, 40)}</td><td>${r.headcount}</td>
        <td><span class="badge ${badge}">${r.status}</span></td>
        <td>${String(r.created_at).slice(0, 16)}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadTrainingAttendance() {
  const tbody = document.getElementById('trAttBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await fetch(TR_API + '/training/attendance/query', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({
        operator: trUser(),
        keyword: document.getElementById('trAttKeyword')?.value?.trim() || null
      })
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">暂无考勤记录</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const badge = TR_BADGE[r.check_status] || 'badge-success';
      return `<tr>
        <td>${r.att_id}</td><td>${r.course_title}（${r.course_id}）</td>
        <td>${r.emp_id}</td><td>${r.name}</td><td>${r.department || '-'}</td>
        <td>${String(r.check_time).slice(0, 16)}</td>
        <td><span class="badge ${badge}">${r.check_status}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function loadTrainingResults() {
  const tbody = document.getElementById('trResultBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center">加载中...</td></tr>';
  try {
    const res = await fetch(TR_API + '/training/result/query', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({
        operator: trUser(),
        keyword: document.getElementById('trResultKeyword')?.value?.trim() || null,
        result_status: document.getElementById('trResultStatus')?.value || null
      })
    }).then(r => r.json());
    if (!res.success) {
      tbody.innerHTML = `<tr><td colspan="10" style="color:red;text-align:center">${res.error || '加载失败'}</td></tr>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center">暂无培训成果记录</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const resultBadge = TR_BADGE[r.result_status] || 'badge-info';
      const checkBadge = TR_BADGE[r.check_status] || 'badge-warning';
      const canEdit = trIsHR() || trIsMgr();
      return `<tr>
        <td>${r.course_title}（${r.course_id}）</td>
        <td>${r.emp_id}</td><td>${r.name}</td><td>${r.department || '-'}</td>
        <td><span class="badge ${checkBadge}">${r.check_status || '未签到'}</span></td>
        <td>${r.score ?? '-'}</td>
        <td><span class="badge ${resultBadge}">${r.result_status || '待评定'}</span></td>
        <td>${r.certificate || '-'}</td>
        <td>${r.feedback || '-'}</td>
        <td>${canEdit ? `<button class="row-btn" onclick="saveTrainingResult('${r.course_id}','${r.emp_id}','${(r.name || '').replace(/'/g, "\\'")}','${r.result_status || '待评定'}','${r.score ?? ''}','${(r.certificate || '').replace(/'/g, "\\'")}','${(r.feedback || '').replace(/'/g, "\\'")}')">登记成果</button>` : '-'}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="10" style="color:red;text-align:center">加载失败</td></tr>';
  }
}

async function saveTrainingResult(courseId, empId, name, oldStatus, oldScore, oldCert, oldFeedback) {
  const status = prompt(`请输入 ${name} 的培训成果状态（待评定/合格/优秀/不合格）`, oldStatus || '合格');
  if (status == null) return;
  const score = prompt('请输入培训考核成绩（0-100，可留空）', oldScore || '');
  if (score == null) return;
  const certificate = prompt('请输入证书或成果材料说明（可留空）', oldCert || '');
  if (certificate == null) return;
  const feedback = prompt('请输入培训反馈或成果说明（可留空）', oldFeedback || '');
  if (feedback == null) return;
  try {
    const res = await fetch(TR_API + '/training/result/save', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({
        operator: trUser(),
        course_id: courseId,
        emp_id: empId,
        result_status: status.trim(),
        score: score.trim(),
        certificate: certificate.trim(),
        feedback: feedback.trim()
      })
    }).then(r => r.json());
    alert(res.message || res.error || '');
    if (res.success) loadTrainingResults();
  } catch (e) {
    alert('保存失败：' + e.message);
  }
}

async function showTrainingDetail(courseId) {
  const c = trCourseCache.find(x => x.course_id === courseId);
  if (!c) return;
  let enrollHtml = '';
  if (trIsHR() || trIsMgr()) {
    try {
      const res = await fetch(TR_API + '/training/enroll/list', {
        method: 'POST', headers: TR_JSON,
        body: JSON.stringify({ operator: trUser(), course_id: courseId })
      }).then(r => r.json());
      if (res.success && res.data?.length) {
        enrollHtml = '<h4 style="margin-top:12px">报名名单</h4><ul>' +
          res.data.map(e => `<li>${e.name}（${e.emp_id}） ${String(e.enrolled_at).slice(0, 16)}</li>`).join('') +
          '</ul>';
      } else {
        enrollHtml = '<p style="margin-top:12px;color:#888">暂无报名</p>';
      }
    } catch (e) { enrollHtml = ''; }
  }
  document.getElementById('trDetailBody').innerHTML = `
    <p><strong>${c.title}</strong>（${c.course_id}）</p>
    <p>类型：${c.train_type} · 讲师：${c.trainer || '-'} · 状态：<span class="badge ${TR_BADGE[c.status] || ''}">${c.status}</span></p>
    <p>时间：${c.start_date} 至 ${c.end_date} · 地点：${c.location || '-'}</p>
    <p>报名：${c.enroll_count} / ${c.capacity}</p>
    <p>内容：${c.content || '无'}</p>
    <p>公告：${c.notice || '无'}</p>
    ${enrollHtml}`;
  openModal('modalTrainingDetail');
}

function openTrainingNeedModal() {
  document.getElementById('trNeedTheme').value = '';
  document.getElementById('trNeedGoal').value = '';
  document.getElementById('trNeedHeadcount').value = '10';
  document.getElementById('trNeedResult').textContent = '';
  openModal('modalTrainingNeed');
}

function openTrainingCourseModal(edit) {
  document.getElementById('trCourseEditId').value = edit?.course_id || '';
  document.getElementById('trCourseModalTitle').textContent = edit ? '编辑培训课程' : '新建培训课程';
  document.getElementById('trCourseTitle').value = edit?.title || '';
  document.getElementById('trCourseType').value = edit?.train_type || '内部培训';
  document.getElementById('trCourseTrainer').value = edit?.trainer || '';
  document.getElementById('trCourseStart').value = edit?.start_date || trLocalDate();
  document.getElementById('trCourseEnd').value = edit?.end_date || trLocalDate();
  document.getElementById('trCourseLocation').value = edit?.location || '';
  document.getElementById('trCourseCapacity').value = edit?.capacity || 50;
  document.getElementById('trCourseContent').value = edit?.content || '';
  document.getElementById('trCourseNotice').value = edit?.notice || '';
  document.getElementById('trCourseResult').textContent = '';
  openModal('modalTrainingCourse');
}

function editTrainingCourse(courseId) {
  const c = trCourseCache.find(x => x.course_id === courseId);
  if (c) openTrainingCourseModal(c);
}

async function publishTrainingCourse(courseId) {
  if (!confirm('确认发布该培训课程？发布后员工可报名。')) return;
  const res = await fetch(TR_API + '/training/course/publish', {
    method: 'POST', headers: TR_JSON,
    body: JSON.stringify({ operator: trUser(), course_id: courseId })
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingCourses();
}

async function deleteTrainingCourse(courseId) {
  if (!confirm('确认删除该草稿课程？')) return;
  const res = await fetch(TR_API + '/training/course/' + courseId + '?operator=' + encodeURIComponent(trUser()), {
    method: 'DELETE'
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingCourses();
}

async function enrollTraining(courseId) {
  const res = await fetch(TR_API + '/training/enroll', {
    method: 'POST', headers: TR_JSON,
    body: JSON.stringify({ operator: trUser(), course_id: courseId })
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingCourses();
}

async function cancelTrainingEnroll(courseId) {
  if (!confirm('确认取消报名？')) return;
  const res = await fetch(TR_API + '/training/enroll/cancel', {
    method: 'POST', headers: TR_JSON,
    body: JSON.stringify({ operator: trUser(), course_id: courseId })
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingCourses();
}

async function trainingCheckin(courseId) {
  const res = await fetch(TR_API + '/training/checkin', {
    method: 'POST', headers: TR_JSON,
    body: JSON.stringify({ operator: trUser(), course_id: courseId })
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingCourses();
}

async function summarizeTrainingNeeds() {
  const ids = [...document.querySelectorAll('.tr-need-chk:checked')].map(c => c.value);
  if (!ids.length) { alert('请先勾选待汇总的需求'); return; }
  const res = await fetch(TR_API + '/training/need/summarize', {
    method: 'POST', headers: TR_JSON,
    body: JSON.stringify({ operator: trUser(), need_ids: ids })
  }).then(r => r.json());
  alert(res.message || res.error || '操作完成');
  if (res.success) loadTrainingNeeds();
}

async function exportTraining(type) {
  try {
    const res = await fetch(TR_API + '/training/export', {
      method: 'POST', headers: TR_JSON,
      body: JSON.stringify({ operator: trUser(), type })
    });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (type === 'attendance' ? '培训考勤_' : '培训课程_') + trLocalDate() + '.csv';
    a.click();
  } catch (e) { alert('导出失败：' + e.message); }
}

function bindTrainingPanel() {
  document.getElementById('trViewCourse')?.addEventListener('click', () => setTrView('course'));
  document.getElementById('trViewNeed')?.addEventListener('click', () => setTrView('need'));
  document.getElementById('trViewAtt')?.addEventListener('click', () => setTrView('att'));
  document.getElementById('trViewResult')?.addEventListener('click', () => setTrView('result'));
  document.getElementById('trQueryBtn')?.addEventListener('click', loadTrainingCourses);
  document.getElementById('trNeedQueryBtn')?.addEventListener('click', loadTrainingNeeds);
  document.getElementById('trAttQueryBtn')?.addEventListener('click', loadTrainingAttendance);
  document.getElementById('trResultQueryBtn')?.addEventListener('click', loadTrainingResults);
  document.getElementById('trAddCourseBtn')?.addEventListener('click', () => openTrainingCourseModal());
  document.getElementById('trNeedBtn')?.addEventListener('click', openTrainingNeedModal);
  document.getElementById('trSummarizeBtn')?.addEventListener('click', summarizeTrainingNeeds);
  document.getElementById('trExportBtn')?.addEventListener('click', () => exportTraining('courses'));
  document.getElementById('trAttExportBtn')?.addEventListener('click', () => exportTraining('attendance'));

  document.getElementById('trNeedChkAll')?.addEventListener('change', function () {
    document.querySelectorAll('.tr-need-chk').forEach(c => { c.checked = this.checked; });
  });

  document.getElementById('trNeedForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('trNeedResult');
    try {
      const res = await fetch(TR_API + '/training/need', {
        method: 'POST', headers: TR_JSON,
        body: JSON.stringify({
          operator: trUser(),
          theme: document.getElementById('trNeedTheme').value.trim(),
          goal: document.getElementById('trNeedGoal').value.trim(),
          headcount: document.getElementById('trNeedHeadcount').value
        })
      }).then(r => r.json());
      result.textContent = res.message || res.error || '';
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalTrainingNeed'); loadTrainingNeeds(); loadTrainingSummary(); }, 800);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });

  document.getElementById('trCourseForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const result = document.getElementById('trCourseResult');
    const editId = document.getElementById('trCourseEditId').value;
    const body = {
      operator: trUser(),
      title: document.getElementById('trCourseTitle').value.trim(),
      train_type: document.getElementById('trCourseType').value,
      trainer: document.getElementById('trCourseTrainer').value.trim(),
      start_date: document.getElementById('trCourseStart').value,
      end_date: document.getElementById('trCourseEnd').value,
      location: document.getElementById('trCourseLocation').value.trim(),
      capacity: document.getElementById('trCourseCapacity').value,
      content: document.getElementById('trCourseContent').value.trim(),
      notice: document.getElementById('trCourseNotice').value.trim()
    };
    try {
      const url = editId ? TR_API + '/training/course/' + editId : TR_API + '/training/course';
      const res = await fetch(url, {
        method: editId ? 'PUT' : 'POST',
        headers: TR_JSON,
        body: JSON.stringify(body)
      }).then(r => r.json());
      result.textContent = res.message || res.error || '';
      result.className = 'reg-result ' + (res.success ? 'success' : 'error');
      if (res.success) {
        setTimeout(() => { closeModal('modalTrainingCourse'); loadTrainingCourses(); }, 800);
      }
    } catch (err) {
      result.textContent = '请求失败';
      result.className = 'reg-result error';
    }
  });
}

function onTrainingPanelShow() {
  setTrView('course');
  loadTrainingSummary();
}
