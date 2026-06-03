// 离职管理模块 API - P1~P4（文档 3.3.8）
const fs = require('fs');
const path = require('path');
const { syncDepartmentManager } = require('./employee-helpers');
const { mysqlToday, fmtLocalDate } = require('./attendance-helpers');

module.exports = function (app, pool, send) {

  async function ensureResignSchema() {
    try {
      const [[t]] = await pool.query(
        "SELECT COUNT(*) AS v FROM information_schema.TABLES WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='resign_applications'");
      if (!t.v) {
        const sql = fs.readFileSync(path.join(__dirname, 'resign-migrate.sql'), 'utf8');
        for (const stmt of sql.split(';')) {
          const s = stmt.trim();
          if (s && !s.startsWith('--') && (s.toUpperCase().startsWith('CREATE') || s.toUpperCase().startsWith('ALTER'))) {
            try { await pool.query(s); } catch (e) { /* 列已存在 */ }
          }
        }
      }
      await pool.query(
        'ALTER TABLE resign_applications CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      ).catch(() => {});
    } catch (e) { console.warn('离职表迁移:', e.message); }
  }

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
        `SELECT COUNT(*) AS v FROM resigned_archives ra
         WHERE ra.emp_id IN (SELECT emp_id FROM employees WHERE department_id=?)`, [d.id]);
      await pool.query(`
        INSERT INTO department_stats (department_id, department_name, active_count, probation_count, resigned_count, stat_time)
        VALUES (?,?,?,?,?,NOW())
        ON DUPLICATE KEY UPDATE active_count=VALUES(active_count), probation_count=VALUES(probation_count),
          resigned_count=VALUES(resigned_count), stat_time=NOW()`, [d.id, d.name, a.v, p.v, r.v]);
    }
  }

  function isHR(emp, username) {
    return username === 'root' || emp?.role_id === 1 || emp?.role_id === 3;
  }

  function isManager(emp) {
    return emp?.role_id === 2;
  }

  function canApproveMgr(emp, username) {
    return isManager(emp) || isHR(emp, username);
  }

  function canApproveHR(emp, username) {
    return isHR(emp, username);
  }

  /** 按部门过滤，避免 department 与 departments.name 排序规则不一致 */
  function sqlDeptByEmpId(alias) {
    const p = alias ? `${alias}.` : '';
    return `${p}emp_id IN (SELECT emp_id FROM employees WHERE department_id=?)`;
  }

  function fmtDate(val) {
    return fmtLocalDate(val);
  }

  function calcWorkYears(hireDate, resignDate) {
    if (!hireDate || !resignDate) return 0;
    const h = new Date(fmtDate(hireDate));
    const r = new Date(fmtDate(resignDate));
    const days = (r - h) / 86400000;
    return Math.max(0, Math.round(days / 365 * 10) / 10);
  }

  function appRow(r) {
    return {
      id: r.id,
      apply_id: r.apply_id,
      emp_id: r.emp_id,
      name: r.name,
      department: r.department || '',
      role_name: r.role_name || '',
      hire_date: fmtDate(r.hire_date),
      expected_resign_date: fmtDate(r.expected_resign_date),
      resign_reason: r.resign_reason || '',
      handover_plan: r.handover_plan || '',
      status: r.status,
      mgr_approver_id: r.mgr_approver_id || '',
      mgr_comment: r.mgr_comment || '',
      mgr_time: r.mgr_time,
      hr_approver_id: r.hr_approver_id || '',
      hr_comment: r.hr_comment || '',
      hr_time: r.hr_time,
      created_at: r.created_at
    };
  }

  function archiveRow(r) {
    return {
      id: r.id,
      archive_id: r.archive_id,
      apply_id: r.apply_id || '',
      emp_id: r.emp_id,
      name: r.name,
      department: r.department || '',
      role_name: r.role_name || '',
      hire_date: fmtDate(r.hire_date),
      resign_date: fmtDate(r.resign_date),
      work_years: r.work_years != null ? Number(r.work_years) : 0,
      resign_reason: r.resign_reason || '',
      work_history: r.work_history || '',
      performance_record: r.performance_record || '',
      handover_status: r.handover_status || '',
      archive_status: r.archive_status || '已归档',
      archived_at: r.archived_at
    };
  }

  async function finalizeResign(pool, row, operator) {
    const resignDate = fmtDate(row.expected_resign_date);
    const [[target]] = await pool.query(`
      SELECT e.*, d.name AS department, d.id AS department_id, r.name AS role_name
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN roles r ON e.role_id = r.id
      WHERE e.emp_id=?`, [row.emp_id]);
    if (!target) throw new Error('员工不存在');

    await pool.query(
      "UPDATE employees SET emp_status='已离职', status_changed_at=NOW() WHERE emp_id=?",
      [row.emp_id]);

    if (target.role_id === 2 && target.department_id) {
      await syncDepartmentManager(pool, target.department_id, null);
    }

    const workYears = calcWorkYears(target.contract_start || row.hire_date, resignDate);
    const workHistory = `部门:${row.department || target.department}, 角色:${row.role_name || target.role_name}, 工龄约${workYears}年`;
    const perf = '离职审批通过，绩效记录已归档';
    const handover = row.handover_plan || '交接完成';

    const [[maxA]] = await pool.query('SELECT archive_id FROM resigned_archives ORDER BY id DESC LIMIT 1');
    let num = maxA?.archive_id ? parseInt(String(maxA.archive_id).replace(/\D/g, ''), 10) + 1 : 1;
    const archive_id = 'AR' + String(num).padStart(4, '0');

    const [[ex]] = await pool.query('SELECT id FROM resigned_archives WHERE emp_id=?', [row.emp_id]);
    if (ex) {
      await pool.query(`
        UPDATE resigned_archives SET apply_id=?, name=?, department=?, role_name=?, hire_date=?,
          resign_date=?, work_years=?, resign_reason=?, work_history=?, performance_record=?,
          handover_status=?, archive_status='已归档', archived_at=NOW()
        WHERE emp_id=?`,
        [row.apply_id, row.name, row.department, row.role_name, fmtDate(target.contract_start || row.hire_date),
          resignDate, workYears, row.resign_reason, workHistory, perf, handover, row.emp_id]);
    } else {
      await pool.query(`
        INSERT INTO resigned_archives
        (archive_id, apply_id, emp_id, name, department, role_name, hire_date, resign_date, work_years,
         resign_reason, work_history, performance_record, handover_status, archive_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, '已归档')`,
        [archive_id, row.apply_id, row.emp_id, row.name, row.department, row.role_name,
          fmtDate(target.contract_start || row.hire_date), resignDate, workYears,
          row.resign_reason, workHistory, perf, handover]);
    }

    await refreshDeptStats();
    await logOp(operator, row.emp_id, '离职归档', `${row.apply_id} ${resignDate}`);
  }

  ensureResignSchema();

  // ========== P1 离职申请 ==========
  app.post('/api/resign/apply', async (req, res) => {
    try {
      const { username, expected_resign_date, resign_reason, handover_plan } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (emp.emp_status === '已离职') return send(res, { success: false, error: '已离职员工不可申请' });
      if (!expected_resign_date) return send(res, { success: false, error: '请填写预计离职日期' });

      const ed = fmtDate(expected_resign_date);
      const today = await mysqlToday(pool);
      if (ed <= today) return send(res, { success: false, error: '预计离职日期须晚于今天' });

      const [[pending]] = await pool.query(`
        SELECT apply_id FROM resign_applications
        WHERE emp_id=? AND status IN ('待主管审批','待HR审批') LIMIT 1`, [emp.emp_id]);
      if (pending) {
        return send(res, { success: false, error: `已有进行中的申请「${pending.apply_id}」` });
      }

      const [[maxRow]] = await pool.query('SELECT apply_id FROM resign_applications ORDER BY id DESC LIMIT 1');
      let num = maxRow?.apply_id ? parseInt(String(maxRow.apply_id).replace(/\D/g, ''), 10) + 1 : 1;
      const apply_id = 'RZ' + String(num).padStart(4, '0');

      await pool.query(`
        INSERT INTO resign_applications
        (apply_id, emp_id, name, department, role_name, hire_date, expected_resign_date, resign_reason, handover_plan, status)
        VALUES (?,?,?,?,?,?,?,?,?, '待主管审批')`,
        [apply_id, emp.emp_id, emp.name, emp.department, emp.role || '',
          fmtDate(emp.contract_start), ed, resign_reason || '', handover_plan || '']);

      await logOp(username, emp.emp_id, '离职申请', apply_id);
      send(res, { success: true, apply_id, message: '离职申请已提交，等待部门主管审批' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P3 个人进度 ==========
  app.get('/api/resign/my', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      const [rows] = await pool.query(
        'SELECT * FROM resign_applications WHERE emp_id=? ORDER BY created_at DESC LIMIT 20',
        [emp.emp_id]);
      send(res, { success: true, records: rows.map(appRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P2 审批 ==========
  app.post('/api/resign/approve', async (req, res) => {
    try {
      const { operator, apply_id, action, comment } = req.body;
      const op = await getEmployee(operator);
      if (!apply_id) return send(res, { success: false, error: '申请编号无效' });

      const [[row]] = await pool.query('SELECT * FROM resign_applications WHERE apply_id=?', [apply_id]);
      if (!row) return send(res, { success: false, error: '申请不存在' });

      const mgrActions = ['mgr_approve', 'mgr_reject'];
      const hrActions = ['hr_approve', 'hr_reject'];
      if (![...mgrActions, ...hrActions].includes(action)) {
        return send(res, { success: false, error: '操作无效' });
      }

      if (mgrActions.includes(action)) {
        if (!canApproveMgr(op, operator)) return send(res, { success: false, error: '无部门审批权限' });
        if (row.status !== '待主管审批') return send(res, { success: false, error: '当前状态不可进行主管审批' });
        if (isManager(op) && !isHR(op, operator)) {
          const [[empRow]] = await pool.query(
            'SELECT department_id FROM employees WHERE emp_id=?', [row.emp_id]);
          if (empRow?.department_id !== op.department_id) {
            return send(res, { success: false, error: '仅可审批本部门员工的离职申请' });
          }
        }
        if (action === 'mgr_approve') {
          await pool.query(`
            UPDATE resign_applications SET status='待HR审批', mgr_approver_id=?, mgr_comment=?, mgr_time=NOW()
            WHERE apply_id=?`, [op?.emp_id || operator, comment || '', apply_id]);
          await logOp(operator, row.emp_id, '离职主管审批', `${apply_id} 通过`);
          return send(res, { success: true, message: '主管审批通过，已转 HR 终审' });
        }
        await pool.query(`
          UPDATE resign_applications SET status='已拒绝', mgr_approver_id=?, mgr_comment=?, mgr_time=NOW()
          WHERE apply_id=?`, [op?.emp_id || operator, comment || '', apply_id]);
        await logOp(operator, row.emp_id, '离职主管审批', `${apply_id} 拒绝`);
        return send(res, { success: true, message: '已拒绝该离职申请' });
      }

      if (!canApproveHR(op, operator)) return send(res, { success: false, error: '仅 HR 或管理员可终审' });
      if (row.status !== '待HR审批') return send(res, { success: false, error: '当前状态不可进行 HR 终审' });

      if (action === 'hr_reject') {
        await pool.query(`
          UPDATE resign_applications SET status='已拒绝', hr_approver_id=?, hr_comment=?, hr_time=NOW()
          WHERE apply_id=?`, [op?.emp_id || operator, comment || '', apply_id]);
        await logOp(operator, row.emp_id, '离职HR审批', `${apply_id} 拒绝`);
        return send(res, { success: true, message: '已拒绝该离职申请' });
      }

      await pool.query(`
        UPDATE resign_applications SET status='已批准', hr_approver_id=?, hr_comment=?, hr_time=NOW()
        WHERE apply_id=?`, [op?.emp_id || operator, comment || '', apply_id]);
      const [[approved]] = await pool.query('SELECT * FROM resign_applications WHERE apply_id=?', [apply_id]);
      await finalizeResign(pool, approved, operator);
      await logOp(operator, row.emp_id, '离职HR审批', `${apply_id} 批准`);
      send(res, { success: true, message: '已批准离职，员工状态已更新并归档' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P3 查询 ==========
  app.post('/api/resign/query', async (req, res) => {
    try {
      const { operator, status, department_id, date_from, date_to, keyword, scope } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let sql = 'SELECT * FROM resign_applications WHERE 1=1';
      const params = [];

      if (scope === 'pending_mgr' && canApproveMgr(emp, operator)) {
        sql += " AND status='待主管审批'";
        if (isManager(emp) && !isHR(emp, operator)) {
          sql += ` AND ${sqlDeptByEmpId()}`;
          params.push(emp.department_id);
        }
      } else if (scope === 'pending_hr' && canApproveHR(emp, operator)) {
        sql += " AND status='待HR审批'";
      } else if (!isHR(emp, operator) && operator !== 'root') {
        if (isManager(emp)) {
          sql += ` AND ${sqlDeptByEmpId()}`;
          params.push(emp.department_id);
        } else {
          sql += ' AND emp_id=?';
          params.push(emp.emp_id);
        }
      } else if (department_id) {
        sql += ` AND ${sqlDeptByEmpId()}`;
        params.push(department_id);
      }

      if (status) { sql += ' AND status=?'; params.push(status); }
      if (date_from) { sql += ' AND expected_resign_date>=?'; params.push(date_from); }
      if (date_to) { sql += ' AND expected_resign_date<=?'; params.push(date_to); }
      if (keyword) {
        sql += ' AND (name LIKE ? OR emp_id LIKE ? OR apply_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY created_at DESC LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(appRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P4 统计 ==========
  app.post('/api/resign/summary', async (req, res) => {
    try {
      const { operator, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let deptFilter = '';
      const params = [];
      if (!isHR(emp, operator) && operator !== 'root' && isManager(emp)) {
        deptFilter = ` AND ${sqlDeptByEmpId()}`;
        params.push(emp.department_id);
      } else if (department_id) {
        deptFilter = ` AND ${sqlDeptByEmpId()}`;
        params.push(department_id);
      }

      const [[m]] = await pool.query(`
        SELECT COUNT(*) AS v FROM resign_applications
        WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m') ${deptFilter}`, params);
      const [[pMgr]] = await pool.query(`
        SELECT COUNT(*) AS v FROM resign_applications WHERE status='待主管审批' ${deptFilter}`, params);
      const [[pHr]] = await pool.query(`
        SELECT COUNT(*) AS v FROM resign_applications WHERE status='待HR审批'`, []);
      const [[arch]] = await pool.query('SELECT COUNT(*) AS v FROM resigned_archives');

      send(res, {
        success: true,
        data: {
          month_apply: m.v,
          pending_mgr: pMgr.v,
          pending_hr: isHR(emp, operator) || operator === 'root' ? pHr.v : 0,
          archive_total: arch.v
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P4 导出申请 ==========
  app.post('/api/resign/export', async (req, res) => {
    try {
      const body = req.body;
      const emp = await getEmployee(body.operator);
      if (!canApproveHR(emp, body.operator) && !isManager(emp)) {
        return send(res, { success: false, error: '无权限导出' });
      }
      const scope = isHR(emp, body.operator) || body.operator === 'root' ? {} : { scope: 'dept' };
      // reuse query logic inline
      let sql = 'SELECT * FROM resign_applications WHERE 1=1';
      const params = [];
      if (isManager(emp) && !isHR(emp, body.operator)) {
        sql += ` AND ${sqlDeptByEmpId()}`;
        params.push(emp.department_id);
      }
      if (body.status) { sql += ' AND status=?'; params.push(body.status); }
      sql += ' ORDER BY created_at DESC';
      const [rows] = await pool.query(sql, params);
      const header = '申请编号,工号,姓名,部门,角色,预计离职,原因,状态,申请时间\n';
      const csv = header + rows.map(r =>
        [r.apply_id, r.emp_id, r.name, r.department, r.role_name, fmtDate(r.expected_resign_date),
          (r.resign_reason || '').replace(/,/g, '，'), r.status, r.created_at]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=resign_export.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P3/P4 归档查询 ==========
  app.get('/api/resigned-archives', async (req, res) => {
    try {
      const { operator, department_id, keyword } = req.query;
      const emp = await getEmployee(operator);
      let sql = 'SELECT * FROM resigned_archives WHERE 1=1';
      const params = [];
      if (emp?.role_id === 2 && !isHR(emp, operator) && operator !== 'root') {
        sql += ` AND ${sqlDeptByEmpId()}`;
        params.push(emp.department_id);
      } else if (department_id) {
        sql += ` AND ${sqlDeptByEmpId()}`;
        params.push(department_id);
      }
      if (keyword) {
        sql += ' AND (name LIKE ? OR emp_id LIKE ? OR archive_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY archived_at DESC LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(archiveRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/resign/archives/export', async (req, res) => {
    try {
      const { operator, keyword } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator) && !isManager(emp) && operator !== 'root') {
        return send(res, { success: false, error: '无权限导出' });
      }
      let sql = 'SELECT * FROM resigned_archives WHERE 1=1';
      const params = [];
      if (isManager(emp) && !isHR(emp, operator)) {
        sql += ` AND ${sqlDeptByEmpId()}`;
        params.push(emp.department_id);
      }
      if (keyword) {
        sql += ' AND (name LIKE ? OR emp_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY archived_at DESC';
      const [rows] = await pool.query(sql, params);
      const header = '归档编号,申请编号,工号,姓名,部门,角色,入职,离职,工龄,原因,交接,归档时间\n';
      const csv = header + rows.map(r =>
        [r.archive_id, r.apply_id, r.emp_id, r.name, r.department, r.role_name,
          fmtDate(r.hire_date), fmtDate(r.resign_date), r.work_years,
          (r.resign_reason || '').replace(/,/g, '，'), r.handover_status, r.archived_at]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=resign_archives_export.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.delete('/api/resign/:apply_id', async (req, res) => {
    try {
      const { operator } = req.query;
      const apply_id = req.params.apply_id;
      const emp = await getEmployee(operator);
      const [[row]] = await pool.query('SELECT * FROM resign_applications WHERE apply_id=?', [apply_id]);
      if (!row) return send(res, { success: false, error: '申请不存在' });
      const isOwner = row.emp_id === emp?.emp_id;
      if (!isOwner && !isHR(emp, operator)) return send(res, { success: false, error: '无权限' });
      if (!['待主管审批', '待HR审批'].includes(row.status)) {
        return send(res, { success: false, error: '仅可撤销进行中的申请' });
      }
      await pool.query('DELETE FROM resign_applications WHERE apply_id=?', [apply_id]);
      await logOp(operator, row.emp_id, '撤销离职', apply_id);
      send(res, { success: true, message: '离职申请已撤销' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
