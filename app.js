// app.js - 后端联动逻辑
const API = 'http://localhost:3001/api';

// ============ 工具函数 ============
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', function(e) { if (e.target === el) closeModal(el.id); });
  });
  loadStats();
  bindStatCards();
  bindRegisterForm();
  bindChangePwdForm();
  bindChangeUserForm();
  const hireDateEl = document.getElementById('regHireDate');
  if (hireDateEl && !hireDateEl.value) hireDateEl.value = new Date().toISOString().slice(0, 10);
  // 普通员工默认进入「我的」时加载
  if (document.getElementById('panel-mine') &&
      document.getElementById('panel-mine').classList.contains('active')) {
    loadMyProfile();
  }
  // 预填账号
  const uname = sessionStorage.getItem('currentUsername') || '';
  if (uname) {
    const cpwd = document.getElementById('cpwdUsername');
    const cuser = document.getElementById('cuserOld');
    if (cpwd) cpwd.value = uname;
    if (cuser) cuser.value = uname;
  }
});

// ============ 控制台统计 ============
async function loadStats() {
  try {
    const data = await fetch(API+'/stats').then(r=>r.json());
    const cards = document.querySelectorAll('#panel-dashboard .stat-card');
    [data.employees,data.departments,data.attendance,data.newEmployees,data.pendingLeave,data.recruiters]
      .forEach((v,i) => { const el=cards[i] && cards[i].querySelector('.stat-num'); if(el && v!==undefined) el.textContent=v; });
  } catch(e) { console.warn('统计加载失败:',e.message); }
}

// ============ 员工弹窗 ============
let allEmployees = [];
async function showEmployeeModal() {
  openModal('modalEmployees');
  if (allEmployees.length) { renderEmployeeTable(allEmployees); return; }
  const tbody = document.getElementById('empModalBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px">加载中...</td></tr>';
  try {
    allEmployees = await fetch(API+'/employees').then(r=>r.json());
    renderEmployeeTable(allEmployees);
  } catch(e) { tbody.innerHTML = '<tr><td colspan="6" style="color:red;text-align:center">加载失败：'+e.message+'</td></tr>'; }
}
function renderEmployeeTable(list) {
  const tbody = document.getElementById('empModalBody');
  if (!list.length) { tbody.innerHTML='<tr><td colspan="6" style="text-align:center">无数据</td></tr>'; return; }
  tbody.innerHTML = list.map(e=>`<tr><td>${e.emp_id}</td><td>${e.name}</td><td>${e.gender}</td><td>${e.department||'-'}</td><td>${e.role||'-'}</td><td>${e.phone||'-'}</td></tr>`).join('');
}
function filterEmployeeTable() {
  const kw = document.getElementById('empSearchInput').value.trim().toLowerCase();
  if (!kw) { renderEmployeeTable(allEmployees); return; }
  renderEmployeeTable(allEmployees.filter(e=>[e.emp_id,e.name,e.department,e.role,e.phone].some(v=>v&&v.toLowerCase().includes(kw))));
}

// ============ 部门弹窗 ============
async function showDeptModal() {
  openModal('modalDepartments');
  const body = document.getElementById('deptModalBody');
  body.innerHTML = '<div style="text-align:center;padding:20px">加载中...</div>';
  try {
    const depts = await fetch(API+'/departments').then(r=>r.json());
    body.innerHTML = depts.map(d=>`
      <div class="dept-section">
        <div class="dept-section-title">&#127970; ${d.name}<span class="dept-count">${d.employees.length} 人</span></div>
        <table class="data-table"><thead><tr><th>工号</th><th>姓名</th><th>性别</th><th>角色</th></tr></thead>
        <tbody>${d.employees.map(e=>`<tr><td>${e.emp_id}</td><td>${e.name}</td><td>${e.gender}</td><td>${e.role||'-'}</td></tr>`).join('')}</tbody></table>
      </div>`).join('');
  } catch(e) { body.innerHTML='<div style="color:red;text-align:center">加载失败：'+e.message+'</div>'; }
}

function bindStatCards() {
  const cards = document.querySelectorAll('#panel-dashboard .stat-card');
  if (cards[0]) { cards[0].style.cursor='pointer'; cards[0].addEventListener('click',showEmployeeModal); }
  if (cards[1]) { cards[1].style.cursor='pointer'; cards[1].addEventListener('click',showDeptModal); }
}

// ============ 「我的」面板 ============
let myProfileLoaded = false;
window.resetMyProfile = function() { myProfileLoaded = false; };

async function loadMyProfile() {
  if (myProfileLoaded) return;
  const username = sessionStorage.getItem('currentUsername') || '';
  if (!username) {
    document.getElementById('mineInfoList').innerHTML = '<div class="mine-loading">请使用员工账号登录以查看个人信息</div>';
    document.getElementById('mineAttTable').innerHTML = '';
    document.getElementById('mineLvTable').innerHTML = '';
    return;
  }
  try {
    const d = await fetch(API+'/my-profile?username='+encodeURIComponent(username)).then(r=>r.json());
    if (d.error) throw new Error(d.error);

    document.getElementById('mineAvatar').textContent = d.name ? d.name[0] : '?';
    document.getElementById('mineInfoList').innerHTML =
      [['姓名',d.name],['性别',d.gender],['账号',d.username],['工号',d.emp_id],
       ['部门',d.department||'-'],['角色',d.role||'-'],
       ['员工状态',d.emp_status||'在职'],
       ['出生日期',d.birth_date||'-'],['身份证号',d.id_card||'-'],
       ['电话',d.phone||'-'],['邮箱',d.email||'-'],['现居地址',d.address||'-'],
       ['紧急联系人',d.emergency_contact||'-'],['紧急电话',d.emergency_phone||'-'],
       ['入职时间',d.contract_start||'-'],['合同到期',d.contract_end||'-'],
       ['试用期',d.probation_start ? d.probation_start+' ~ '+d.probation_end : '-'],
       ['部门主管',d.manager ? d.manager.name+'（'+d.manager.role+'）' : '-']]
      .map(([k,v])=>`<div class="mine-info-item"><span class="mine-info-label">${k}</span><span class="mine-info-val">${v}</span></div>`).join('');

    const SC = {'正常':'badge-success','迟到':'badge-warning','早退':'badge-warning','缺勤':'badge-danger','请假':'badge-info'};
    const attEl = document.getElementById('mineAttTable');
    attEl.innerHTML = d.attendance && d.attendance.length
      ? `<table class="data-table"><thead><tr><th>日期</th><th>状态</th><th>签到</th><th>签退</th></tr></thead><tbody>
         ${d.attendance.map(a=>`<tr><td>${a.check_date}</td><td><span class="badge ${SC[a.status]||'badge-info'}">${a.status}</span></td><td>${a.check_in||'-'}</td><td>${a.check_out||'-'}</td></tr>`).join('')}
         </tbody></table>`
      : '<div class="mine-empty">暂无考勤记录</div>';

    const LC = {'已批准':'badge-success','待审批':'badge-warning','已拒绝':'badge-danger'};
    const lvEl = document.getElementById('mineLvTable');
    lvEl.innerHTML = d.leaves && d.leaves.length
      ? `<table class="data-table"><thead><tr><th>类型</th><th>开始</th><th>结束</th><th>天数</th><th>原因</th><th>状态</th></tr></thead><tbody>
         ${d.leaves.map(l=>`<tr><td>${l.leave_type}</td><td>${l.start_date}</td><td>${l.end_date}</td><td>${l.days}</td><td>${l.reason||'-'}</td><td><span class="badge ${LC[l.status]||'badge-info'}">${l.status}</span></td></tr>`).join('')}
         </tbody></table>`
      : '<div class="mine-empty">暂无请假记录</div>';

    myProfileLoaded = true;
  } catch(e) {
    document.getElementById('mineInfoList').innerHTML = '<div class="mine-loading">加载失败：'+e.message+'</div>';
  }
}

// ============ 新员工注册 ============
async function openRegisterModal() {
  openModal('modalRegister');
  try {
    const [depts, roles] = await Promise.all([fetch(API+'/departments/list').then(r=>r.json()), fetch(API+'/roles').then(r=>r.json())]);
    const dSel=document.getElementById('regDept'), rSel=document.getElementById('regRole');
    if (!dSel.options.length) depts.forEach(d=>dSel.add(new Option(d.name,d.id)));
    if (!rSel.options.length) { roles.forEach(r=>rSel.add(new Option(r.name,r.id))); rSel.value=5; }
    const hint = document.getElementById('regRoleHint');
    const onRole = () => {
      if (!hint) return;
      const isMgr = parseInt(rSel.value, 10) === 2;
      hint.style.display = isMgr ? 'block' : 'none';
      hint.textContent = isMgr ? '每部门仅允许一名部门主管；若该部门已有主管，注册将失败' : '';
    };
    rSel.onchange = onRole;
    onRole();
  } catch(e) { console.warn(e); }
}
function bindRegisterForm() {
  const form=document.getElementById('registerForm'); if(!form) return;
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const result=document.getElementById('regResult');
    result.textContent='注册中...'; result.className='reg-result';
    const body={name:document.getElementById('regName').value.trim(),gender:document.getElementById('regGender').value,
      department_id:parseInt(document.getElementById('regDept').value),
      role_id:parseInt(document.getElementById('regRole').value),phone:document.getElementById('regPhone').value.trim(),
      hire_date:document.getElementById('regHireDate').value};
    try {
      const data=await fetch(API+'/employees/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
      if(data.success){result.textContent=data.message;result.className='reg-result success';form.reset();allEmployees=[];loadStats();}
      else{result.textContent='注册失败：'+(data.error||'未知错误');result.className='reg-result error';}
    } catch(err){result.textContent='请求失败：'+err.message;result.className='reg-result error';}
  });
}

// ============ 修改密码 ============
function bindChangePwdForm() {
  const form=document.getElementById('changePwdForm'); if(!form) return;
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const result=document.getElementById('cpwdResult');
    const username=document.getElementById('cpwdUsername').value.trim();
    const old_password=document.getElementById('cpwdOld').value;
    const new_password=document.getElementById('cpwdNew').value;
    const confirm=document.getElementById('cpwdConfirm').value;
    if(new_password!==confirm){result.textContent='两次新密码不一致';result.className='reg-result error';return;}
    result.textContent='提交中...'; result.className='reg-result';
    try {
      const data=await fetch(API+'/account/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,old_password,new_password})}).then(r=>r.json());
      if(data.success){result.textContent=data.message;result.className='reg-result success';form.reset();setTimeout(()=>{sessionStorage.clear();window.location.href='login.html';},2500);}
      else{result.textContent=data.error||'修改失败';result.className='reg-result error';}
    } catch(err){result.textContent='请求失败：'+err.message;result.className='reg-result error';}
  });
}

// ============ 修改账号 ============
function bindChangeUserForm() {
  const form=document.getElementById('changeUserForm'); if(!form) return;
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const result=document.getElementById('cuserResult');
    const username=document.getElementById('cuserOld').value.trim();
    const password=document.getElementById('cuserPwd').value;
    const new_username=document.getElementById('cuserNew').value.trim();
    result.textContent='提交中...'; result.className='reg-result';
    try {
      const data=await fetch(API+'/account/change-username',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,new_username})}).then(r=>r.json());
      if(data.success){result.textContent=data.message;result.className='reg-result success';form.reset();setTimeout(()=>{sessionStorage.clear();window.location.href='login.html';},2500);}
      else{result.textContent=data.error||'修改失败';result.className='reg-result error';}
    } catch(err){result.textContent='请求失败：'+err.message;result.className='reg-result error';}
  });
}
