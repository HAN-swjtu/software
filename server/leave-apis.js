// 假期管理模块 API - J1~J4
const fs = require('fs');
const path = require('path');

const LEAVE_TYPES = ['年假', '病假', '事假', '婚假', '产假', '丧假', '调休'];
const LEAVE_QUOTAS = {
  '年假': 10,
  '病假': 10,
  '事假': 5,
  '婚假': 3,
  '产假': 98,
  '丧假': 3,
  '调休': 5
};

function calcDays(startDate, endDate) {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (e < s) return 0;
  return Math.floor((e - s) / 86400000) + 1;
}

const { syncLeaveByApplyId } = require('./attendance-helpers');

module.exports = function (app, pool, send) {

  async function ensureLeaveSchema() {
    try {
      const [[col]] = await pool.query(
        "SELECT COUNT(*) AS v FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='leave_records' AND COLUMN_NAME='apply_id'");
      if (!col.v) {
        const sql = fs.readFileSync(path.join(__dirname, 'leave-migrate.sql'), 'utf8');
        for (const stmt of sql.split(';')) {
          const s = stmt.trim();
          if (s && !s.startsWith('--') && (s.toUpperCase().startsWith('ALTER') || s.toUpperCase().startsWith('UPDATE'))) {
            await pool.query(s);
          }
        }
      }
    } catch (e) { console.warn('假期表迁移:', e.message); }
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

  function isHR(emp, username) {
    return username === 'root' || emp?.role_id === 1 || emp?.role_id === 3;
  }

  function isManager(emp) {
    return emp?.role_id === 2;
  }

  function canApprove(emp, username) {
    return isHR(emp, username) || isManager(emp);
  }

  async function buildLeaveBalances(empId, year = new Date().getFullYear()) {
    const [rows] = await pool.query(`
      SELECT leave_type, COALESCE(SUM(days),0) AS used_days
      FROM leave_records
      WHERE emp_id=? AND status='已批准' AND YEAR(start_date)=?
      GROUP BY leave_type`, [empId, year]);
    const usedMap = Object.fromEntries(rows.map(r => [r.leave_type, Number(r.used_days || 0)]));
    return Object.entries(LEAVE_QUOTAS).map(([leave_type, quota_days]) => {
      const used_days = usedMap[leave_type] || 0;
      return {
        leave_type,
        quota_days,
        used_days,
        remaining_days: Math.max(quota_days - used_days, 0)
      };
    });
  }

  function leaveRow(r) {
    const fmt = d => {
      const s = String(d);
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : s.slice(0, 10);
    };
    return {
      id: r.id,
      apply_id: r.apply_id || ('L' + String(r.id).padStart(4, '0')),
      emp_id: r.emp_id,
      name: r.name,
      department: r.department,
      leave_type: r.leave_type,
      start_date: fmt(r.start_date),
      end_date: fmt(r.end_date),
      days: r.days,
      reason: r.reason || '',
      status: r.status,
      approver_id: r.approver_id,
      approve_comment: r.approve_comment || '',
      approve_time: r.approve_time,
      created_at: r.created_at
    };
  }

  function buildScopeWhere(operator, emp, body = {}) {
    const params = [];
    let sql = '';
    if (isHR(emp, operator)) {
      if (body.department_id) { sql += ' AND e.department_id=?'; params.push(body.department_id); }
      if (body.emp_id) { sql += ' AND l.emp_id=?'; params.push(body.emp_id); }
    } else if (isManager(emp)) {
      sql += ' AND e.department_id=?';
      params.push(emp.department_id);
      if (body.emp_id) { sql += ' AND l.emp_id=?'; params.push(body.emp_id); }
    } else {
      sql += ' AND l.emp_id=?';
      params.push(emp.emp_id);
    }
    return { sql, params };
  }

  ensureLeaveSchema();

  // ========== J1 请假申请 ==========
  app.post('/api/leave/apply', async (req, res) => {
    try {
      const { username, leave_type, start_date, end_date, reason } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (emp.emp_status === '已离职') return send(res, { success: false, error: '已离职员工不可申请' });
      if (!leave_type || !LEAVE_TYPES.includes(leave_type)) {
        return send(res, { success: false, error: '请选择有效的假期类型' });
      }
      const sd = String(start_date).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      const ed = String(end_date).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!sd || !ed) return send(res, { success: false, error: '请填写有效的起止日期' });
      if (ed < sd) return send(res, { success: false, error: '结束日期不能早于开始日期' });
      const days = calcDays(sd, ed);
      if (days <= 0) return send(res, { success: false, error: '请假天数无效' });

      const [[overlap]] = await pool.query(`
        SELECT apply_id FROM leave_records
        WHERE emp_id=? AND status IN ('待审批','已批准')
          AND start_date <= ? AND end_date >= ? LIMIT 1`,
        [emp.emp_id, ed, sd]);
      if (overlap) {
        return send(res, { success: false, error: `与已有申请「${overlap.apply_id}」日期冲突` });
      }

      const [[maxRow]] = await pool.query('SELECT apply_id FROM leave_records ORDER BY id DESC LIMIT 1');
      let num = maxRow?.apply_id ? parseInt(String(maxRow.apply_id).replace(/\D/g, ''), 10) + 1 : 1;
      const apply_id = 'L' + String(num).padStart(4, '0');

      const [r] = await pool.query(`
        INSERT INTO leave_records (apply_id, emp_id, leave_type, start_date, end_date, days, reason, status)
        VALUES (?,?,?,?,?,?,?, '待审批')`,
        [apply_id, emp.emp_id, leave_type, sd, ed, days, reason || '']);

      await logOp(username, emp.emp_id, '请假申请', apply_id);
      send(res, { success: true, apply_id, id: r.insertId, message: '请假申请已提交，等待审批' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== J1 个人假期查询 ==========
  app.get('/api/leave/my', async (req, res) => {
    try {
      const { username } = req.query;
      if (username === 'root') {
        const [[pending]] = await pool.query(
          "SELECT COUNT(*) AS v FROM leave_records WHERE status='待审批'");
        return send(res, {
          success: true, is_admin: true, pending_all: pending.v,
          used_days_year: 0, records: []
        });
      }
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      const [rows] = await pool.query(`
        SELECT l.*, e.name, d.name AS department FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE l.emp_id=? ORDER BY l.created_at DESC LIMIT 50`, [emp.emp_id]);
      const year = new Date().getFullYear();
      const [[used]] = await pool.query(`
        SELECT COALESCE(SUM(days),0) AS v FROM leave_records
        WHERE emp_id=? AND status='已批准' AND YEAR(start_date)=?`, [emp.emp_id, year]);
      send(res, {
        success: true,
        used_days_year: Number(used.v),
        balance_year: year,
        balances: await buildLeaveBalances(emp.emp_id, year),
        records: rows.map(leaveRow)
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== J2 请假审批 ==========
  app.post('/api/leave/approve', async (req, res) => {
    try {
      const { operator, apply_id, action, comment } = req.body;
      const op = await getEmployee(operator);
      if (!canApprove(op, operator)) return send(res, { success: false, error: '无审批权限' });
      if (!apply_id) return send(res, { success: false, error: '申请编号无效' });
      if (!['approve', 'reject'].includes(action)) {
        return send(res, { success: false, error: '操作无效' });
      }

      const [[row]] = await pool.query(`
        SELECT l.*, e.department_id FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        WHERE l.apply_id=? LIMIT 1`, [apply_id]);
      if (!row) return send(res, { success: false, error: '申请不存在' });
      if (row.status !== '待审批') return send(res, { success: false, error: '该申请已处理' });

      if (isManager(op) && !isHR(op, operator) && row.department_id !== op.department_id) {
        return send(res, { success: false, error: '仅可审批本部门员工的请假' });
      }

      const newStatus = action === 'approve' ? '已批准' : '已拒绝';
      const approverId = op?.emp_id || operator;
      await pool.query(`
        UPDATE leave_records SET status=?, approver_id=?, approve_comment=?, approve_time=NOW()
        WHERE apply_id=?`,
        [newStatus, approverId, comment || '', apply_id]);

      if (newStatus === '已批准') {
        await syncLeaveByApplyId(pool, apply_id);
      }

      await logOp(operator, row.emp_id, '请假审批', `${apply_id} ${newStatus}`);
      send(res, { success: true, message: newStatus === '已批准' ? '已批准该请假申请' : '已拒绝该请假申请' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== J3 假期查询 ==========
  app.post('/api/leave/query', async (req, res) => {
    try {
      const { operator, status, leave_type, date_from, date_to, keyword, department_id, emp_id, scope } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let sql = `
        SELECT l.*, e.name, d.name AS department FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1`;
      const params = [];

      if (scope === 'pending' && canApprove(emp, operator)) {
        sql += " AND l.status='待审批'";
        if (isManager(emp) && !isHR(emp, operator)) {
          sql += ' AND e.department_id=?';
          params.push(emp.department_id);
        }
      } else {
        const scopeFilter = buildScopeWhere(operator, emp, { department_id, emp_id });
        sql += scopeFilter.sql;
        params.push(...scopeFilter.params);
      }

      if (status) { sql += ' AND l.status=?'; params.push(status); }
      if (leave_type) { sql += ' AND l.leave_type=?'; params.push(leave_type); }
      if (date_from) { sql += ' AND l.end_date>=?'; params.push(date_from); }
      if (date_to) { sql += ' AND l.start_date<=?'; params.push(date_to); }
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR l.emp_id LIKE ? OR l.apply_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY l.created_at DESC LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(leaveRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== J4 统计 ==========
  app.post('/api/leave/summary', async (req, res) => {
    try {
      const { operator, date_from, date_to, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let sql = `
        SELECT l.status, COUNT(*) AS cnt, COALESCE(SUM(l.days),0) AS total_days
        FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        WHERE 1=1`;
      const params = [];
      if (isHR(emp, operator)) {
        if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      } else {
        const scope = buildScopeWhere(operator, emp, { department_id });
        sql += scope.sql;
        params.push(...scope.params);
      }
      if (date_from) { sql += ' AND l.end_date>=?'; params.push(date_from); }
      if (date_to) { sql += ' AND l.start_date<=?'; params.push(date_to); }
      sql += ' GROUP BY l.status';
      const [rows] = await pool.query(sql, params);
      const stats = { 待审批: 0, 已批准: 0, 已拒绝: 0, total_days: 0, month_apply: 0, pending_all: null };
      rows.forEach(r => {
        stats[r.status] = r.cnt;
        if (r.status === '已批准') stats.total_days = Number(r.total_days);
      });
      if (isHR(emp, operator)) {
        const [[pAll]] = await pool.query(
          "SELECT COUNT(*) AS v FROM leave_records WHERE status='待审批'");
        stats.pending_all = pAll.v;
      }
      let msql = `
        SELECT COUNT(*) AS v FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        WHERE DATE_FORMAT(l.created_at,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`;
      const mparams = [];
      if (isHR(emp, operator)) {
        if (department_id) { msql += ' AND e.department_id=?'; mparams.push(department_id); }
      } else {
        const scope = buildScopeWhere(operator, emp, { department_id });
        msql += scope.sql;
        mparams.push(...scope.params);
      }
      const [[m]] = await pool.query(msql, mparams);
      stats.month_apply = m.v;
      send(res, { success: true, data: stats });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== J4 导出 ==========
  app.post('/api/leave/export', async (req, res) => {
    try {
      const body = req.body;
      const emp = await getEmployee(body.operator);
      if (!canApprove(emp, body.operator) && !isHR(emp, body.operator)) {
        return send(res, { success: false, error: '无权限导出' });
      }
      const scope = buildScopeWhere(body.operator, emp, body);
      let sql = `
        SELECT l.apply_id, l.emp_id, e.name, d.name AS department, l.leave_type,
               l.start_date, l.end_date, l.days, l.reason, l.status, l.approve_comment
        FROM leave_records l
        JOIN employees e ON l.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (body.status) { sql += ' AND l.status=?'; params.push(body.status); }
      if (body.leave_type) { sql += ' AND l.leave_type=?'; params.push(body.leave_type); }
      sql += ' ORDER BY l.created_at DESC';
      const [rows] = await pool.query(sql, params);
      const header = '申请编号,工号,姓名,部门,假期类型,开始,结束,天数,原因,状态,审批意见\n';
      const csv = header + rows.map(r =>
        [r.apply_id, r.emp_id, r.name, r.department || '', r.leave_type,
         r.start_date, r.end_date, r.days, (r.reason || '').replace(/,/g, '，'), r.status,
         (r.approve_comment || '').replace(/,/g, '，')]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      await logOp(body.operator, '', '导出假期', `${rows.length}条`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=leave_export.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // 撤销/删除（待审批）
  app.delete('/api/leave/:apply_id', async (req, res) => {
    try {
      const { operator } = req.query;
      const apply_id = req.params.apply_id;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      const [[row]] = await pool.query('SELECT * FROM leave_records WHERE apply_id=?', [apply_id]);
      if (!row) return send(res, { success: false, error: '申请不存在' });

      const isOwner = row.emp_id === emp?.emp_id;
      const isHr = isHR(emp, operator);
      if (!isOwner && !isHr) return send(res, { success: false, error: '无权限操作' });
      if (row.status === '已批准') {
        return send(res, { success: false, error: '已批准的申请不可撤销，请联系 HR' });
      }
      if (row.status !== '待审批' && !isHr) {
        return send(res, { success: false, error: '仅可撤销待审批的申请' });
      }

      await pool.query('DELETE FROM leave_records WHERE apply_id=?', [apply_id]);
      await logOp(operator, row.emp_id, '撤销请假', apply_id);
      send(res, { success: true, message: '请假申请已撤销' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
