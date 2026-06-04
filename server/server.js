// 员工管理系统后端 API 服务
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const { pinyin } = require('pinyin-pro');
const { syncDepartmentManager, assertCanAssignDeptManager } = require('./employee-helpers');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 数据库连接池（强制 utf8mb4，避免中文写入变成 ?）
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'hanxu',
  password: '123456',
  database: 'ems',
  charset: 'utf8mb4_unicode_ci',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+08:00',
  dateStrings: true // DATE 字段返回 'YYYY-MM-DD'，避免请假同步差一天
});
pool.on('connection', (conn) => {
  conn.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
});

// 统一 JSON + UTF-8 响应
const send = (res, data) => {
  const json = JSON.stringify(data, null, 0);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(json);
};

// 生成姓名拼音账号（使用 pinyin-pro 完整库）
function toPinyinUsername(name) {
  // 转为不带声调的拼音，无空格连接
  const py = pinyin(name, { toneType: 'none', separator: '' });
  // 只保留小写字母和数字
  return py.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
}

// ============ 员工登录验证 ============
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return send(res, { success: false, error: '账号或密码不能为空' });
    const [rows] = await pool.query(
      `SELECT e.emp_id, e.username, e.name, e.password, e.department_id, r.name as role, r.id as role_id
       FROM employees e
       LEFT JOIN roles r ON e.role_id = r.id
       WHERE e.username = ? AND e.password = ? LIMIT 1`,
      [username, password]
    );
    if (rows.length > 0) {
      const u = rows[0];
      send(res, {
        success: true, emp_id: u.emp_id, username: u.username, name: u.name, role: u.role,
        role_id: u.role_id, department_id: u.department_id
      });
    } else {
      send(res, { success: false, error: '账号或密码错误' });
    }
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 统计数据 ============
app.get('/api/stats', async (req, res) => {
  try {
    const [[e]] = await pool.query('SELECT COUNT(*) as v FROM employees');
    const [[d]] = await pool.query('SELECT COUNT(*) as v FROM departments');
    const [[a]] = await pool.query("SELECT COUNT(*) as v FROM attendance WHERE check_date=CURDATE() AND status!='缺勤'");
    const [[n]] = await pool.query('SELECT COUNT(*) as v FROM employees WHERE MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())');
    const [[l]] = await pool.query("SELECT COUNT(*) as v FROM leave_records WHERE status='待审批'");
    const [[r]] = await pool.query('SELECT COUNT(*) as v FROM employees WHERE role_id=4');
    send(res, { employees: e.v, departments: d.v, attendance: a.v, newEmployees: n.v, pendingLeave: l.v, recruiters: r.v });
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 所有员工 ============
app.get('/api/employees', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.emp_id, e.name, e.gender, e.phone, e.emp_status,
             e.department_id, d.name as department, r.name as role, e.username,
             DATE_FORMAT(e.contract_start,'%Y-%m-%d') as hire_date,
             DATE_FORMAT(e.contract_start,'%Y-%m-%d') as created_at
      FROM employees e
      LEFT JOIN departments d ON e.department_id=d.id
      LEFT JOIN roles r ON e.role_id=r.id
      ORDER BY e.emp_id
    `);
    send(res, rows);
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 部门及员工 ============
app.get('/api/departments', async (req, res) => {
  try {
    const [depts] = await pool.query('SELECT * FROM departments ORDER BY id');
    const [emps] = await pool.query(`
      SELECT e.emp_id, e.name, e.gender, e.department_id, r.name as role
      FROM employees e LEFT JOIN roles r ON e.role_id=r.id
      ORDER BY e.department_id, e.role_id
    `);
    send(res, depts.map(d => ({ ...d, employees: emps.filter(e => e.department_id === d.id) })));
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 部门列表 ============
app.get('/api/departments/list', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM departments ORDER BY id');
    send(res, rows);
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 角色列表 ============
app.get('/api/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM roles ORDER BY id');
    send(res, rows);
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 新员工注册 ============
app.post('/api/employees/register', async (req, res) => {
  try {
    const { name, gender, department_id, role_id, phone, hire_date } = req.body;
    if (!name) return send(res, { success: false, error: '姓名不能为空' });
    if (!hire_date) return send(res, { success: false, error: '入职日期不能为空' });
    if (!role_id) return send(res, { success: false, error: '请选择角色' });
    const deptId = department_id || 1;
    if (parseInt(role_id) === 2) {
      const conflict = await assertCanAssignDeptManager(pool, deptId);
      if (conflict) {
        return send(res, {
          success: false,
          error: `该部门已有部门主管「${conflict.name}」（${conflict.emp_id}），每部门仅允许一名主管`
        });
      }
    }

    // 生成工号
    const [[maxRow]] = await pool.query('SELECT emp_id FROM employees ORDER BY id DESC LIMIT 1');
    let nextNum = maxRow ? parseInt(maxRow.emp_id.replace('E', '')) + 1 : 1;
    const emp_id = 'E' + String(nextNum).padStart(3, '0');

    // 用 pinyin-pro 生成拼音账号
    let base = toPinyinUsername(name);
    let username = base, suf = 1;
    while (true) {
      const [[ex]] = await pool.query('SELECT id FROM employees WHERE username=?', [username]);
      if (!ex) break;
      username = base + suf++;
    }

    await pool.query(
      `INSERT INTO employees (emp_id,name,gender,phone,department_id,role_id,username,password,
        contract_start,contract_end,emp_status,status_changed_at)
       VALUES (?,?,?,?,?,?,?,?,?,DATE_ADD(?,INTERVAL 3 YEAR),'在职',NOW())`,
      [emp_id, name, gender || '男', phone || '', deptId, role_id || 5, username, 'admin',
       hire_date, hire_date, hire_date]
    );
    if (parseInt(role_id) === 2) {
      await syncDepartmentManager(pool, deptId, emp_id);
    }
    await pool.query('UPDATE department_stats SET updated_at=NOW() WHERE department_id=?', [deptId]).catch(() => {});
    send(res, {
      success: true, emp_id, username, password: 'admin',
      message: `新员工「${name}」注册成功！工号：${emp_id}，账号：${username}，初始密码：admin`
    });
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 修改密码 ============
app.post('/api/account/change-password', async (req, res) => {
  try {
    const { username, old_password, new_password } = req.body;
    if (!username || !old_password || !new_password)
      return send(res, { success: false, error: '参数不完整' });
    if (new_password.length < 4)
      return send(res, { success: false, error: '新密码至少4位' });

    // 验证原密码
    const [[user]] = await pool.query(
      'SELECT id FROM employees WHERE username=? AND password=?',
      [username, old_password]
    );
    if (!user) return send(res, { success: false, error: '原密码错误，请重试' });

    await pool.query('UPDATE employees SET password=? WHERE username=?', [new_password, username]);
    send(res, { success: true, message: '密码修改成功，请重新登录' });
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

// ============ 修改账号 ============
app.post('/api/account/change-username', async (req, res) => {
  try {
    const { username, password, new_username } = req.body;
    if (!username || !password || !new_username)
      return send(res, { success: false, error: '参数不完整' });
    if (new_username.length < 3)
      return send(res, { success: false, error: '新账号至少3位' });
    if (!/^[a-zA-Z0-9_]+$/.test(new_username))
      return send(res, { success: false, error: '账号只能包含字母、数字和下划线' });

    // 验证原账号+密码
    const [[user]] = await pool.query(
      'SELECT id FROM employees WHERE username=? AND password=?',
      [username, password]
    );
    if (!user) return send(res, { success: false, error: '原账号或密码错误' });

    // 检查新账号是否已存在
    const [[exist]] = await pool.query('SELECT id FROM employees WHERE username=?', [new_username]);
    if (exist) return send(res, { success: false, error: '该账号已被占用，请换一个' });

    await pool.query('UPDATE employees SET username=? WHERE username=?', [new_username, username]);
    send(res, { success: true, message: `账号已修改为「${new_username}」，请重新登录` });
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});


// ============ 我的：个人信息 ============
app.get('/api/my-profile', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return send(res, { error: '缺少username参数' });
    const [[emp]] = await pool.query(`
      SELECT e.emp_id, e.name, e.gender, e.phone, e.email, e.address,
             e.emergency_contact, e.emergency_phone, e.birth_date, e.id_card,
             e.username, e.emp_status,
             DATE_FORMAT(e.contract_start,'%Y-%m-%d') as contract_start,
             DATE_FORMAT(e.contract_end,'%Y-%m-%d') as contract_end,
             DATE_FORMAT(e.probation_start,'%Y-%m-%d') as probation_start,
             DATE_FORMAT(e.probation_end,'%Y-%m-%d') as probation_end,
             d.name as department, r.name as role, e.department_id
      FROM employees e
      LEFT JOIN departments d ON e.department_id=d.id
      LEFT JOIN roles r ON e.role_id=r.id
      WHERE e.username=? LIMIT 1`, [username]);
    if (!emp) return send(res, { error: '用户不存在' });
    const [[mgr]] = await pool.query(`
      SELECT e.name, e.username, r.name AS role
      FROM employees e
      LEFT JOIN roles r ON e.role_id=r.id
      WHERE e.department_id=? AND e.role_id=2 LIMIT 1`, [emp.department_id]);
    const [attendance] = await pool.query(`
      SELECT check_date, status, check_in, check_out
      FROM attendance WHERE emp_id=?
      ORDER BY check_date DESC LIMIT 20`, [emp.emp_id]);
    const [leaves] = await pool.query(`
      SELECT leave_type, start_date, end_date, days, reason, status
      FROM leave_records WHERE emp_id=?
      ORDER BY created_at DESC LIMIT 20`, [emp.emp_id]);
    send(res, { ...emp, manager: mgr || null, attendance, leaves });
  } catch(e) { res.status(500); send(res, { error: e.message }); }
});

const PORT = 3001;
require('./employee-apis')(app, pool, send);
require('./attendance-apis')(app, pool, send);
require('./salary-apis')(app, pool, send);
require('./leave-apis')(app, pool, send);
require('./resign-apis')(app, pool, send);
require('./training-apis')(app, pool, send);
require('./recruit-apis')(app, pool, send);
app.listen(PORT, () => console.log(`EMS API 运行中: http://localhost:${PORT}`));
