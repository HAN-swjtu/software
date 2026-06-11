// 员工管理模块 API - P1~P4 / D1~D4
const { syncDepartmentManager, assertCanAssignDeptManager } = require('./employee-helpers');

module.exports = function (app, pool, send) {

  async function getEmployee(username) {
    if (!username) return null;
    const [[row]] = await pool.query(`
      SELECT e.*, d.name AS department, r.name AS role, r.id AS role_id
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN roles r ON e.role_id = r.id
      WHERE e.username = ? LIMIT 1`, [username]);
    return row || null;
  }

  async function logOp(operator, empId, action, detail) {
    await pool.query(
      'INSERT INTO operation_logs (operator, emp_id, action, detail) VALUES (?,?,?,?)',
      [operator, empId || '', action, detail || '']
    );
  }

  async function refreshDeptStats() {
    const [depts] = await pool.query('SELECT id, name FROM departments');
    for (const d of depts) {
      const [[a]] = await pool.query(
        "SELECT COUNT(*) AS v FROM employees WHERE department_id=? AND emp_status='在职'", [d.id]);
      const [[p]] = await pool.query(
        "SELECT COUNT(*) AS v FROM employees WHERE department_id=? AND emp_status='试用期'", [d.id]);
      const [[r]] = await pool.query(
        "SELECT COUNT(*) AS v FROM resigned_archives WHERE department=?", [d.name]);
      await pool.query(`
        INSERT INTO department_stats (department_id, department_name, active_count, probation_count, resigned_count, stat_time)
        VALUES (?,?,?,?,?,NOW())
        ON DUPLICATE KEY UPDATE active_count=VALUES(active_count), probation_count=VALUES(probation_count),
          resigned_count=VALUES(resigned_count), stat_time=NOW()`, [d.id, d.name, a.v, p.v, r.v]);
    }
  }

  function empDetailRow(e) {
    return {
      emp_id: e.emp_id, name: e.name, gender: e.gender,
      birth_date: e.birth_date, id_card: e.id_card, phone: e.phone,
      email: e.email, address: e.address,
      emergency_contact: e.emergency_contact, emergency_phone: e.emergency_phone,
      department_id: e.department_id, role_id: e.role_id,
      department: e.department, role: e.role,
      emp_status: e.emp_status,
      hire_date: e.contract_start || e.created_at,
      contract_start: e.contract_start, contract_end: e.contract_end,
      probation_start: e.probation_start, probation_end: e.probation_end,
      username: e.username
    };
  }

  // ========== P1 个人信息管理 ==========
  app.get('/api/profile/detail', async (req, res) => {
    try {
      const { username, query_type } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '员工不存在' });
      await logOp(username, emp.emp_id, '个人信息查询', `查询类型:${query_type || 'full'}`);
      send(res, { success: true, data: empDetailRow(emp), query_time: new Date() });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/profile/update', async (req, res) => {
    try {
      const { username, name, phone, email, address, emergency_contact, emergency_phone } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '员工不存在' });
      await pool.query(`
        UPDATE employees SET name=?, phone=?, email=?, address=?, emergency_contact=?, emergency_phone=?
        WHERE username=?`,
        [name || emp.name, phone ?? emp.phone, email ?? emp.email,
         address ?? emp.address, emergency_contact ?? emp.emergency_contact,
         emergency_phone ?? emp.emergency_phone, username]);
      await logOp(username, emp.emp_id, '个人信息修改', `修改联系电话/地址等`);
      send(res, { success: true, message: '个人信息已更新', update_time: new Date() });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P2 转正审批管理 ==========
  app.post('/api/probation/apply', async (req, res) => {
    try {
      const { username, work_summary, self_evaluation } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '员工不存在' });
      if (emp.emp_status !== '试用期')
        return send(res, { success: false, error: '仅试用期员工可提交转正申请' });
      const [[pending]] = await pool.query(
        "SELECT apply_id FROM probation_applications WHERE emp_id=? AND approve_status='待审批'", [emp.emp_id]);
      if (pending) return send(res, { success: false, error: '已有待审批的转正申请' });
      const [[maxRow]] = await pool.query('SELECT apply_id FROM probation_applications ORDER BY id DESC LIMIT 1');
      let num = maxRow ? parseInt(maxRow.apply_id.replace('PA', '')) + 1 : 1;
      const apply_id = 'PA' + String(num).padStart(4, '0');
      await pool.query(`
        INSERT INTO probation_applications
        (apply_id, emp_id, name, department, role_name, probation_start, probation_end, work_summary, self_evaluation)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [apply_id, emp.emp_id, emp.name, emp.department, emp.role || '',
         emp.probation_start, emp.probation_end, work_summary || '', self_evaluation || '']);
      await logOp(username, emp.emp_id, '转正申请', apply_id);
      send(res, { success: true, apply_id, message: '转正申请已提交，等待部门主管审批' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/probation/list', async (req, res) => {
    try {
      const { username, scope } = req.query;
      const emp = await getEmployee(username);
      if (!emp && username !== 'root') return send(res, { success: false, error: '用户不存在' });
      let rows;
      if (scope === 'pending' && (emp?.role_id === 2 || username === 'root' || emp?.role_id === 1)) {
        [rows] = await pool.query(`
          SELECT pa.* FROM probation_applications pa
          JOIN employees e ON pa.emp_id = e.emp_id
          WHERE pa.approve_status='待审批' AND e.department_id=?
          ORDER BY pa.apply_time DESC`, [emp?.department_id || 0]);
        if (username === 'root' || emp?.role_id === 1) {
          [rows] = await pool.query(
            "SELECT * FROM probation_applications WHERE approve_status='待审批' ORDER BY apply_time DESC");
        }
      } else if (scope === 'mine') {
        [rows] = await pool.query(
          'SELECT * FROM probation_applications WHERE emp_id=? ORDER BY apply_time DESC', [emp.emp_id]);
      } else {
        [rows] = await pool.query('SELECT * FROM probation_applications ORDER BY apply_time DESC LIMIT 50');
      }
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/probation/approve', async (req, res) => {
    try {
      const { username, apply_id, approve_status, approve_comment, approve_score } = req.body;
      const approver = await getEmployee(username);
      if (!approver || ![1, 2, 3].includes(approver.role_id) && username !== 'root')
        return send(res, { success: false, error: '无审批权限' });
      const [[app_row]] = await pool.query('SELECT * FROM probation_applications WHERE apply_id=?', [apply_id]);
      if (!app_row) return send(res, { success: false, error: '申请不存在' });
      if (app_row.approve_status !== '待审批') return send(res, { success: false, error: '该申请已处理' });
      const effective = approve_status === '通过' ? new Date() : null;
      await pool.query(`
        UPDATE probation_applications SET approver_id=?, approve_status=?, approve_comment=?,
          approve_score=?, approve_time=NOW(), effective_date=?, notify_time=NOW()
        WHERE apply_id=?`,
        [approver?.emp_id || 'ADMIN', approve_status, approve_comment || '',
         approve_score || null, effective, apply_id]);
      if (approve_status === '通过') {
        await pool.query(
          "UPDATE employees SET emp_status='在职', status_changed_at=NOW() WHERE emp_id=?", [app_row.emp_id]);
        await refreshDeptStats();
      }
      await logOp(username, app_row.emp_id, '转正审批', `${approve_status}:${apply_id}`);
      send(res, {
        success: true, message: '审批完成',
        notification: {
          apply_id, name: app_row.name, approve_status,
          approve_comment: approve_comment || '', effective_date: effective, notify_time: new Date()
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/probation/notifications', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '员工不存在' });
      const [rows] = await pool.query(`
        SELECT apply_id, name, approve_status, approve_comment, effective_date, notify_time
        FROM probation_applications WHERE emp_id=? AND approve_status IN ('通过','驳回')
        ORDER BY notify_time DESC LIMIT 10`, [emp.emp_id]);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P3 员工状态管理 ==========
  app.get('/api/dept-employees/status', async (req, res) => {
    try {
      const { username, department_id, keyword } = req.query;
      const emp = await getEmployee(username);
      const isAdmin = username === 'root' || emp?.role_id === 1;
      const isHR = emp?.role_id === 3;
      const isMgr = emp?.role_id === 2;
      if (!isAdmin && !isHR && !isMgr)
        return send(res, { success: false, error: '无查询权限' });
      let deptId = department_id ? parseInt(department_id) : emp?.department_id;
      if (isMgr && !isAdmin && !isHR) deptId = emp.department_id;
      let sql = `
        SELECT e.emp_id, e.name, d.name AS department, r.name AS role, e.emp_status,
               DATE_FORMAT(e.contract_start,'%Y-%m-%d') AS hire_date,
               DATE_FORMAT(e.contract_end,'%Y-%m-%d') AS contract_end
        FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE e.department_id=?`;
      const params = [deptId];
      if (keyword) { sql += ' AND (e.name LIKE ? OR e.emp_id LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
      sql += ' ORDER BY e.emp_id';
      const [rows] = await pool.query(sql, params);
      await logOp(username, emp?.emp_id || '', '部门员工查询', `部门ID:${deptId}`);
      send(res, { success: true, data: rows, query_time: new Date() });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  async function canAccessEmployeeDetail(operator, target) {
    if (operator === 'root') return { ok: true, can_edit: true, operator: null };
    const op = await getEmployee(operator);
    if (!op) return { ok: false, error: '操作人不存在' };
    const isAdminOrHR = [1, 3].includes(op.role_id);
    const isDeptManager = op.role_id === 2 && op.department_id === target.department_id;
    if (!isAdminOrHR && !isDeptManager && op.emp_id !== target.emp_id) {
      return { ok: false, error: '无权查看该员工信息' };
    }
    return { ok: true, can_edit: isAdminOrHR || isDeptManager, operator: op, admin: isAdminOrHR, manager: isDeptManager };
  }

  app.get('/api/employees/:emp_id/detail', async (req, res) => {
    try {
      const { operator } = req.query;
      const { emp_id } = req.params;
      const [[target]] = await pool.query(`
        SELECT e.*, d.name AS department, r.name AS role
        FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE e.emp_id=? LIMIT 1`, [emp_id]);
      if (!target) return send(res, { success: false, error: '员工不存在' });
      const auth = await canAccessEmployeeDetail(operator, target);
      if (!auth.ok) return send(res, { success: false, error: auth.error });
      await logOp(operator || '', emp_id, '员工基本信息查看', target.name);
      send(res, { success: true, data: empDetailRow(target), can_edit: auth.can_edit, edit_scope: auth.admin ? 'full' : (auth.manager ? 'contact' : 'self') });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/employees/:emp_id/basic', async (req, res) => {
    try {
      const { operator, name, gender, phone, email, address, emergency_contact, emergency_phone, department_id, role_id, emp_status } = req.body;
      const { emp_id } = req.params;
      const [[target]] = await pool.query('SELECT * FROM employees WHERE emp_id=? LIMIT 1', [emp_id]);
      if (!target) return send(res, { success: false, error: '员工不存在' });
      const auth = await canAccessEmployeeDetail(operator, target);
      if (!auth.ok || !auth.can_edit) return send(res, { success: false, error: '无权编辑该员工信息' });

      const updates = {
        name: name || target.name,
        gender: gender || target.gender,
        phone: phone ?? target.phone,
        email: email ?? target.email,
        address: address ?? target.address,
        emergency_contact: emergency_contact ?? target.emergency_contact,
        emergency_phone: emergency_phone ?? target.emergency_phone,
        department_id: target.department_id,
        role_id: target.role_id,
        emp_status: target.emp_status
      };

      if (auth.admin) {
        if (department_id) updates.department_id = parseInt(department_id, 10);
        if (role_id) updates.role_id = parseInt(role_id, 10);
        if (emp_status) updates.emp_status = emp_status;
      }

      await pool.query(`
        UPDATE employees
        SET name=?, gender=?, phone=?, email=?, address=?, emergency_contact=?, emergency_phone=?,
            department_id=?, role_id=?, emp_status=?, status_changed_at=IF(?<>?, NOW(), status_changed_at)
        WHERE emp_id=?`,
        [updates.name, updates.gender, updates.phone, updates.email, updates.address,
         updates.emergency_contact, updates.emergency_phone, updates.department_id, updates.role_id,
         updates.emp_status, target.emp_status, updates.emp_status, emp_id]);

      await refreshDeptStats();
      await logOp(operator || '', emp_id, '员工基本信息编辑', target.name);
      send(res, { success: true, message: '员工基本信息已保存' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/employee/status-change', async (req, res) => {
    try {
      const { operator, emp_id, new_status, reason } = req.body;
      const op = await getEmployee(operator);
      if (!op && operator !== 'root') return send(res, { success: false, error: '操作人不存在' });
      if (![1, 3].includes(op?.role_id) && operator !== 'root')
        return send(res, { success: false, error: '仅HR专员或管理员可变更员工状态' });
      const [[target]] = await pool.query(`
        SELECT e.*, d.name AS department, r.name AS role_name FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE e.emp_id=?`, [emp_id]);
      if (!target) return send(res, { success: false, error: '员工不存在' });
      const oldStatus = target.emp_status;
      await pool.query(
        'UPDATE employees SET emp_status=?, status_changed_at=NOW() WHERE emp_id=?', [new_status, emp_id]);
      if (new_status === '已离职') {
        const [[maxA]] = await pool.query('SELECT archive_id FROM resigned_archives ORDER BY id DESC LIMIT 1');
        let n = maxA ? parseInt(maxA.archive_id.replace('AR', '')) + 1 : 1;
        const archive_id = 'AR' + String(n).padStart(4, '0');
        await pool.query(`
          INSERT INTO resigned_archives
          (archive_id, emp_id, name, department, role_name, hire_date, resign_date, resign_reason, work_history, performance_record, handover_status)
          VALUES (?,?,?,?,?,?,CURDATE(),?,?,?,?)`,
          [archive_id, target.emp_id, target.name, target.department, target.role_name || '',
           target.contract_start, reason || '主动离职',
           `部门:${target.department}, 角色:${target.role_name || ''}`,
           '绩效记录已归档', '交接完成']);
      }
      await refreshDeptStats();
      await logOp(operator, emp_id, '员工状态变更', `${oldStatus}→${new_status}:${reason || ''}`);
      send(res, { success: true, message: `状态已从「${oldStatus}」变更为「${new_status}」` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // 离职归档查询见 resign-apis.js

  app.get('/api/department-stats', async (req, res) => {
    try {
      await refreshDeptStats();
      const [rows] = await pool.query('SELECT * FROM department_stats ORDER BY department_id');
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  async function canManageDept(username) {
    if (username === 'root') return true;
    const emp = await getEmployee(username);
    return emp && [1, 3].includes(emp.role_id);
  }

  // ========== 部门基础管理（CRUD + 负责人） ==========
  app.get('/api/departments/manage', async (req, res) => {
    try {
      await refreshDeptStats();
      const [rows] = await pool.query(`
        SELECT d.id, d.name, d.manager_emp_id, m.name AS manager_name,
               ds.active_count, ds.probation_count, ds.resigned_count, ds.stat_time,
               (SELECT COUNT(*) FROM employees e WHERE e.department_id=d.id) AS total_employees
        FROM departments d
        LEFT JOIN employees m ON d.manager_emp_id = m.emp_id
        LEFT JOIN department_stats ds ON ds.department_id = d.id
        ORDER BY d.id`);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/departments', async (req, res) => {
    try {
      const { operator, name, manager_emp_id } = req.body;
      if (!await canManageDept(operator)) return send(res, { success: false, error: '无权限操作' });
      if (!name || !name.trim()) return send(res, { success: false, error: '部门名称不能为空' });
      const [[ex]] = await pool.query('SELECT id FROM departments WHERE name=?', [name.trim()]);
      if (ex) return send(res, { success: false, error: '部门名称已存在' });
      const [r] = await pool.query('INSERT INTO departments (name, manager_emp_id) VALUES (?,?)',
        [name.trim(), null]);
      const newId = r.insertId;
      if (manager_emp_id) await syncDepartmentManager(pool, newId, manager_emp_id);
      await refreshDeptStats();
      await logOp(operator, '', '新增部门', name);
      send(res, { success: true, id: newId, message: '部门创建成功' });
    } catch (e) { send(res, { success: false, error: e.message }); }
  });

  app.put('/api/departments/:id', async (req, res) => {
    try {
      const { operator, name, manager_emp_id } = req.body;
      const id = parseInt(req.params.id);
      if (!await canManageDept(operator)) return send(res, { success: false, error: '无权限操作' });
      if (!name || !name.trim()) return send(res, { success: false, error: '部门名称不能为空' });
      await pool.query('UPDATE departments SET name=? WHERE id=?', [name.trim(), id]);
      await syncDepartmentManager(pool, id, manager_emp_id || null);
      await refreshDeptStats();
      await logOp(operator, '', '编辑部门', `ID:${id}`);
      send(res, { success: true, message: '部门已更新' });
    } catch (e) { send(res, { success: false, error: e.message }); }
  });

  app.delete('/api/departments/:id', async (req, res) => {
    try {
      const { operator } = req.query;
      const id = parseInt(req.params.id);
      if (!await canManageDept(operator)) return send(res, { success: false, error: '无权限操作' });
      const [[cnt]] = await pool.query('SELECT COUNT(*) AS v FROM employees WHERE department_id=?', [id]);
      if (cnt.v > 0) return send(res, { success: false, error: `该部门下仍有 ${cnt.v} 名员工，无法删除` });
      await pool.query('DELETE FROM department_stats WHERE department_id=?', [id]);
      await pool.query('DELETE FROM departments WHERE id=?', [id]);
      await logOp(operator || '', '', '删除部门', `ID:${id}`);
      send(res, { success: true, message: '部门已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/departments/export-stats', async (req, res) => {
    try {
      await refreshDeptStats();
      const [rows] = await pool.query('SELECT * FROM department_stats ORDER BY department_id');
      const BOM = '\uFEFF';
      const header = '部门编号,部门名称,在职人数,试用期人数,离职人数,统计时间\n';
      const csv = BOM + header + rows.map(r =>
        [`D${String(r.department_id).padStart(3, '0')}`, r.department_name, r.active_count, r.probation_count, r.resigned_count,
         r.stat_time ? new Date(r.stat_time).toLocaleString() : '']
          .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=department_stats.csv');
      res.end(csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/dept-employees/export', async (req, res) => {
    try {
      const { username, department_id, keyword } = req.query;
      const emp = await getEmployee(username);
      let deptId = department_id ? parseInt(department_id) : emp?.department_id;
      if (username === 'root' || emp?.role_id === 1 || emp?.role_id === 3) {
        if (department_id) deptId = parseInt(department_id);
      } else if (emp?.role_id === 2) {
        deptId = emp.department_id;
      } else {
        return res.status(403).end('无权限');
      }
      let sql = `
        SELECT e.emp_id, e.name, d.name AS department, r.name AS role, e.emp_status,
               DATE_FORMAT(e.contract_start,'%Y-%m-%d') AS hire_date,
               DATE_FORMAT(e.contract_end,'%Y-%m-%d') AS contract_end, e.phone
        FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE e.department_id=?`;
      const params = [deptId];
      if (keyword) { sql += ' AND (e.name LIKE ? OR e.emp_id LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
      sql += ' ORDER BY e.emp_id';
      const [rows] = await pool.query(sql, params);
      const BOM = '\uFEFF';
      const header = '工号,姓名,部门,角色,状态,入职日期,合同到期,电话\n';
      const csv = BOM + header + rows.map(r =>
        [r.emp_id, r.name, r.department, r.role, r.emp_status, r.hire_date, r.contract_end, r.phone]
          .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      const [[dept]] = await pool.query('SELECT name FROM departments WHERE id=?', [deptId]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=dept_${deptId}_employees.csv`);
      res.end(csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P4 信息筛选与导出 ==========
  app.post('/api/employees/filter', async (req, res) => {
    try {
      const { operator, department_id, role_id, emp_status, hire_from, hire_to, sort_by, sort_order } = req.body;
      let sql = `
        SELECT e.emp_id, e.name, d.name AS department, r.name AS role, e.emp_status,
               DATE_FORMAT(e.contract_start,'%Y-%m-%d') AS hire_date, e.phone, e.email, e.gender
        FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE 1=1`;
      const params = [];
      if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      if (role_id) { sql += ' AND e.role_id=?'; params.push(role_id); }
      if (emp_status) { sql += ' AND e.emp_status=?'; params.push(emp_status); }
      if (hire_from) { sql += ' AND e.contract_start>=?'; params.push(hire_from); }
      if (hire_to) { sql += ' AND e.contract_start<=?'; params.push(hire_to); }
      const sortCol = { hire_date: 'e.contract_start', name: 'e.name', department: 'd.name' }[sort_by] || 'e.emp_id';
      const order = sort_order === 'desc' ? 'DESC' : 'ASC';
      sql += ` ORDER BY ${sortCol} ${order}`;
      const [rows] = await pool.query(sql, params);
      const report_id = 'RP' + Date.now();
      await logOp(operator || '', '', '信息筛选', JSON.stringify(req.body));
      send(res, {
        success: true,
        report: {
          report_id, filter: req.body, total: rows.length,
          employees: rows, generated_at: new Date()
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/employees/export', async (req, res) => {
    try {
      const { operator, format, department_id, role_id, emp_status, hire_from, hire_to } = req.body;
      let sql = `
        SELECT e.emp_id, e.name, d.name AS department, r.name AS role, e.emp_status,
               DATE_FORMAT(e.contract_start,'%Y-%m-%d') AS hire_date, e.phone, e.email
        FROM employees e
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN roles r ON e.role_id=r.id
        WHERE 1=1`;
      const params = [];
      if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      if (role_id) { sql += ' AND e.role_id=?'; params.push(role_id); }
      if (emp_status) { sql += ' AND e.emp_status=?'; params.push(emp_status); }
      if (hire_from) { sql += ' AND e.contract_start>=?'; params.push(hire_from); }
      if (hire_to) { sql += ' AND e.contract_start<=?'; params.push(hire_to); }
      sql += ' ORDER BY e.emp_id';
      const [rows] = await pool.query(sql, params);

      await pool.query(
        'INSERT INTO export_logs (operator, filter_conditions, export_format, record_count) VALUES (?,?,?,?)',
        [operator || '', JSON.stringify(req.body), format || 'Excel', rows.length]);

      if (format === 'PDF') {
        const text = rows.map(r => `${r.emp_id}\t${r.name}\t${r.department}\t${r.role}\t${r.emp_status}\t${r.hire_date}\t${r.phone || ''}\t${r.email || ''}`).join('\n');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=employees.txt');
        return res.end('员工信息导出(PDF简化版)\n' + text);
      }
      const BOM = '\uFEFF';
      const header = '工号,姓名,部门,角色,状态,入职日期,电话,邮箱\n';
      const csv = BOM + header + rows.map(r => {
        const hire = r.hire_date ? String(r.hire_date).slice(0, 10) : '';
        return [r.emp_id, r.name, r.department, r.role, r.emp_status, hire, r.phone, r.email]
          .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',');
      }).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=employees.csv');
      res.end(csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 删除员工（HR/管理员） ==========
  app.delete('/api/employees/:emp_id', async (req, res) => {
    try {
      const { operator } = req.query;
      const emp_id = req.params.emp_id;
      if (!await canManageDept(operator)) {
        return send(res, { success: false, error: '仅 HR 专员或管理员可删除员工' });
      }
      if (!emp_id) return send(res, { success: false, error: '工号无效' });
      if (emp_id === 'E001') return send(res, { success: false, error: '系统管理员账号不可删除' });

      const [[target]] = await pool.query(
        'SELECT emp_id, name, department_id, role_id FROM employees WHERE emp_id=? LIMIT 1',
        [emp_id]
      );
      if (!target) return send(res, { success: false, error: '员工不存在' });

      await pool.query('DELETE FROM attendance WHERE emp_id=?', [emp_id]);
      await pool.query('DELETE FROM leave_records WHERE emp_id=?', [emp_id]);
      await pool.query('DELETE FROM probation_applications WHERE emp_id=?', [emp_id]);
      await pool.query('DELETE FROM resigned_archives WHERE emp_id=?', [emp_id]);
      await pool.query('DELETE FROM salary_records WHERE emp_id=?', [emp_id]);
      await pool.query('DELETE FROM employee_salary WHERE emp_id=?', [emp_id]);
      await pool.query('UPDATE departments SET manager_emp_id=NULL WHERE manager_emp_id=?', [emp_id]);
      await pool.query('DELETE FROM employees WHERE emp_id=?', [emp_id]);

      await refreshDeptStats();
      await logOp(operator, emp_id, '删除员工', target.name);
      send(res, { success: true, message: `员工「${target.name}」已永久删除` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // 启动时刷新部门统计
  refreshDeptStats().catch(() => {});
};
