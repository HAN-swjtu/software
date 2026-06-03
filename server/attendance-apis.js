// 考勤管理模块 API - K1~K4
const {
  CHECKIN_LATE_AFTER,
  fmtLocalDate,
  dateRangeLocal,
  nowLocal,
  isOnApprovedLeave,
  ensureAttendanceForRange,
  syncLeaveToAttendance,
  syncLeaveByApplyId,
  upsertLeaveAttendance,
  mysqlToday,
  removeOrphanLeaveAttendance
} = require('./attendance-helpers');
const EARLY_BEFORE = '17:30:00';

function timeStr(d) {
  return d.toTimeString().slice(0, 8);
}

function calcStatus(checkIn, checkOut, manualStatus) {
  if (manualStatus === '请假' || manualStatus === '缺勤') return manualStatus;
  if (!checkIn) return manualStatus || '缺勤';
  let status = checkIn > CHECKIN_LATE_AFTER ? '迟到' : '正常';
  if (checkOut && checkOut < EARLY_BEFORE) status = '早退';
  return status;
}

function fmtTime(t) {
  if (!t) return null;
  if (typeof t === 'string') return t.slice(0, 8);
  return timeStr(new Date(t));
}

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

  function attRow(r) {
    return {
      id: r.id,
      emp_id: r.emp_id,
      name: r.name,
      department: r.department,
      department_id: r.department_id,
      check_date: fmtLocalDate(r.check_date),
      status: r.status,
      check_in: fmtTime(r.check_in),
      check_out: fmtTime(r.check_out),
      remark: r.remark || ''
    };
  }

  function buildScopeWhere(operator, emp, body = {}) {
    const params = [];
    let sql = '';
    const isAdmin = operator === 'root' || emp?.role_id === 1;
    const isHR = emp?.role_id === 3;
    const isMgr = emp?.role_id === 2;
    if (isAdmin || isHR) {
      if (body.department_id) { sql += ' AND e.department_id=?'; params.push(body.department_id); }
      if (body.emp_id) { sql += ' AND a.emp_id=?'; params.push(body.emp_id); }
    } else if (isMgr) {
      sql += ' AND e.department_id=?';
      params.push(emp.department_id);
      if (body.emp_id) { sql += ' AND a.emp_id=?'; params.push(body.emp_id); }
    } else {
      sql += ' AND a.emp_id=?';
      params.push(emp.emp_id);
    }
    return { sql, params, isAdmin, isHR, isMgr };
  }

  // ========== K1/K2 今日打卡状态 ==========
  app.get('/api/attendance/today', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      const today = await mysqlToday(pool);
      const onLeave = await isOnApprovedLeave(pool, emp.emp_id, today);
      const [[rec]] = await pool.query(
        `SELECT * FROM attendance WHERE emp_id=? AND check_date=CURDATE()`, [emp.emp_id]);
      send(res, {
        success: true,
        data: {
          emp_id: emp.emp_id,
          name: emp.name,
          today,
          on_leave: onLeave,
          record: rec ? {
            id: rec.id,
            check_date: fmtLocalDate(rec.check_date),
            status: rec.status,
            check_in: fmtTime(rec.check_in),
            check_out: fmtTime(rec.check_out),
            remark: rec.remark || ''
          } : null
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== K1 签到 ==========
  app.post('/api/attendance/check-in', async (req, res) => {
    try {
      const { username } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (emp.emp_status === '已离职') return send(res, { success: false, error: '已离职员工不可打卡' });
      const today = await mysqlToday(pool);
      if (await isOnApprovedLeave(pool, emp.emp_id, today)) {
        await upsertLeaveAttendance(pool, emp.emp_id, today);
        return send(res, { success: false, error: '今日已批准请假，无需签到' });
      }
      const [[ex]] = await pool.query(
        `SELECT id, check_in, status FROM attendance WHERE emp_id=? AND check_date=CURDATE()`, [emp.emp_id]);
      if (ex?.status === '请假') {
        return send(res, { success: false, error: '今日为请假状态，无需签到' });
      }
      if (ex?.check_in) return send(res, { success: false, error: '今日已签到，请勿重复操作' });
      const [[clock]] = await pool.query("SELECT DATE_FORMAT(NOW(), '%H:%i:%s') AS t");
      const now = clock.t;
      const status = now > CHECKIN_LATE_AFTER ? '迟到' : '正常';
      if (ex) {
        await pool.query(
          `UPDATE attendance SET check_in=?, status=?, remark=IF(remark IS NULL OR remark='', ?, remark) WHERE id=?`,
          [now, status, status === '迟到' ? '签到迟到' : '', ex.id]);
      } else {
        await pool.query(
          `INSERT INTO attendance (emp_id, check_date, status, check_in) VALUES (?, CURDATE(), ?, ?)`,
          [emp.emp_id, status, now]);
      }
      await logOp(username, emp.emp_id, '考勤签到', `${today} ${now} ${status}`);
      send(res, { success: true, message: `签到成功（${today} ${status}）`, check_in: now, status, check_date: today });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== K2 签退 ==========
  app.post('/api/attendance/check-out', async (req, res) => {
    try {
      const { username } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (emp.emp_status === '已离职') return send(res, { success: false, error: '已离职员工不可打卡' });
      const [[rec]] = await pool.query(
        `SELECT * FROM attendance WHERE emp_id=? AND check_date=CURDATE()`, [emp.emp_id]);
      if (!rec?.check_in) return send(res, { success: false, error: '请先签到再签退' });
      if (rec.check_out) return send(res, { success: false, error: '今日已签退，请勿重复操作' });
      const now = timeStr(new Date());
      let status = rec.status;
      if (now < EARLY_BEFORE && status !== '迟到') status = '早退';
      await pool.query(
        `UPDATE attendance SET check_out=?, status=? WHERE id=?`, [now, status, rec.id]);
      await logOp(username, emp.emp_id, '考勤签退', `${now} ${status}`);
      send(res, { success: true, message: `签退成功（${status}）`, check_out: now, status });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== K3 考勤查询 ==========
  app.post('/api/attendance/query', async (req, res) => {
    try {
      const { operator, date_from, date_to, status, keyword } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      const from = date_from || (() => {
        const d = new Date(); d.setDate(d.getDate() - 90);
        return fmtLocalDate(d);
      })();
      const to = date_to || nowLocal().date;
      await ensureAttendanceForRange(pool, from, to);
      const scope = buildScopeWhere(operator, emp, req.body);
      let sql = `
        SELECT a.*, e.name, e.department_id, d.name AS department
        FROM attendance a
        JOIN employees e ON a.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (date_from) { sql += ' AND a.check_date>=?'; params.push(date_from); }
      else { sql += ' AND a.check_date>=?'; params.push(from); }
      if (date_to) { sql += ' AND a.check_date<=?'; params.push(date_to); }
      else { sql += ' AND a.check_date<=?'; params.push(to); }
      if (status) { sql += ' AND a.status=?'; params.push(status); }
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR a.emp_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY a.check_date DESC, a.emp_id LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(attRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== K4 考勤统计 ==========
  app.post('/api/attendance/summary', async (req, res) => {
    try {
      const { operator, date_from, date_to, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      const from = date_from || (() => {
        const d = new Date(); d.setDate(d.getDate() - 90);
        return fmtLocalDate(d);
      })();
      const to = date_to || nowLocal().date;
      await ensureAttendanceForRange(pool, from, to);
      const scope = buildScopeWhere(operator, emp, { department_id, emp_id: req.body.emp_id });
      let sql = `
        SELECT a.status, COUNT(*) AS cnt
        FROM attendance a
        JOIN employees e ON a.emp_id = e.emp_id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (date_from) { sql += ' AND a.check_date>=?'; params.push(date_from); }
      if (date_to) { sql += ' AND a.check_date<=?'; params.push(date_to); }
      sql += ' GROUP BY a.status';
      const [rows] = await pool.query(sql, params);
      const stats = { 正常: 0, 迟到: 0, 早退: 0, 缺勤: 0, 请假: 0, total: 0 };
      rows.forEach(r => { stats[r.status] = r.cnt; stats.total += r.cnt; });
      send(res, { success: true, data: stats });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== K4 导出 ==========
  app.post('/api/attendance/export', async (req, res) => {
    try {
      const { operator, date_from, date_to, status, department_id, emp_id, keyword } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      const isAdmin = operator === 'root' || emp?.role_id === 1;
      const isHR = emp?.role_id === 3;
      const isMgr = emp?.role_id === 2;
      if (!isAdmin && !isHR && !isMgr) {
        return send(res, { success: false, error: '无权限导出考勤' });
      }
      const scope = buildScopeWhere(operator, emp, { department_id, emp_id });
      let sql = `
        SELECT a.emp_id, e.name, d.name AS department, a.check_date, a.status,
               a.check_in, a.check_out, a.remark
        FROM attendance a
        JOIN employees e ON a.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (date_from) { sql += ' AND a.check_date>=?'; params.push(date_from); }
      if (date_to) { sql += ' AND a.check_date<=?'; params.push(date_to); }
      if (status) { sql += ' AND a.status=?'; params.push(status); }
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR a.emp_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY a.check_date DESC, a.emp_id';
      const [rows] = await pool.query(sql, params);
      const header = '工号,姓名,部门,日期,状态,签到,签退,备注\n';
      const csv = header + rows.map(r =>
        [r.emp_id, r.name, r.department || '', r.check_date, r.status,
         fmtTime(r.check_in) || '', fmtTime(r.check_out) || '', (r.remark || '').replace(/,/g, '，')]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      await logOp(operator, '', '导出考勤', `共${rows.length}条`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=attendance_export.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== HR 补录/修正 ==========
  app.post('/api/attendance/manual', async (req, res) => {
    try {
      const { operator, emp_id, check_date, check_in, check_out, status, remark } = req.body;
      const op = await getEmployee(operator);
      if (!op && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (![1, 3].includes(op?.role_id) && operator !== 'root') {
        return send(res, { success: false, error: '仅 HR 或管理员可补录考勤' });
      }
      if (!emp_id || !check_date) return send(res, { success: false, error: '工号和日期不能为空' });
      const [[target]] = await pool.query('SELECT emp_id, name FROM employees WHERE emp_id=?', [emp_id]);
      if (!target) return send(res, { success: false, error: '员工不存在' });
      const st = status || calcStatus(check_in, check_out);
      const [[ex]] = await pool.query(
        'SELECT id FROM attendance WHERE emp_id=? AND check_date=?', [emp_id, check_date]);
      if (ex) {
        await pool.query(
          `UPDATE attendance SET check_in=?, check_out=?, status=?, remark=? WHERE id=?`,
          [check_in || null, check_out || null, st, remark || '', ex.id]);
      } else {
        await pool.query(
          `INSERT INTO attendance (emp_id, check_date, status, check_in, check_out, remark) VALUES (?,?,?,?,?,?)`,
          [emp_id, check_date, st, check_in || null, check_out || null, remark || '']);
      }
      await logOp(operator, emp_id, '补录考勤', `${check_date} ${st}`);
      send(res, { success: true, message: '考勤记录已保存' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/attendance/:id', async (req, res) => {
    try {
      const { operator, check_in, check_out, status, remark } = req.body;
      const id = parseInt(req.params.id);
      const op = await getEmployee(operator);
      if (!op && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (![1, 3].includes(op?.role_id) && operator !== 'root') {
        return send(res, { success: false, error: '仅 HR 或管理员可修改考勤' });
      }
      const [[rec]] = await pool.query('SELECT * FROM attendance WHERE id=?', [id]);
      if (!rec) return send(res, { success: false, error: '记录不存在' });
      const inT = check_in || fmtTime(rec.check_in);
      const outT = check_out || fmtTime(rec.check_out);
      const st = status || (rec.status === '请假' ? '请假' : calcStatus(inT, outT, rec.status));
      await pool.query(
        `UPDATE attendance SET check_in=?, check_out=?, status=?, remark=? WHERE id=?`,
        [inT, outT, st, remark ?? rec.remark, id]);
      await logOp(operator, rec.emp_id, '修改考勤', `ID:${id}`);
      send(res, { success: true, message: '考勤已更新' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.delete('/api/attendance/:id', async (req, res) => {
    try {
      const { operator } = req.query;
      const id = parseInt(req.params.id);
      const op = await getEmployee(operator);
      if (!op && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (![1, 3].includes(op?.role_id) && operator !== 'root') {
        return send(res, { success: false, error: '仅 HR 或管理员可删除考勤' });
      }
      const [[rec]] = await pool.query('SELECT * FROM attendance WHERE id=?', [id]);
      if (!rec) return send(res, { success: false, error: '记录不存在' });
      await pool.query('DELETE FROM attendance WHERE id=?', [id]);
      await logOp(operator, rec.emp_id, '删除考勤', `${rec.check_date}`);
      send(res, { success: true, message: '考勤记录已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // 将已批准假期重新写入考勤（修复历史数据）— 仅 POST，浏览器直接打开会 GET 到此提示
  app.get('/api/attendance/sync-leave', (req, res) => {
    send(res, {
      success: false,
      message: '本接口请使用 POST。请在「考勤管理」点击「同步假期到考勤」，或由 HR/root 在已登录页面执行同步。'
    });
  });

  app.post('/api/attendance/sync-leave', async (req, res) => {
    try {
      const { operator } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (operator !== 'root' && ![1, 3].includes(emp?.role_id)) {
        return send(res, { success: false, error: '仅 HR 或管理员可执行同步' });
      }
      const [rows] = await pool.query(`
        SELECT apply_id, emp_id,
          DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
          DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date
        FROM leave_records WHERE status='已批准'`);
      let days = 0;
      for (const r of rows) {
        days += dateRangeLocal(r.start_date, r.end_date).length;
        await syncLeaveByApplyId(pool, r.apply_id);
      }
      const empIds = [...new Set(rows.map(r => r.emp_id))];
      for (const id of empIds) {
        await removeOrphanLeaveAttendance(pool, id);
      }
      send(res, { success: true, message: `已同步 ${rows.length} 条请假申请，共 ${days} 人天考勤为「请假」` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
