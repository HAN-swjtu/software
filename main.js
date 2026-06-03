// 鉴权检查：未登录则跳回登录页
if (sessionStorage.getItem('loggedIn') !== 'true') {
  window.location.href = 'login.html';
}

// 当前用户信息
const currentUser = sessionStorage.getItem('currentUser') || 'root';
const currentRole = sessionStorage.getItem('currentRole') || '管理员';
const currentUsername = sessionStorage.getItem('currentUsername') || '';

const currentUserEl = document.getElementById('currentUser');
const settingsUserEl = document.getElementById('settingsUser');

if (currentUserEl) currentUserEl.textContent = '\uD83D\uDC64 ' + currentUser + '\uFF08' + currentRole + '\uFF09';
if (settingsUserEl) settingsUserEl.textContent = currentUsername || currentUser;

// 退出登录
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', function () {
    sessionStorage.clear();
    window.location.href = 'login.html';
  });
}

// ============ 权限配置 ============
const PANEL_NAMES = {
  dashboard: '控制台', employees: '员工列表', departments: '部门管理',
  attendance: '考勤管理', salary: '薪资管理', leave: '假期管理',
  resign: '离职管理', training: '培训管理', recruit: '招聘管理',
  mine: '我的', settings: '系统设置'
};
const ROLE_PERMISSIONS = {
  '普通员工': ['mine', 'employees', 'attendance', 'salary', 'leave', 'resign', 'training'],
  '部门主管': ['dashboard', 'employees', 'departments', 'attendance', 'salary', 'leave', 'resign', 'training', 'recruit', 'mine'],
  'HR专员': ['dashboard', 'employees', 'departments', 'attendance', 'salary', 'leave', 'resign', 'training', 'recruit', 'mine', 'settings'],
  '招聘专员': ['dashboard', 'employees', 'attendance', 'salary', 'leave', 'recruit', 'mine', 'settings'],
};
function canAccess(panel) {
  const allowed = ROLE_PERMISSIONS[currentRole];
  if (!allowed) return true; // 管理员等无限制
  return allowed.includes(panel);
}
function allowedPanelLabels() {
  const allowed = ROLE_PERMISSIONS[currentRole];
  if (!allowed) return '全部功能模块';
  return allowed.map(p => '「' + (PANEL_NAMES[p] || p) + '」').join('、');
}

// ============ 侧边栏导航切换 ============
const navItems = document.querySelectorAll('.nav-item');
const panels   = document.querySelectorAll('.panel');

// 无权限提示弹窗（复用 modal 机制）
function showNoPermModal() {
  let el = document.getElementById('modalNoPerm');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modalNoPerm';
    el.className = 'modal-overlay';
    el.innerHTML = `
      <div class="modal-box" style="max-width:400px;text-align:center">
        <div class="modal-header"><span class="modal-title" style="color:#e05252">⚠️ 无权限访问</span><button class="modal-close" onclick="document.getElementById('modalNoPerm').classList.remove('active')">×</button></div>
        <div class="modal-body" style="padding:24px 20px">
          <div style="font-size:48px;margin-bottom:12px">🔒</div>
          <p id="modalNoPermText" style="font-size:15px;color:#555;line-height:1.7"></p>
          <button class="settings-btn" style="margin-top:8px" onclick="document.getElementById('modalNoPerm').classList.remove('active')">知道了</button>
        </div>
      </div>`;
    el.addEventListener('click', function(e) { if (e.target === el) el.classList.remove('active'); });
    document.body.appendChild(el);
  }
  const text = document.getElementById('modalNoPermText');
  if (text) {
    text.innerHTML = '您的角色为<strong style="color:var(--primary)">' + currentRole + '</strong><br>当前账号可访问：' + allowedPanelLabels();
  }
  el.classList.add('active');
}

navItems.forEach(function (item) {
  item.addEventListener('click', function () {
    const panel = item.getAttribute('data-panel');

    // 权限检查
    if (!canAccess(panel)) {
      showNoPermModal();
      return;
    }

    // 激活菜单项
    navItems.forEach(function (n) { n.classList.remove('active'); });
    item.classList.add('active');

    // 显示对应面板
    const panelId = 'panel-' + panel;
    panels.forEach(function (p) { p.classList.remove('active'); });
    const target = document.getElementById(panelId);
    if (target) target.classList.add('active');

    // 进入「我的」面板时加载数据
    if (panel === 'mine') {
      if (typeof loadMyProfile === 'function') loadMyProfile();
    }
    if (typeof onEmployeePanelShow === 'function') onEmployeePanelShow(panel);
  });
});

// 普通员工登录后默认显示「我的」面板
if (currentRole === '普通员工') {
  const mineNav = document.querySelector('.nav-item[data-panel="mine"]');
  const dashNav = document.querySelector('.nav-item[data-panel="dashboard"]');
  if (mineNav && dashNav) {
    dashNav.classList.remove('active');
    mineNav.classList.add('active');
    panels.forEach(function(p) { p.classList.remove('active'); });
    const minePanel = document.getElementById('panel-mine');
    if (minePanel) minePanel.classList.add('active');
  }
}
