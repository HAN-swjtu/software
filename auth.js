// 登录逻辑 - 支持数据库员工账号 + 管理员账号
const API = 'http://localhost:3001/api';

const loginForm = document.getElementById('loginForm');
const errorMsg  = document.getElementById('errorMsg');

if (sessionStorage.getItem('loggedIn') === 'true') {
  window.location.href = 'index.html';
}

loginForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  if (!username) { showError('请输入账号'); return; }
  if (!password) { showError('请输入密码'); return; }

  const btn = loginForm.querySelector('.login-btn');
  btn.textContent = '验证中...';
  btn.disabled = true;

  // 管理员本地验证
  if (username === 'root' && password === '123456') {
    sessionStorage.setItem('empId', '');
    sessionStorage.setItem('departmentId', '');
    sessionStorage.setItem('roleId', '1');
    loginSuccess('系统管理员', '管理员', 'root', btn);
    return;
  }

  // 员工账号数据库验证
  try {
    const res = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('empId', data.emp_id || '');
      sessionStorage.setItem('departmentId', data.department_id || '');
      sessionStorage.setItem('roleId', data.role_id || '');
      loginSuccess(data.name + '(' + data.username + ')', data.role, data.username, btn);
    } else {
      btn.textContent = '登 录';
      btn.disabled = false;
      showError('账号或密码错误，请重试');
      shakeInputs();
    }
  } catch (err) {
    btn.textContent = '登 录';
    btn.disabled = false;
    showError('无法连接服务器，仅支持管理员账号登录');
    shakeInputs();
  }
});

function loginSuccess(displayName, role, username, btn) {
  sessionStorage.setItem('loggedIn', 'true');
  sessionStorage.setItem('currentUser', displayName);
  sessionStorage.setItem('currentRole', role);
  sessionStorage.setItem('currentUsername', username);
  btn.textContent = '登录成功 ✓';
  btn.style.background = '#2eb87a';
  btn.disabled = true;
  setTimeout(() => { window.location.href = 'index.html'; }, 600);
}

function shakeInputs() {
  document.querySelectorAll('.input-wrapper').forEach(el => {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.4s cubic-bezier(.36,.07,.19,.97)';
  });
}

function showError(msg) {
  errorMsg.textContent = msg;
  setTimeout(() => { errorMsg.textContent = ''; }, 3500);
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%      { transform: translateX(-8px); }
    40%      { transform: translateX(8px); }
    60%      { transform: translateX(-5px); }
    80%      { transform: translateX(5px); }
  }
`;
document.head.appendChild(shakeStyle);
