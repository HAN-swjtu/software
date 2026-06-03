// 薪资管理模块 API - X1~X4
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const LATE_DEDUCT = 50;
const EARLY_DEDUCT = 30;
const ABSENT_DEDUCT = 200;

function round2(n) { return Math.round(n * 100) / 100; }

function calcTax(gross) {
  const taxable = Math.max(0, gross - 5000);
  return round2(taxable * 0.03);
}

function calcNet(base, bonus, allowance, overtime, deduct, insurance, tax) {
  const gross = round2(base + bonus + allowance + overtime - deduct);
  const net = round2(gross - insurance - tax);
  return { gross, net };
}

async function ensureSalaryTables(pool) {
  const sql = fs.readFileSync(path.join(__dirname, 'salary-migrate.sql'), 'utf8');
  for (const stmt of sql.split(';')) {
    const s = stmt.trim();
    if (s && !s.startsWith('--') && s.toUpperCase().startsWith('CREATE')) {
      await pool.query(s);
    }
  }
  const [[cnt]] = await pool.query('SELECT COUNT(*) AS v FROM employee_salary');
  if (cnt.v === 0) {
    const [emps] = await pool.query(`
      SELECT emp_id, role_id FROM employees WHERE emp_status IS NULL OR emp_status != '已离职'`);
    for (const e of emps) {
      let base = 6500;
      if (e.role_id === 1) base = 15000;
      else if (e.role_id === 2) base = 12000;
      else if (e.role_id === 3) base = 10000;
      else if (e.role_id === 4) base = 8000;
      else base = 6000 + (parseInt(e.emp_id.replace('E', ''), 10) % 5) * 500;
      const bonus = round2(base * 0.15);
      const allowance = e.role_id <= 2 ? 800 : 300;
      const insurance = round2(base * 0.105);
      await pool.query(`
        INSERT INTO employee_salary (emp_id, base_salary, performance_bonus, allowance, social_insurance, effective_date)
        VALUES (?,?,?,?,?,CURDATE())`,
        [e.emp_id, base, bonus, allowance, insurance]);
    }
  }
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

  function isHR(op, username) {
    return username === 'root' || op?.role_id === 1 || op?.role_id === 3;
  }

  function payRow(r) {
    return {
      id: r.id, pay_id: r.pay_id, emp_id: r.emp_id, name: r.name,
      department: r.department, pay_month: r.pay_month,
      base_salary: Number(r.base_salary), performance_bonus: Number(r.performance_bonus),
      allowance: Number(r.allowance), overtime_pay: Number(r.overtime_pay),
      attendance_deduct: Number(r.attendance_deduct), social_insurance: Number(r.social_insurance),
      tax: Number(r.tax), gross_pay: Number(r.gross_pay), net_pay: Number(r.net_pay),
      pay_status: r.pay_status, remark: r.remark || '',
      paid_at: r.paid_at, created_at: r.created_at
    };
  }

  function buildScopeWhere(operator, emp, body = {}) {
    const params = [];
    let sql = '';
    if (isHR(emp, operator)) {
      if (body.department_id) { sql += ' AND e.department_id=?'; params.push(body.department_id); }
      if (body.emp_id) { sql += ' AND s.emp_id=?'; params.push(body.emp_id); }
    } else {
      sql += ' AND s.emp_id=?';
      params.push(emp.emp_id);
    }
    return { sql, params };
  }

  async function getAttendanceDeduct(empId, payMonth) {
    const [rows] = await pool.query(`
      SELECT status, COUNT(*) AS cnt FROM attendance
      WHERE emp_id=? AND DATE_FORMAT(check_date,'%Y-%m')=?
      GROUP BY status`, [empId, payMonth]);
    let deduct = 0;
    rows.forEach(r => {
      if (r.status === '迟到') deduct += r.cnt * LATE_DEDUCT;
      else if (r.status === '早退') deduct += r.cnt * EARLY_DEDUCT;
      else if (r.status === '缺勤') deduct += r.cnt * ABSENT_DEDUCT;
    });
    return deduct;
  }

  ensureSalaryTables(pool).catch(err => console.warn('薪资表初始化:', err.message));

  // ========== X1 个人薪资查询 ==========
  app.get('/api/salary/my', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      const [[struct]] = await pool.query('SELECT * FROM employee_salary WHERE emp_id=?', [emp.emp_id]);
      const [records] = await pool.query(`
        SELECT s.*, e.name, d.name AS department FROM salary_records s
        JOIN employees e ON s.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE s.emp_id=? ORDER BY s.pay_month DESC LIMIT 12`, [emp.emp_id]);
      send(res, {
        success: true,
        structure: struct ? {
          base_salary: Number(struct.base_salary),
          performance_bonus: Number(struct.performance_bonus),
          allowance: Number(struct.allowance),
          social_insurance: Number(struct.social_insurance),
          effective_date: struct.effective_date
        } : null,
        records: records.map(payRow)
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== X2 薪资结构查询/维护 ==========
  app.get('/api/salary/structures', async (req, res) => {
    try {
      const { operator, keyword } = req.query;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可查看薪资结构' });
      let sql = `
        SELECT es.*, e.name, d.name AS department, r.name AS role
        FROM employee_salary es
        JOIN employees e ON es.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN roles r ON e.role_id = r.id
        WHERE e.emp_status != '已离职'`;
      const params = [];
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR es.emp_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY es.emp_id LIMIT 300';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(r => ({
        emp_id: r.emp_id, name: r.name, department: r.department, role: r.role,
        base_salary: Number(r.base_salary), performance_bonus: Number(r.performance_bonus),
        allowance: Number(r.allowance), social_insurance: Number(r.social_insurance),
        effective_date: r.effective_date
      })) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/salary/structure', async (req, res) => {
    try {
      const { operator, emp_id, base_salary, performance_bonus, allowance, social_insurance, effective_date } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可维护薪资结构' });
      if (!emp_id) return send(res, { success: false, error: '工号不能为空' });
      const [[target]] = await pool.query('SELECT emp_id, name FROM employees WHERE emp_id=?', [emp_id]);
      if (!target) return send(res, { success: false, error: '员工不存在' });
      const base = parseFloat(base_salary) || 0;
      const bonus = parseFloat(performance_bonus) || 0;
      const allow = parseFloat(allowance) || 0;
      const ins = parseFloat(social_insurance) || 0;
      const eff = effective_date || new Date().toISOString().slice(0, 10);
      const [[ex]] = await pool.query('SELECT id FROM employee_salary WHERE emp_id=?', [emp_id]);
      if (ex) {
        await pool.query(`
          UPDATE employee_salary SET base_salary=?, performance_bonus=?, allowance=?, social_insurance=?, effective_date=?
          WHERE emp_id=?`, [base, bonus, allow, ins, eff, emp_id]);
      } else {
        await pool.query(`
          INSERT INTO employee_salary (emp_id, base_salary, performance_bonus, allowance, social_insurance, effective_date)
          VALUES (?,?,?,?,?,?)`, [emp_id, base, bonus, allow, ins, eff]);
      }
      await logOp(operator, emp_id, '维护薪资结构', `基本${base}`);
      send(res, { success: true, message: `已更新「${target.name}」薪资结构` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== X3 工资核算 ==========
  app.post('/api/salary/generate', async (req, res) => {
    try {
      const { operator, pay_month, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可核算工资' });
      if (!pay_month || !/^\d{4}-\d{2}$/.test(pay_month)) {
        return send(res, { success: false, error: '请指定有效发薪月份（YYYY-MM）' });
      }
      let empSql = `SELECT e.emp_id, e.name FROM employees e WHERE e.emp_status IN ('在职','试用期')`;
      const empParams = [];
      if (department_id) { empSql += ' AND e.department_id=?'; empParams.push(department_id); }
      const [targets] = await pool.query(empSql, empParams);
      let created = 0, skipped = 0;
      for (const t of targets) {
        const [[exists]] = await pool.query(
          'SELECT id, pay_status FROM salary_records WHERE emp_id=? AND pay_month=?', [t.emp_id, pay_month]);
        if (exists && exists.pay_status === '已发放') { skipped++; continue; }
        const [[struct]] = await pool.query('SELECT * FROM employee_salary WHERE emp_id=?', [t.emp_id]);
        const base = Number(struct?.base_salary || 6500);
        const bonus = Number(struct?.performance_bonus || 0);
        const allow = Number(struct?.allowance || 0);
        const insurance = Number(struct?.social_insurance || round2(base * 0.105));
        const deduct = await getAttendanceDeduct(t.emp_id, pay_month);
        const overtime = 0;
        const tax = calcTax(base + bonus + allow + overtime - deduct);
        const { gross, net } = calcNet(base, bonus, allow, overtime, deduct, insurance, tax);
        if (exists) {
          await pool.query(`
            UPDATE salary_records SET base_salary=?, performance_bonus=?, allowance=?, overtime_pay=?,
              attendance_deduct=?, social_insurance=?, tax=?, gross_pay=?, net_pay=?, remark=?
            WHERE id=?`,
            [base, bonus, allow, overtime, deduct, insurance, tax, gross, net,
             `考勤扣款${deduct}元`, exists.id]);
        } else {
          const [[maxRow]] = await pool.query(
            "SELECT pay_id FROM salary_records WHERE pay_month=? ORDER BY id DESC LIMIT 1", [pay_month]);
          let seq = 1;
          if (maxRow?.pay_id) seq = parseInt(maxRow.pay_id.slice(-4), 10) + 1;
          const pay_id = 'SL' + pay_month.replace('-', '') + String(seq).padStart(4, '0');
          await pool.query(`
            INSERT INTO salary_records
            (pay_id, emp_id, pay_month, base_salary, performance_bonus, allowance, overtime_pay,
             attendance_deduct, social_insurance, tax, gross_pay, net_pay, pay_status, remark)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [pay_id, t.emp_id, pay_month, base, bonus, allow, overtime, deduct, insurance, tax,
             gross, net, '草稿', `考勤扣款${deduct}元`]);
        }
        created++;
      }
      await logOp(operator, '', '工资核算', `${pay_month} 共${created}人`);
      send(res, {
        success: true,
        message: `${pay_month} 工资核算完成：处理 ${created} 人${skipped ? `，跳过已发放 ${skipped} 人` : ''}`
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/salary/publish', async (req, res) => {
    try {
      const { operator, pay_month, pay_ids } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可发放工资' });
      if (!pay_month && (!pay_ids || !pay_ids.length)) {
        return send(res, { success: false, error: '请指定月份或工资单' });
      }
      let sql = "UPDATE salary_records SET pay_status='已发放', paid_at=NOW() WHERE pay_status='草稿'";
      const params = [];
      if (pay_ids?.length) {
        sql += ` AND pay_id IN (${pay_ids.map(() => '?').join(',')})`;
        params.push(...pay_ids);
      } else {
        sql += ' AND pay_month=?';
        params.push(pay_month);
      }
      const [r] = await pool.query(sql, params);
      await logOp(operator, '', '工资发放', pay_month || pay_ids?.join(','));
      send(res, { success: true, message: `已发放 ${r.affectedRows} 条工资记录` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== X4 查询 / 统计 / 导出 ==========
  app.post('/api/salary/query', async (req, res) => {
    try {
      const { operator, pay_month, pay_status, keyword, department_id, emp_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      const scope = buildScopeWhere(operator, emp, { department_id, emp_id });
      let sql = `
        SELECT s.*, e.name, d.name AS department FROM salary_records s
        JOIN employees e ON s.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (pay_month) { sql += ' AND s.pay_month=?'; params.push(pay_month); }
      if (pay_status) { sql += ' AND s.pay_status=?'; params.push(pay_status); }
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR s.emp_id LIKE ? OR s.pay_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY s.pay_month DESC, s.emp_id LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(payRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/salary/summary', async (req, res) => {
    try {
      const { operator, pay_month, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (!isHR(emp, operator)) return send(res, { success: false, error: '无权限查看汇总' });
      let sql = `
        SELECT COUNT(*) AS headcount,
               COALESCE(SUM(s.gross_pay),0) AS total_gross,
               COALESCE(SUM(s.net_pay),0) AS total_net,
               COALESCE(SUM(s.attendance_deduct),0) AS total_deduct,
               SUM(CASE WHEN s.pay_status='已发放' THEN 1 ELSE 0 END) AS paid_count,
               SUM(CASE WHEN s.pay_status='草稿' THEN 1 ELSE 0 END) AS draft_count
        FROM salary_records s
        JOIN employees e ON s.emp_id = e.emp_id
        WHERE 1=1`;
      const params = [];
      if (pay_month) { sql += ' AND s.pay_month=?'; params.push(pay_month); }
      if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      const [[row]] = await pool.query(sql, params);
      send(res, {
        success: true,
        data: {
          headcount: row.headcount,
          total_gross: Number(row.total_gross),
          total_net: Number(row.total_net),
          total_deduct: Number(row.total_deduct),
          paid_count: row.paid_count,
          draft_count: row.draft_count
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/salary/export', async (req, res) => {
    try {
      const body = req.body;
      const emp = await getEmployee(body.operator);
      if (!isHR(emp, body.operator)) return send(res, { success: false, error: '无权限导出' });
      const scope = buildScopeWhere(body.operator, emp, body);
      let sql = `
        SELECT s.pay_id, s.emp_id, e.name, d.name AS department, s.pay_month,
               s.base_salary, s.performance_bonus, s.allowance, s.overtime_pay,
               s.attendance_deduct, s.social_insurance, s.tax, s.gross_pay, s.net_pay, s.pay_status
        FROM salary_records s
        JOIN employees e ON s.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE 1=1 ${scope.sql}`;
      const params = [...scope.params];
      if (body.pay_month) { sql += ' AND s.pay_month=?'; params.push(body.pay_month); }
      if (body.pay_status) { sql += ' AND s.pay_status=?'; params.push(body.pay_status); }
      sql += ' ORDER BY s.pay_month DESC, s.emp_id';
      const [rows] = await pool.query(sql, params);
      const header = '工资单号,工号,姓名,部门,月份,基本工资,绩效,津贴,加班,考勤扣款,社保公积金,个税,应发,实发,状态\n';
      const csv = header + rows.map(r =>
        [r.pay_id, r.emp_id, r.name, r.department || '', r.pay_month,
         r.base_salary, r.performance_bonus, r.allowance, r.overtime_pay,
         r.attendance_deduct, r.social_insurance, r.tax, r.gross_pay, r.net_pay, r.pay_status]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      await logOp(body.operator, '', '导出工资', `${rows.length}条`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=salary_export.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/salary/record/:id', async (req, res) => {
    try {
      const { operator, base_salary, performance_bonus, allowance, overtime_pay,
        attendance_deduct, social_insurance, tax, remark, pay_status } = req.body;
      const id = parseInt(req.params.id);
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可修改' });
      const [[rec]] = await pool.query('SELECT * FROM salary_records WHERE id=?', [id]);
      if (!rec) return send(res, { success: false, error: '记录不存在' });
      if (rec.pay_status === '已发放' && pay_status !== '草稿') {
        return send(res, { success: false, error: '已发放记录不可修改，请先联系管理员' });
      }
      const base = base_salary != null ? parseFloat(base_salary) : Number(rec.base_salary);
      const bonus = performance_bonus != null ? parseFloat(performance_bonus) : Number(rec.performance_bonus);
      const allow = allowance != null ? parseFloat(allowance) : Number(rec.allowance);
      const ot = overtime_pay != null ? parseFloat(overtime_pay) : Number(rec.overtime_pay);
      const deduct = attendance_deduct != null ? parseFloat(attendance_deduct) : Number(rec.attendance_deduct);
      const ins = social_insurance != null ? parseFloat(social_insurance) : Number(rec.social_insurance);
      const t = tax != null ? parseFloat(tax) : calcTax(base + bonus + allow + ot - deduct);
      const { gross, net } = calcNet(base, bonus, allow, ot, deduct, ins, t);
      await pool.query(`
        UPDATE salary_records SET base_salary=?, performance_bonus=?, allowance=?, overtime_pay=?,
          attendance_deduct=?, social_insurance=?, tax=?, gross_pay=?, net_pay=?, remark=?, pay_status=?
        WHERE id=?`,
        [base, bonus, allow, ot, deduct, ins, t, gross, net, remark ?? rec.remark,
         pay_status || rec.pay_status, id]);
      await logOp(operator, rec.emp_id, '修改工资单', rec.pay_id);
      send(res, { success: true, message: '工资单已更新' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.delete('/api/salary/record/:id', async (req, res) => {
    try {
      const { operator } = req.query;
      const id = parseInt(req.params.id);
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 或管理员可删除' });
      const [[rec]] = await pool.query('SELECT * FROM salary_records WHERE id=?', [id]);
      if (!rec) return send(res, { success: false, error: '记录不存在' });
      await pool.query('DELETE FROM salary_records WHERE id=?', [id]);
      await logOp(operator, rec.emp_id, '删除工资单', rec.pay_id);
      send(res, { success: true, message: '工资单已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
