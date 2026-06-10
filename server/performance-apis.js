// 绩效管理模块 API - 指标库 / 自评 / 主管评 / 校准 / 归档 / 人才库
const fs = require('fs');
const path = require('path');

const GRADES = ['A', 'B', 'C', 'D'];
const GRADE_COEF = { A: 1.2, B: 1.0, C: 0.8, D: 0.6 };
const DEFAULT_DIST = { A: 0.10, B: 0.30, C: 0.40, D: 0.20 };

module.exports = async function (app, pool, send) {

  function expandStatusFilter(status) {
    if (!status) return null;
    if (status === '已冻结' || status === '主管已评') return ['已冻结', '待校准'];
    return [status];
  }

  function pfStatusWhere(status, params) {
    const list = expandStatusFilter(status);
    if (!list) return '';
    if (list.length === 1) {
      params.push(list[0]);
      return ' AND r.status=?';
    }
    params.push(...list);
    return ` AND r.status IN (${list.map(() => '?').join(',')})`;
  }

  async function migrateLegacyStatuses() {
    const [r] = await pool.query(`
      UPDATE performance_records SET status='已冻结', frozen_at=COALESCE(frozen_at, NOW()),
        final_grade=COALESCE(final_grade, suggested_grade),
        performance_coefficient=COALESCE(performance_coefficient,
          CASE COALESCE(final_grade, suggested_grade)
            WHEN 'A' THEN 1.2 WHEN 'B' THEN 1.0 WHEN 'C' THEN 0.8 WHEN 'D' THEN 0.6 ELSE 1.0 END)
      WHERE status='待校准' AND suggested_grade IS NOT NULL`);
    if (r.affectedRows > 0) console.log(`绩效：已迁移 ${r.affectedRows} 条「待校准」→「主管已评」`);
  }

  async function ensureSchema() {
    try {
      const [[t]] = await pool.query(
        "SELECT COUNT(*) AS v FROM information_schema.TABLES WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='performance_templates'");
      if (!t.v) {
        const sql = fs.readFileSync(path.join(__dirname, 'performance-migrate.sql'), 'utf8');
        const cleaned = sql.replace(/--[^\n]*/g, '');
        for (const stmt of cleaned.split(';')) {
          const s = stmt.trim();
          if (s && /CREATE\s+TABLE/i.test(s)) await pool.query(s);
        }
        console.log('绩效模块数据表已初始化');
      }
      await migrateLegacyStatuses();
    } catch (e) { console.warn('绩效表迁移:', e.message); }
  }

  await ensureSchema();

  async function getEmployee(username) {
    if (!username) return null;
    const [[row]] = await pool.query(`
      SELECT e.*, d.name AS department, d.id AS department_id, r.name AS role, r.id AS role_id
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

  function isRecruiter(emp) {
    return emp?.role_id === 4;
  }

  function nextId(prefix, num) {
    return prefix + String(num).padStart(4, '0');
  }

  async function genId(table, col, prefix) {
    const [[maxRow]] = await pool.query(`SELECT ${col} AS v FROM ${table} ORDER BY id DESC LIMIT 1`);
    let num = 1;
    if (maxRow?.v) {
      num = parseInt(String(maxRow.v).replace(/\D/g, ''), 10) + 1;
    }
    return nextId(prefix, num);
  }

  function parseJsonField(raw, fallback) {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function parseIndicators(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    return [];
  }

  function validateIndicators(indicators) {
    if (!Array.isArray(indicators) || indicators.length < 1) {
      return { ok: false, error: '至少配置 1 项 KPI 指标' };
    }
    if (indicators.length > 20) {
      return { ok: false, error: '指标数量不能超过 20 项' };
    }
    let weightSum = 0;
    for (const it of indicators) {
      if (!it.name || !String(it.name).trim()) {
        return { ok: false, error: '指标名称不能为空' };
      }
      const w = parseFloat(it.weight);
      if (isNaN(w) || w <= 0 || w > 100) {
        return { ok: false, error: `指标「${it.name}」权重无效（0~100）` };
      }
      weightSum += w;
    }
    if (Math.abs(weightSum - 100) > 0.01) {
      return { ok: false, error: `指标权重总和须为 100，当前为 ${weightSum.toFixed(2)}` };
    }
    return { ok: true };
  }

  function rowTemplate(r) {
    return {
      template_id: r.template_id,
      name: r.name,
      cycle: r.cycle,
      department_id: r.department_id,
      indicators: parseIndicators(r.indicators),
      grade_distribution: parseJsonField(r.grade_distribution, DEFAULT_DIST),
      status: r.status,
      published_at: r.published_at,
      published_by: r.published_by,
      created_at: r.created_at
    };
  }

  function rowRecord(r) {
    return {
      record_id: r.record_id,
      template_id: r.template_id,
      emp_id: r.emp_id,
      name: r.name,
      department: r.department,
      cycle: r.cycle,
      status: r.status,
      self_tasks: r.self_tasks,
      self_score: r.self_score != null ? Number(r.self_score) : null,
      self_summary: r.self_summary,
      self_submitted_at: r.self_submitted_at,
      manager_id: r.manager_id,
      manager_score: r.manager_score != null ? Number(r.manager_score) : null,
      suggested_grade: r.suggested_grade,
      interview_feedback: r.interview_feedback,
      improvement_suggestions: r.improvement_suggestions,
      manager_submitted_at: r.manager_submitted_at,
      final_grade: r.final_grade,
      performance_coefficient: r.performance_coefficient != null ? Number(r.performance_coefficient) : null,
      frozen_at: r.frozen_at,
      archived_at: r.archived_at
    };
  }

  // ========== 用例1：发布考核指标库 ==========
  app.post('/api/performance/template/save', async (req, res) => {
    try {
      const { operator, template_id, name, cycle, department_id, indicators, grade_distribution } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可配置考核指标库' });

      const val = validateIndicators(parseIndicators(indicators));
      if (!val.ok) return send(res, { success: false, error: val.error });
      if (!cycle || !name) return send(res, { success: false, error: '请填写模板名称与考核周期' });

      const indJson = JSON.stringify(parseIndicators(indicators));
      const distJson = JSON.stringify(grade_distribution || DEFAULT_DIST);

      if (template_id) {
        const [[ex]] = await pool.query('SELECT * FROM performance_templates WHERE template_id=?', [template_id]);
        if (!ex) return send(res, { success: false, error: '模板不存在' });
        if (ex.status !== '草稿') return send(res, { success: false, error: '已发布模板本周期内不可修改' });
        await pool.query(`
          UPDATE performance_templates SET name=?, cycle=?, department_id=?, indicators=?, grade_distribution=?
          WHERE template_id=?`,
          [name, cycle, department_id || null, indJson, distJson, template_id]);
        await logOp(operator, emp.emp_id, '绩效指标配置', template_id);
        return send(res, { success: true, template_id, message: '指标库草稿已保存' });
      }

      const tid = await genId('performance_templates', 'template_id', 'PT');
      await pool.query(`
        INSERT INTO performance_templates (template_id, name, cycle, department_id, indicators, grade_distribution, status)
        VALUES (?,?,?,?,?,?,'草稿')`,
        [tid, name, cycle, department_id || null, indJson, distJson]);
      await logOp(operator, emp.emp_id, '绩效指标配置', tid);
      send(res, { success: true, template_id: tid, message: '指标库草稿已创建' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/performance/template/publish', async (req, res) => {
    try {
      const { operator, template_id, replace_existing } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可发布指标库' });

      const [[tpl]] = await pool.query('SELECT * FROM performance_templates WHERE template_id=?', [template_id]);
      if (!tpl) return send(res, { success: false, error: '模板不存在' });
      if (tpl.status !== '草稿') return send(res, { success: false, error: '仅草稿状态可发布' });

      const val = validateIndicators(parseIndicators(tpl.indicators));
      if (!val.ok) return send(res, { success: false, error: val.error });

      const [existing] = await pool.query(
        "SELECT template_id, status FROM performance_templates WHERE cycle=? AND status IN ('已发布','已锁定') AND template_id<>?",
        [tpl.cycle, template_id]);

      if (existing.length) {
        if (!replace_existing) {
          return send(res, {
            success: false,
            error: '该考核周期已有发布的指标库，可勾选「替换已发布指标库」后重新发布',
            can_replace: true
          });
        }
        const [[blocked]] = await pool.query(`
          SELECT COUNT(*) AS v FROM performance_records
          WHERE cycle=? AND status IN ('待主管评','已冻结','已归档')`, [tpl.cycle]);
        if (blocked.v > 0) {
          return send(res, {
            success: false,
            error: '该周期已有员工进入评分或校准流程，无法替换指标库，请使用新的考核周期'
          });
        }
        await pool.query('DELETE FROM performance_notifications WHERE cycle=?', [tpl.cycle]);
        await pool.query("DELETE FROM performance_records WHERE cycle=? AND status='待自评'", [tpl.cycle]);
        for (const old of existing) {
          await pool.query('DELETE FROM performance_templates WHERE template_id=?', [old.template_id]);
          await logOp(operator, emp.emp_id, '替换作废旧指标库', old.template_id);
        }
      }

      await pool.query(`
        UPDATE performance_templates SET status='已发布', published_at=NOW(), published_by=?
        WHERE template_id=?`, [operator, template_id]);

      let empSql = "SELECT emp_id FROM employees WHERE emp_status IN ('在职','试用期')";
      const params = [];
      if (tpl.department_id) {
        empSql += ' AND department_id=?';
        params.push(tpl.department_id);
      }
      const [emps] = await pool.query(empSql, params);

      let created = 0;
      for (const e of emps) {
        const [[exists]] = await pool.query(
          'SELECT record_id FROM performance_records WHERE emp_id=? AND cycle=?', [e.emp_id, tpl.cycle]);
        if (exists) continue;
        const rid = await genId('performance_records', 'record_id', 'PR');
        await pool.query(`
          INSERT INTO performance_records (record_id, template_id, emp_id, cycle, status)
          VALUES (?,?,?,?, '待自评')`,
          [rid, template_id, e.emp_id, tpl.cycle]);
        await pool.query(`
          INSERT INTO performance_notifications (emp_id, cycle, title, content)
          VALUES (?,?,?,?)`,
          [e.emp_id, tpl.cycle, '考核启动通知',
            `考核周期 ${tpl.cycle} 已启动，请对照 KPI 指标库完成自评。`]);
        created++;
      }

      await logOp(operator, emp.emp_id, '发布考核指标库', `${template_id} 通知${created}人${replace_existing ? '（替换发布）' : ''}`);
      send(res, {
        success: true,
        message: replace_existing && existing.length
          ? `已替换并发布新指标库，向 ${created} 名员工下发考核启动通知`
          : `考核指标库已发布，已向 ${created} 名员工下发考核启动通知`,
        notified: created,
        replaced: !!(replace_existing && existing.length)
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/performance/template/delete', async (req, res) => {
    try {
      const { operator, template_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可删除指标库草稿' });
      if (!template_id) return send(res, { success: false, error: '请指定要删除的模板' });

      const [[tpl]] = await pool.query('SELECT * FROM performance_templates WHERE template_id=?', [template_id]);
      if (!tpl) return send(res, { success: false, error: '模板不存在' });
      if (tpl.status !== '草稿') {
        return send(res, { success: false, error: '仅草稿可删除，已发布/已锁定请使用「取消锁定」或「替换发布」' });
      }

      await pool.query('DELETE FROM performance_templates WHERE template_id=?', [template_id]);
      await logOp(operator, emp.emp_id, '删除绩效指标草稿', template_id);
      send(res, { success: true, message: '草稿已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/performance/template/unlock', async (req, res) => {
    try {
      const { operator, template_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可取消锁定' });
      if (!template_id) return send(res, { success: false, error: '请指定模板' });

      const [[tpl]] = await pool.query('SELECT * FROM performance_templates WHERE template_id=?', [template_id]);
      if (!tpl) return send(res, { success: false, error: '模板不存在' });
      if (tpl.status !== '已锁定') {
        return send(res, { success: false, error: '仅已锁定状态的指标库可取消锁定' });
      }

      const [[archived]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE cycle=? AND status='已归档'", [tpl.cycle]);
      if (archived.v > 0) {
        return send(res, { success: false, error: '该周期已有归档记录，无法取消锁定' });
      }

      await pool.query(`
        UPDATE performance_records SET status='待主管评', frozen_at=NULL,
          final_grade=NULL, performance_coefficient=NULL
        WHERE cycle=? AND status='已冻结'`, [tpl.cycle]);

      await pool.query(`
        UPDATE performance_templates SET status='已发布'
        WHERE template_id=?`, [template_id]);

      const [r] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE cycle=? AND status='待主管评'", [tpl.cycle]);
      await logOp(operator, emp.emp_id, '取消绩效指标库锁定', `${template_id} 恢复${r[0].v}条待主管评`);
      send(res, {
        success: true,
        message: `已取消锁定，${r[0].v} 条记录恢复为「待主管评」，部门主管可重新评分`,
        restored: r[0].v
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/performance/templates', async (req, res) => {
    try {
      const { operator } = req.query;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      const [rows] = await pool.query('SELECT * FROM performance_templates ORDER BY created_at DESC LIMIT 50');
      send(res, { success: true, data: rows.map(rowTemplate) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/performance/template/active', async (req, res) => {
    try {
      const { operator, cycle } = req.query;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      let sql = "SELECT * FROM performance_templates WHERE status IN ('已发布','已锁定')";
      const params = [];
      if (cycle) { sql += ' AND cycle=?'; params.push(cycle); }
      sql += ' ORDER BY published_at DESC LIMIT 1';
      const [[tpl]] = await pool.query(sql, params);
      send(res, { success: true, data: tpl ? rowTemplate(tpl) : null });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 用例4：员工自评 ==========
  app.post('/api/performance/self/submit', async (req, res) => {
    try {
      const { username, record_id, self_tasks, self_score, self_summary } = req.body;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });

      const [[rec]] = await pool.query('SELECT * FROM performance_records WHERE record_id=?', [record_id]);
      if (!rec || rec.emp_id !== emp.emp_id) return send(res, { success: false, error: '记录不存在或无权限' });
      if (rec.status !== '待自评') return send(res, { success: false, error: '当前状态不可提交自评' });

      const score = parseFloat(self_score);
      if (isNaN(score) || score < 0 || score > 100) {
        return send(res, { success: false, error: '自评得分须在 0~100 之间' });
      }
      if (!self_summary || !String(self_summary).trim()) {
        return send(res, { success: false, error: '请填写个人总结' });
      }

      await pool.query(`
        UPDATE performance_records SET self_tasks=?, self_score=?, self_summary=?, self_submitted_at=NOW(), status='待主管评'
        WHERE record_id=?`,
        [self_tasks || '', score, self_summary, record_id]);
      await logOp(username, emp.emp_id, '绩效自评提交', record_id);
      send(res, { success: true, message: '自评报告已提交，等待主管评分' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/performance/my', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });

      const [rows] = await pool.query(`
        SELECT r.*, e.name, d.name AS department FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE r.emp_id=? ORDER BY r.created_at DESC LIMIT 20`, [emp.emp_id]);

      const [notes] = await pool.query(`
        SELECT * FROM performance_notifications WHERE emp_id=? ORDER BY created_at DESC LIMIT 10`, [emp.emp_id]);

      send(res, { success: true, records: rows.map(rowRecord), notifications: notes });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 用例3：主管评分与面谈 ==========
  app.get('/api/performance/manager/pending', async (req, res) => {
    try {
      const { operator } = req.query;
      const emp = await getEmployee(operator);
      if (!isManager(emp)) {
        return send(res, { success: false, error: '仅部门主管可查看待评列表' });
      }

      const [rows] = await pool.query(`
        SELECT r.*, e.name, d.name AS department, d.id AS department_id FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE r.status='待主管评' AND e.department_id=?
        ORDER BY r.self_submitted_at DESC, r.created_at DESC`, [emp.department_id]);
      send(res, { success: true, data: rows.map(rowRecord) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/performance/manager/submit', async (req, res) => {
    try {
      const { operator, record_id, manager_score, suggested_grade, interview_feedback, improvement_suggestions } = req.body;
      const emp = await getEmployee(operator);
      if (!isManager(emp)) {
        return send(res, { success: false, error: '仅部门主管可提交绩效评价' });
      }

      const [[rec]] = await pool.query(`
        SELECT r.*, e.department_id FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id WHERE r.record_id=?`, [record_id]);
      if (!rec) return send(res, { success: false, error: '记录不存在' });
      if (rec.status !== '待主管评') return send(res, { success: false, error: '该记录不在待主管评状态' });
      if (rec.department_id !== emp.department_id) {
        return send(res, { success: false, error: '不可评非本部门员工' });
      }

      const score = parseFloat(manager_score);
      const grade = String(suggested_grade || '').toUpperCase();
      if (isNaN(score) || score < 0 || score > 100) {
        return send(res, { success: false, error: '主管评分须在 0~100 之间' });
      }
      if (!GRADES.includes(grade)) {
        return send(res, { success: false, error: '绩效等级须为 A/B/C/D' });
      }
      if (!interview_feedback || !String(interview_feedback).trim()) {
        return send(res, { success: false, error: '请录入面谈记录' });
      }

      const coef = GRADE_COEF[grade];
      await pool.query(`
        UPDATE performance_records SET manager_id=?, manager_score=?, suggested_grade=?,
          interview_feedback=?, improvement_suggestions=?, manager_submitted_at=NOW(),
          final_grade=?, performance_coefficient=?, status='已冻结', frozen_at=NOW()
        WHERE record_id=?`,
        [emp.emp_id, score, grade, interview_feedback, improvement_suggestions || '', grade, coef, record_id]);

      const iid = await genId('performance_interviews', 'interview_id', 'PI');
      await pool.query(`
        INSERT INTO performance_interviews (interview_id, record_id, interview_time, suggestions, evaluation)
        VALUES (?,?,NOW(),?,?)`,
        [iid, record_id, improvement_suggestions || '', interview_feedback]);

      await logOp(operator, rec.emp_id, '绩效主管评价', `${record_id} ${grade}`);
      send(res, { success: true, message: '绩效评价已提交，结果已生效，等待 HR 归档' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 用例2：等级分布校准 ==========
  app.get('/api/performance/calibrate/preview', async (req, res) => {
    try {
      const { operator, cycle, department_id } = req.query;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可查看校准预览' });

      let sql = `
        SELECT COALESCE(r.final_grade, r.suggested_grade) AS g, COUNT(*) AS cnt, d.id AS dept_id, d.name AS dept_name
        FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE r.cycle=? AND r.status IN ('待校准','已冻结','已归档')`;
      const params = [cycle];
      if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      sql += ' GROUP BY d.id, d.name, g';
      const [rows] = await pool.query(sql, params);

      const [[tpl]] = await pool.query(
        "SELECT * FROM performance_templates WHERE cycle=? AND status IN ('已发布','已锁定') ORDER BY published_at DESC LIMIT 1",
        [cycle]);
      const dist = parseJsonField(tpl?.grade_distribution, DEFAULT_DIST);

      send(res, { success: true, distribution: rows, target: dist, compliant: checkDistribution(rows, dist) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  function checkDistribution(rows, target) {
    const total = rows.reduce((s, r) => s + r.cnt, 0);
    if (!total) return true;
    const counts = { A: 0, B: 0, C: 0, D: 0 };
    rows.forEach(r => { if (counts[r.g] != null) counts[r.g] += r.cnt; });
    for (const g of GRADES) {
      const ratio = (counts[g] || 0) / total;
      const t = target[g] || 0;
      if (g === 'A' || g === 'B') {
        if (ratio > t + 0.05) return false;
      }
    }
    return true;
  }

  app.post('/api/performance/calibrate', async (req, res) => {
    try {
      const { operator, cycle, adjustments, force_publish } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可执行等级校准' });

      const batchId = 'CB' + Date.now();
      if (Array.isArray(adjustments)) {
        for (const adj of adjustments) {
          const { record_id, grade_after, reason } = adj;
          if (!record_id || !GRADES.includes(String(grade_after).toUpperCase())) continue;
          const [[rec]] = await pool.query('SELECT * FROM performance_records WHERE record_id=?', [record_id]);
          if (!rec || rec.cycle !== cycle) continue;
          const before = rec.final_grade || rec.suggested_grade;
          const after = String(grade_after).toUpperCase();
          const coef = GRADE_COEF[after];
          await pool.query(`
            UPDATE performance_records SET final_grade=?, performance_coefficient=?, suggested_grade=?
            WHERE record_id=?`, [after, coef, after, record_id]);
          const cid = await genId('performance_calibrations', 'calibration_id', 'PC');
          await pool.query(`
            INSERT INTO performance_calibrations (calibration_id, record_id, hr_operator, grade_before, grade_after, reason, batch_id)
            VALUES (?,?,?,?,?,?,?)`,
            [cid, record_id, operator, before, after, reason || '', batchId]);
        }
      }

      const [preview] = await pool.query(`
        SELECT COALESCE(r.final_grade, r.suggested_grade) AS g, COUNT(*) AS cnt
        FROM performance_records r WHERE r.cycle=? AND r.status='待校准' GROUP BY g`, [cycle]);
      const [[tpl]] = await pool.query(
        "SELECT grade_distribution FROM performance_templates WHERE cycle=? AND status IN ('已发布','已锁定') LIMIT 1", [cycle]);
      const dist = parseJsonField(tpl?.grade_distribution, DEFAULT_DIST);
      const compliant = checkDistribution(preview.map(r => ({ g: r.g, cnt: r.cnt })), dist);

      if (!compliant && !force_publish) {
        return send(res, {
          success: false,
          error: '各部门等级比例不合规，请调整后再发布或勾选强制发布',
          compliant: false,
          preview
        });
      }

      await pool.query(`
        UPDATE performance_records SET status='已冻结', frozen_at=NOW(),
          final_grade=COALESCE(final_grade, suggested_grade),
          performance_coefficient=COALESCE(performance_coefficient,
            CASE COALESCE(final_grade, suggested_grade)
              WHEN 'A' THEN 1.2 WHEN 'B' THEN 1.0 WHEN 'C' THEN 0.8 WHEN 'D' THEN 0.6 ELSE 1.0 END)
        WHERE cycle=? AND status='待校准'`, [cycle]);

      await pool.query(`
        UPDATE performance_templates SET status='已锁定' WHERE cycle=? AND status='已发布'`, [cycle]);

      await logOp(operator, '', '绩效等级校准冻结', cycle);
      send(res, { success: true, message: '等级分布校准完成，结果已冻结发布', compliant });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 用例5：绩效结果归档 ==========
  app.post('/api/performance/archive', async (req, res) => {
    try {
      const { operator, cycle } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可归档绩效结果' });

      const [[frozen]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE cycle=? AND status='已冻结'", [cycle]);
      if (!frozen?.v) {
        return send(res, { success: false, error: '该周期无可归档的已冻结绩效记录' });
      }

      const [r] = await pool.query(`
        UPDATE performance_records SET status='已归档', archived_at=NOW(), archived_by=?
        WHERE cycle=? AND status='已冻结'`, [operator, cycle]);

      await logOp(operator, '', '绩效结果归档', `${cycle} ${r.affectedRows}条`);
      send(res, { success: true, message: `已归档 ${r.affectedRows} 条绩效记录至员工档案`, count: r.affectedRows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/performance/query', async (req, res) => {
    try {
      const { operator, cycle, status, department_id, keyword } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let sql = `
        SELECT r.*, e.name, d.name AS department FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id WHERE 1=1`;
      const params = [];
      if (cycle) { sql += ' AND r.cycle=?'; params.push(cycle); }
      sql += pfStatusWhere(status, params);
      if (department_id) { sql += ' AND e.department_id=?'; params.push(department_id); }
      if (keyword) {
        sql += ' AND (e.name LIKE ? OR r.emp_id LIKE ? OR r.record_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      if (!isHR(emp, operator) && isManager(emp)) {
        sql += ' AND e.department_id=?';
        params.push(emp.department_id);
      } else if (!isHR(emp, operator) && !isManager(emp)) {
        sql += ' AND r.emp_id=?';
        params.push(emp.emp_id);
      }
      sql += ' ORDER BY r.created_at DESC LIMIT 200';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(rowRecord) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 用例6：提取绩效优异者用于内招 ==========
  app.post('/api/performance/talent/extract', async (req, res) => {
    try {
      const { operator, cycle, min_grade } = req.body;
      const emp = await getEmployee(operator);
      if (!isRecruiter(emp) && !isHR(emp, operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可提取内招人才' });
      }

      const grades = min_grade === 'B' ? ['A', 'B'] : ['A'];
      const ph = grades.map(() => '?').join(',');
      const [rows] = await pool.query(`
        SELECT r.*, e.name, d.name AS department FROM performance_records r
        JOIN employees e ON r.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id
        WHERE r.cycle=? AND r.status='已归档' AND r.final_grade IN (${ph})`, [cycle, ...grades]);

      let added = 0;
      for (const r of rows) {
        const [[ex]] = await pool.query(
          'SELECT pool_id FROM performance_talent_pool WHERE emp_id=? AND cycle=?', [r.emp_id, cycle]);
        if (ex) continue;
        const pid = await genId('performance_talent_pool', 'pool_id', 'TP');
        const strengths = `连续高绩效(${r.final_grade})，部门：${r.department || ''}`;
        const promo = r.final_grade === 'A' ? 90 : 75;
        await pool.query(`
          INSERT INTO performance_talent_pool (pool_id, emp_id, cycle, final_grade, core_strengths, match_suggestion, promotion_score, created_by)
          VALUES (?,?,?,?,?,?,?,?)`,
          [pid, r.emp_id, cycle, r.final_grade, strengths, '可用于内部竞聘储备', promo, operator]);
        added++;
      }

      await logOp(operator, emp?.emp_id || '', '提取内招人才', `${cycle} ${added}人`);
      send(res, { success: true, message: `已筛选 ${added} 名高绩效员工存入内招储备库`, count: added });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/performance/talent/pool', async (req, res) => {
    try {
      const { operator, cycle } = req.query;
      const emp = await getEmployee(operator);
      if (!isRecruiter(emp) && !isHR(emp, operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可查看储备库' });
      }
      let sql = `
        SELECT t.*, e.name, d.name AS department FROM performance_talent_pool t
        JOIN employees e ON t.emp_id = e.emp_id
        LEFT JOIN departments d ON e.department_id = d.id WHERE 1=1`;
      const params = [];
      if (cycle) { sql += ' AND t.cycle=?'; params.push(cycle); }
      sql += ' ORDER BY t.promotion_score DESC, t.created_at DESC';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/performance/summary', async (req, res) => {
    try {
      const { operator } = req.query;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      const [[tpl]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_templates WHERE status IN ('已发布','已锁定')");
      const [[selfP]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE status='待自评'");
      const [[mgrP]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE status='待主管评'");
      const [[frozenP]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE status IN ('已冻结','待校准') AND (suggested_grade IS NOT NULL OR status='已冻结')");
      const [[arch]] = await pool.query(
        "SELECT COUNT(*) AS v FROM performance_records WHERE status='已归档'");
      const [[talent]] = await pool.query('SELECT COUNT(*) AS v FROM performance_talent_pool');

      send(res, {
        success: true,
        data: {
          active_templates: tpl.v,
          pending_self: selfP.v,
          pending_manager: mgrP.v,
          pending_frozen: frozenP.v,
          archived: arch.v,
          talent_pool: talent.v
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
