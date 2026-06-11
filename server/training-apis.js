// 培训管理模块 API - 文档 3.3.6（加工 1.1~1.5 / D1~D4）
const fs = require('fs');
const path = require('path');

const TRAIN_TYPES = ['内部培训', '外部培训', '技能提升', '合规培训'];

module.exports = function (app, pool, send) {

  async function ensureTrainingSchema() {
    try {
      const [[t]] = await pool.query(
        "SELECT COUNT(*) AS v FROM information_schema.TABLES WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='training_courses'");
      if (!t.v) {
        const sql = fs.readFileSync(path.join(__dirname, 'training-migrate.sql'), 'utf8');
        for (const stmt of sql.split(';')) {
          const s = stmt.trim();
          if (s && !s.startsWith('--') && s.toUpperCase().startsWith('CREATE')) {
            try { await pool.query(s); } catch (e) { /* ignore */ }
          }
        }
      }
      await repairCorruptTrainingText(pool);
    } catch (e) { console.warn('培训表迁移:', e.message); }
  }

  async function repairCorruptTrainingText(pool) {
    const fixes = [
      {
        course_id: 'T0001',
        title: '新员工入职培训',
        trainer: 'HR团队',
        location: '会议室A',
        notice: '请准时参加',
        content: '入职制度、企业文化与岗位须知'
      }
    ];
    for (const row of fixes) {
      const [[ex]] = await pool.query(
        'SELECT location, notice FROM training_courses WHERE course_id=?', [row.course_id]);
      if (!ex) continue;
      if (hasBadUtf8(ex.location) || hasBadUtf8(ex.notice)) {
        await pool.query(
          `UPDATE training_courses SET title=?, trainer=?, location=?, notice=?, content=?
           WHERE course_id=?`,
          [row.title, row.trainer, row.location, row.notice, row.content, row.course_id]
        );
      }
    }
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

  function fmtDate(val) {
    if (!val) return '';
    const s = String(val);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  }

  async function mysqlToday(pool) {
    const [[r]] = await pool.query('SELECT CURDATE() AS d');
    return fmtDate(r.d);
  }

  async function nextId(pool, table, col, prefix, pad) {
    const [[maxRow]] = await pool.query(`SELECT ${col} AS v FROM ${table} ORDER BY id DESC LIMIT 1`);
    let num = maxRow?.v ? parseInt(String(maxRow.v).replace(/\D/g, ''), 10) + 1 : 1;
    return prefix + String(num).padStart(pad, '0');
  }

  async function refreshCourseStatus(pool, courseId) {
    const today = await mysqlToday(pool);
    const [[c]] = await pool.query('SELECT * FROM training_courses WHERE course_id=?', [courseId]);
    if (!c || c.status === '草稿') return;
    let status = c.status;
    if (c.end_date < today) status = '已完成';
    else if (c.start_date <= today && c.end_date >= today) status = '进行中';
    else if (c.start_date > today && ['报名中', '未开始'].includes(c.status)) status = '报名中';
    if (status !== c.status) {
      await pool.query('UPDATE training_courses SET status=? WHERE course_id=?', [status, courseId]);
    }
  }

  async function refreshAllCourseStatus(pool) {
    const [rows] = await pool.query("SELECT course_id FROM training_courses WHERE status<>'草稿'");
    for (const r of rows) await refreshCourseStatus(pool, r.course_id);
  }

  function courseRow(r, enrollCount) {
    return {
      course_id: r.course_id,
      title: r.title,
      content: r.content || '',
      train_type: r.train_type || '内部培训',
      trainer: r.trainer || '',
      start_date: fmtDate(r.start_date),
      end_date: fmtDate(r.end_date),
      location: r.location || '',
      notice: r.notice || '',
      capacity: r.capacity || 0,
      enroll_count: enrollCount != null ? enrollCount : (r.enroll_count || 0),
      status: r.status,
      publisher: r.publisher || '',
      published_at: r.published_at
    };
  }

  function needRow(r) {
    return {
      need_id: r.need_id,
      department_id: r.department_id,
      department_name: r.department_name || '',
      theme: r.theme,
      goal: r.goal || '',
      headcount: r.headcount || 0,
      submitter: r.submitter || '',
      status: r.status,
      summary_id: r.summary_id || '',
      created_at: r.created_at
    };
  }

  pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci").catch(() => {});

  /** 拒绝已损坏的占位文本（库中曾出现 PowerShell 错误编码写入的 ???） */
  function hasBadUtf8(s) {
    if (s == null || s === '') return false;
    const t = String(s).trim();
    if (/^\?+$/.test(t)) return true;
    if (t.length >= 3 && (t.match(/\?/g) || []).length >= Math.ceil(t.length * 0.5)) return true;
    return false;
  }

  async function ensureTrainingResultSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        result_id VARCHAR(20) NOT NULL UNIQUE,
        course_id VARCHAR(20) NOT NULL,
        emp_id VARCHAR(10) NOT NULL,
        name VARCHAR(30) DEFAULT '',
        result_status VARCHAR(20) DEFAULT '待评定',
        score DECIMAL(5,2) DEFAULT NULL,
        certificate VARCHAR(100) DEFAULT '',
        feedback VARCHAR(500) DEFAULT '',
        evaluator VARCHAR(30) DEFAULT '',
        evaluated_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_course_emp_result (course_id, emp_id),
        KEY idx_course (course_id),
        KEY idx_emp (emp_id),
        KEY idx_status (result_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  ensureTrainingSchema().then(() => ensureTrainingResultSchema()).catch(() => {});

  // ========== 1.1 培训需求（部门主管提交 / HR 汇总） ==========
  app.post('/api/training/need', async (req, res) => {
    try {
      const { operator, theme, goal, headcount } = req.body;
      const emp = await getEmployee(operator);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (!isManager(emp) && !isHR(emp, operator)) {
        return send(res, { success: false, error: '仅部门主管可发起培训需求' });
      }
      if (!theme) return send(res, { success: false, error: '请填写培训主题' });
      if (hasBadUtf8(theme) || hasBadUtf8(goal)) {
        return send(res, { success: false, error: '培训主题编码异常，请刷新页面后重试' });
      }

      const need_id = await nextId(pool, 'training_needs', 'need_id', 'TN', 4);
      await pool.query(`
        INSERT INTO training_needs (need_id, department_id, department_name, theme, goal, headcount, submitter, status)
        VALUES (?,?,?,?,?,?,?, '待汇总')`,
        [need_id, emp.department_id, emp.department || '', theme, goal || '',
          parseInt(headcount, 10) || 0, emp.name || operator]);

      await logOp(operator, emp.emp_id, '培训需求', need_id);
      send(res, { success: true, need_id, message: '培训需求已提交，等待 HR 汇总' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/need/query', async (req, res) => {
    try {
      const { operator, status, department_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp && operator !== 'root') return send(res, { success: false, error: '用户不存在' });

      let sql = 'SELECT * FROM training_needs WHERE 1=1';
      const params = [];
      if (!isHR(emp, operator) && operator !== 'root') {
        if (isManager(emp)) {
          sql += ' AND department_id=?';
          params.push(emp.department_id);
        } else {
          return send(res, { success: true, data: [] });
        }
      } else if (department_id) {
        sql += ' AND department_id=?';
        params.push(department_id);
      }
      if (status) { sql += ' AND status=?'; params.push(status); }
      sql += ' ORDER BY created_at DESC LIMIT 200';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(needRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/need/summarize', async (req, res) => {
    try {
      const { operator, need_ids } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可汇总培训需求' });
      if (!need_ids?.length) return send(res, { success: false, error: '请选择要汇总的需求' });

      const summary_id = 'TS' + fmtDate(new Date()).replace(/-/g, '') +
        String(Math.floor(Math.random() * 900) + 100);
      const placeholders = need_ids.map(() => '?').join(',');
      await pool.query(
        `UPDATE training_needs SET status='已汇总', summary_id=? WHERE need_id IN (${placeholders}) AND status='待汇总'`,
        [summary_id, ...need_ids]);

      await logOp(operator, '', '汇总培训需求', summary_id);
      send(res, { success: true, summary_id, message: `已汇总 ${need_ids.length} 条需求` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 1.2 培训项目 D1 ==========
  app.post('/api/training/course', async (req, res) => {
    try {
      const { operator, title, content, train_type, trainer, start_date, end_date, location, notice, capacity } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可创建培训课程' });
      if (!title || !start_date || !end_date) return send(res, { success: false, error: '请填写课程名称与日期' });
      if (hasBadUtf8(title) || hasBadUtf8(trainer) || hasBadUtf8(content) || hasBadUtf8(notice)) {
        return send(res, { success: false, error: '课程名称或讲师含非法字符，请用浏览器页面重新提交（勿用错误编码的接口工具）' });
      }
      if (end_date < start_date) return send(res, { success: false, error: '结束日期不能早于开始日期' });

      const course_id = await nextId(pool, 'training_courses', 'course_id', 'T', 4);
      await pool.query(`
        INSERT INTO training_courses
        (course_id, title, content, train_type, trainer, start_date, end_date, location, notice, capacity, status, publisher)
        VALUES (?,?,?,?,?,?,?,?,?,?, '草稿', ?)`,
        [course_id, title, content || '', TRAIN_TYPES.includes(train_type) ? train_type : '内部培训',
          trainer || '', start_date, end_date, location || '', notice || '',
          parseInt(capacity, 10) || 50, operator]);

      await logOp(operator, '', '创建培训课程', course_id);
      send(res, { success: true, course_id, message: '课程已创建，请发布后员工可报名' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/training/course/:course_id', async (req, res) => {
    try {
      const { operator } = req.body;
      const course_id = req.params.course_id;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可编辑课程' });

      const [[c]] = await pool.query('SELECT * FROM training_courses WHERE course_id=?', [course_id]);
      if (!c) return send(res, { success: false, error: '课程不存在' });
      if (c.status === '已完成') return send(res, { success: false, error: '已完成的课程不可编辑' });

      const b = req.body;
      await pool.query(`
        UPDATE training_courses SET title=?, content=?, train_type=?, trainer=?,
          start_date=?, end_date=?, location=?, notice=?, capacity=?
        WHERE course_id=?`,
        [b.title || c.title, b.content ?? c.content, b.train_type || c.train_type,
          b.trainer ?? c.trainer, b.start_date || c.start_date, b.end_date || c.end_date,
          b.location ?? c.location, b.notice ?? c.notice,
          parseInt(b.capacity, 10) || c.capacity, course_id]);

      await refreshCourseStatus(pool, course_id);
      send(res, { success: true, message: '课程已更新' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/course/publish', async (req, res) => {
    try {
      const { operator, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可发布培训' });

      const [[c]] = await pool.query('SELECT * FROM training_courses WHERE course_id=?', [course_id]);
      if (!c) return send(res, { success: false, error: '课程不存在' });

      const today = await mysqlToday(pool);
      let status = '报名中';
      if (c.end_date < today) status = '已完成';
      else if (c.start_date <= today) status = '进行中';

      await pool.query(
        `UPDATE training_courses SET status=?, publisher=?, published_at=NOW() WHERE course_id=?`,
        [status, operator, course_id]);

      await logOp(operator, '', '发布培训', course_id);
      send(res, { success: true, message: '培训已发布，员工可查看并报名' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/course/query', async (req, res) => {
    try {
      const { operator, status, train_type, keyword, enrollable_only } = req.body;
      const emp = await getEmployee(operator);
      await refreshAllCourseStatus(pool);

      let sql = `
        SELECT c.*, (SELECT COUNT(*) FROM training_enrollments e
          WHERE e.course_id=c.course_id AND e.status='已报名') AS enroll_count
        FROM training_courses c WHERE 1=1`;
      const params = [];

      if (enrollable_only) {
        sql += " AND c.status IN ('报名中','进行中','未开始')";
      }
      if (!isHR(emp, operator) && operator !== 'root') {
        sql += " AND c.status<>'草稿'";
      }
      if (status) { sql += ' AND c.status=?'; params.push(status); }
      if (train_type) { sql += ' AND c.train_type=?'; params.push(train_type); }
      if (keyword) {
        sql += ' AND (c.title LIKE ? OR c.course_id LIKE ? OR c.trainer LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY c.start_date DESC LIMIT 300';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(r => courseRow(r, r.enroll_count)) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.delete('/api/training/course/:course_id', async (req, res) => {
    try {
      const { operator } = req.query;
      const course_id = req.params.course_id;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator)) return send(res, { success: false, error: '仅 HR 可删除课程' });

      const [[c]] = await pool.query('SELECT status FROM training_courses WHERE course_id=?', [course_id]);
      if (!c) return send(res, { success: false, error: '课程不存在' });
      if (c.status !== '草稿') return send(res, { success: false, error: '仅可删除草稿课程' });

      await pool.query('DELETE FROM training_courses WHERE course_id=?', [course_id]);
      send(res, { success: true, message: '草稿课程已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 1.3 培训报名 D2 ==========
  app.get('/api/training/my', async (req, res) => {
    try {
      const { username } = req.query;
      const emp = await getEmployee(username);
      if (!emp) return send(res, { success: false, error: '用户不存在' });

      const [enrolls] = await pool.query(`
        SELECT e.*, c.title, c.start_date, c.end_date, c.location, c.status AS course_status, c.trainer
        FROM training_enrollments e
        JOIN training_courses c ON e.course_id=c.course_id
        WHERE e.emp_id=? AND e.status='已报名'
        ORDER BY e.enrolled_at DESC`, [emp.emp_id]);

      const [attended] = await pool.query(`
        SELECT a.course_id, a.check_status, a.check_time, c.title
        FROM training_attendance a
        JOIN training_courses c ON a.course_id=c.course_id
        WHERE a.emp_id=? ORDER BY a.check_time DESC LIMIT 20`, [emp.emp_id]);

      send(res, {
        success: true,
        enrollments: enrolls.map(r => ({
          enroll_id: r.enroll_id,
          course_id: r.course_id,
          title: r.title,
          start_date: fmtDate(r.start_date),
          end_date: fmtDate(r.end_date),
          location: r.location,
          trainer: r.trainer,
          course_status: r.course_status,
          enrolled_at: r.enrolled_at
        })),
        attendance: attended
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/enroll', async (req, res) => {
    try {
      const { operator, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp) return send(res, { success: false, error: '用户不存在' });
      if (emp.emp_status === '已离职') return send(res, { success: false, error: '已离职员工不可报名' });

      const [[c]] = await pool.query('SELECT * FROM training_courses WHERE course_id=?', [course_id]);
      if (!c) return send(res, { success: false, error: '课程不存在' });
      if (c.status === '草稿') return send(res, { success: false, error: '课程尚未发布' });
      if (c.status === '已完成') return send(res, { success: false, error: '课程已结束，无法报名' });

      const today = await mysqlToday(pool);
      if (c.end_date < today) return send(res, { success: false, error: '课程已结束' });

      const [[ex]] = await pool.query(
        `SELECT enroll_id, status FROM training_enrollments WHERE course_id=? AND emp_id=?`,
        [course_id, emp.emp_id]);
      if (ex?.status === '已报名') {
        return send(res, { success: false, error: '您已报名该课程' });
      }

      const [[cnt]] = await pool.query(
        `SELECT COUNT(*) AS v FROM training_enrollments WHERE course_id=? AND status='已报名'`,
        [course_id]);
      if (cnt.v >= c.capacity) return send(res, { success: false, error: '培训名额已满' });

      const enroll_id = await nextId(pool, 'training_enrollments', 'enroll_id', 'TE', 4);
      if (ex) {
        await pool.query(
          `UPDATE training_enrollments SET status='已报名', enroll_id=?, name=?, department=?, enrolled_at=NOW()
           WHERE course_id=? AND emp_id=?`,
          [enroll_id, emp.name, emp.department, course_id, emp.emp_id]);
      } else {
        await pool.query(`
          INSERT INTO training_enrollments (enroll_id, course_id, emp_id, name, department, status)
          VALUES (?,?,?,?,?, '已报名')`,
          [enroll_id, course_id, emp.emp_id, emp.name, emp.department || '']);
      }

      await logOp(operator, emp.emp_id, '培训报名', course_id);
      send(res, { success: true, enroll_id, message: '报名成功' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/enroll/cancel', async (req, res) => {
    try {
      const { operator, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp) return send(res, { success: false, error: '用户不存在' });

      const [[row]] = await pool.query(
        `SELECT * FROM training_enrollments WHERE course_id=? AND emp_id=? AND status='已报名'`,
        [course_id, emp.emp_id]);
      if (!row) return send(res, { success: false, error: '未找到报名记录' });

      const [[c]] = await pool.query('SELECT start_date, status FROM training_courses WHERE course_id=?', [course_id]);
      const today = await mysqlToday(pool);
      if (c && c.start_date <= today && c.status === '进行中') {
        return send(res, { success: false, error: '培训进行中，不可取消报名' });
      }

      await pool.query(
        `UPDATE training_enrollments SET status='已取消' WHERE course_id=? AND emp_id=?`,
        [course_id, emp.emp_id]);
      send(res, { success: true, message: '已取消报名' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 1.4 培训签到 D4 ==========
  app.post('/api/training/checkin', async (req, res) => {
    try {
      const { operator, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!emp) return send(res, { success: false, error: '用户不存在' });

      const [[en]] = await pool.query(
        `SELECT enroll_id FROM training_enrollments WHERE course_id=? AND emp_id=? AND status='已报名'`,
        [course_id, emp.emp_id]);
      if (!en) return send(res, { success: false, error: '请先报名该培训' });

      const [[c]] = await pool.query('SELECT * FROM training_courses WHERE course_id=?', [course_id]);
      if (!c) return send(res, { success: false, error: '课程不存在' });

      const today = await mysqlToday(pool);
      if (today < c.start_date) return send(res, { success: false, error: '培训尚未开始，无法签到' });
      if (today > c.end_date) return send(res, { success: false, error: '培训已结束' });

      const [[exAtt]] = await pool.query(
        'SELECT att_id FROM training_attendance WHERE course_id=? AND emp_id=?',
        [course_id, emp.emp_id]);
      if (exAtt) return send(res, { success: false, error: '今日已签到' });

      const now = new Date();
      const hour = now.getHours();
      const check_status = (today === fmtDate(c.start_date) && hour >= 10) ? '迟到' : '已签到';

      const att_id = await nextId(pool, 'training_attendance', 'att_id', 'TA', 4);
      await pool.query(`
        INSERT INTO training_attendance (att_id, course_id, emp_id, name, check_status)
        VALUES (?,?,?,?,?)`,
        [att_id, course_id, emp.emp_id, emp.name, check_status]);

      await logOp(operator, emp.emp_id, '培训签到', `${course_id} ${check_status}`);
      send(res, { success: true, att_id, check_status, message: `签到成功（${check_status}）` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 1.5 培训考勤查询 ==========
  app.post('/api/training/attendance/query', async (req, res) => {
    try {
      const { operator, course_id, keyword } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator) && !isManager(emp) && operator !== 'root') {
        return send(res, { success: false, error: '无权限查看培训考勤' });
      }

      let sql = `
        SELECT a.*, c.title AS course_title, c.start_date, c.end_date,
          d.name AS emp_department,
          en.status AS enroll_status
        FROM training_attendance a
        JOIN training_courses c ON a.course_id=c.course_id
        JOIN employees e ON a.emp_id=e.emp_id
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN training_enrollments en ON en.course_id=a.course_id AND en.emp_id=a.emp_id
        WHERE 1=1`;
      const params = [];

      if (isManager(emp) && !isHR(emp, operator)) {
        sql += ' AND e.department_id=?';
        params.push(emp.department_id);
      }
      if (course_id) { sql += ' AND a.course_id=?'; params.push(course_id); }
      if (keyword) {
        sql += ' AND (a.name LIKE ? OR a.emp_id LIKE ? OR c.title LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY a.check_time DESC LIMIT 500';
      const [rows] = await pool.query(sql, params);

      const data = rows.map(r => ({
        att_id: r.att_id,
        course_id: r.course_id,
        course_title: r.course_title,
        emp_id: r.emp_id,
        name: r.name,
        department: r.emp_department,
        check_time: r.check_time,
        check_status: r.check_status,
        enroll_status: r.enroll_status || ''
      }));

      send(res, { success: true, data });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/enroll/list', async (req, res) => {
    try {
      const { operator, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator) && !isManager(emp) && operator !== 'root') {
        return send(res, { success: false, error: '无权限' });
      }

      let sql = `
        SELECT en.*, e.department_id
        FROM training_enrollments en
        JOIN employees e ON en.emp_id=e.emp_id
        WHERE en.course_id=? AND en.status='已报名'`;
      const params = [course_id];
      if (isManager(emp) && !isHR(emp, operator)) {
        sql += ' AND e.department_id=?';
        params.push(emp.department_id);
      }
      sql += ' ORDER BY en.enrolled_at';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 统计与导出 ==========
  app.post('/api/training/result/query', async (req, res) => {
    try {
      await ensureTrainingResultSchema();
      const { operator, course_id, keyword, result_status } = req.body;
      const emp = await getEmployee(operator);
      const admin = isHR(emp, operator) || operator === 'root';
      const manager = isManager(emp);
      if (!admin && !manager && !emp) {
        return send(res, { success: false, error: '用户不存在' });
      }

      let sql = `
        SELECT en.course_id, c.title AS course_title, en.emp_id, en.name,
               d.name AS department, en.status AS enroll_status,
               a.check_status, a.check_time,
               r.result_id, r.result_status, r.score, r.certificate, r.feedback,
               r.evaluator, r.evaluated_at
        FROM training_enrollments en
        JOIN training_courses c ON en.course_id=c.course_id
        JOIN employees e ON en.emp_id=e.emp_id
        LEFT JOIN departments d ON e.department_id=d.id
        LEFT JOIN training_attendance a ON a.course_id=en.course_id AND a.emp_id=en.emp_id
        LEFT JOIN training_results r ON r.course_id=en.course_id AND r.emp_id=en.emp_id
        WHERE en.status='已报名'`;
      const params = [];
      if (admin) {
        // HR/root can view all training outcomes.
      } else if (manager) {
        sql += ' AND e.department_id=?';
        params.push(emp.department_id);
      } else {
        sql += ' AND en.emp_id=?';
        params.push(emp.emp_id);
      }
      if (course_id) { sql += ' AND en.course_id=?'; params.push(course_id); }
      if (result_status) { sql += ' AND COALESCE(r.result_status, ?) = ?'; params.push('待评定', result_status); }
      if (keyword) {
        sql += ' AND (en.name LIKE ? OR en.emp_id LIKE ? OR c.title LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY c.start_date DESC, en.emp_id LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(r => ({
        course_id: r.course_id,
        course_title: r.course_title,
        emp_id: r.emp_id,
        name: r.name,
        department: r.department || '',
        enroll_status: r.enroll_status || '',
        check_status: r.check_status || '未签到',
        check_time: r.check_time,
        result_id: r.result_id || '',
        result_status: r.result_status || '待评定',
        score: r.score,
        certificate: r.certificate || '',
        feedback: r.feedback || '',
        evaluator: r.evaluator || '',
        evaluated_at: r.evaluated_at
      })) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/result/save', async (req, res) => {
    try {
      await ensureTrainingResultSchema();
      const { operator, course_id, emp_id, result_status, score, certificate, feedback } = req.body;
      const op = await getEmployee(operator);
      if (!isHR(op, operator) && !isManager(op) && operator !== 'root') {
        return send(res, { success: false, error: '无权维护培训成果' });
      }
      if (!course_id || !emp_id) return send(res, { success: false, error: '课程和员工不能为空' });
      const [[enroll]] = await pool.query(`
        SELECT en.*, e.department_id
        FROM training_enrollments en
        JOIN employees e ON en.emp_id=e.emp_id
        WHERE en.course_id=? AND en.emp_id=? AND en.status='已报名' LIMIT 1`, [course_id, emp_id]);
      if (!enroll) return send(res, { success: false, error: '该员工未报名该课程，不能登记成果' });
      if (isManager(op) && !isHR(op, operator) && enroll.department_id !== op.department_id) {
        return send(res, { success: false, error: '部门主管仅可维护本部门员工培训成果' });
      }
      if (!['待评定', '合格', '不合格', '优秀'].includes(result_status || '')) {
        return send(res, { success: false, error: '成果状态无效' });
      }
      const scoreVal = score === '' || score == null ? null : Number(score);
      if (scoreVal != null && (Number.isNaN(scoreVal) || scoreVal < 0 || scoreVal > 100)) {
        return send(res, { success: false, error: '成绩必须在 0-100 之间' });
      }
      const [[ex]] = await pool.query('SELECT result_id FROM training_results WHERE course_id=? AND emp_id=?', [course_id, emp_id]);
      const result_id = ex?.result_id || await nextId(pool, 'training_results', 'result_id', 'TR', 4);
      await pool.query(`
        INSERT INTO training_results
          (result_id, course_id, emp_id, name, result_status, score, certificate, feedback, evaluator, evaluated_at)
        VALUES (?,?,?,?,?,?,?,?,?,NOW())
        ON DUPLICATE KEY UPDATE
          result_status=VALUES(result_status), score=VALUES(score), certificate=VALUES(certificate),
          feedback=VALUES(feedback), evaluator=VALUES(evaluator), evaluated_at=NOW()`,
        [result_id, course_id, emp_id, enroll.name || '', result_status, scoreVal,
         certificate || '', feedback || '', op?.emp_id || operator || 'ADMIN']);
      await logOp(operator || '', emp_id, '培训成果登记', `${course_id}:${result_status}`);
      send(res, { success: true, result_id, message: '培训成果已保存' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/summary', async (req, res) => {
    try {
      await refreshAllCourseStatus(pool);
      const [[courses]] = await pool.query('SELECT COUNT(*) AS v FROM training_courses WHERE status<>\'草稿\'');
      const [[enrolls]] = await pool.query(
        `SELECT COUNT(*) AS v FROM training_enrollments WHERE status='已报名'`);
      const [[done]] = await pool.query(
        `SELECT COUNT(*) AS v FROM training_courses WHERE status='已完成'`);
      const [[pendingNeeds]] = await pool.query(
        `SELECT COUNT(*) AS v FROM training_needs WHERE status='待汇总'`);

      send(res, {
        success: true,
        data: {
          course_total: courses.v,
          enroll_total: enrolls.v,
          course_done: done.v,
          need_pending: pendingNeeds.v
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/training/export', async (req, res) => {
    try {
      const { operator, type, course_id } = req.body;
      const emp = await getEmployee(operator);
      if (!isHR(emp, operator) && !isManager(emp) && operator !== 'root') {
        return send(res, { success: false, error: '无权限导出' });
      }

      if (type === 'attendance') {
        const body = { operator, course_id, keyword: null };
        req.body = body;
        const [rows] = await pool.query(`
          SELECT a.att_id, a.course_id, c.title, a.emp_id, a.name, a.check_time, a.check_status
          FROM training_attendance a
          JOIN training_courses c ON a.course_id=c.course_id
          ${course_id ? 'WHERE a.course_id=?' : ''}
          ORDER BY a.check_time DESC`, course_id ? [course_id] : []);
        const header = '考勤编号,培训编号,课程,工号,姓名,签到时间,状态\n';
        const csv = header + rows.map(r =>
          [r.att_id, r.course_id, r.title, r.emp_id, r.name, r.check_time, r.check_status]
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=training_attendance.csv');
        return res.send('\uFEFF' + csv);
      }

      const [rows] = await pool.query(`
        SELECT c.*, (SELECT COUNT(*) FROM training_enrollments e WHERE e.course_id=c.course_id AND e.status='已报名') AS ec
        FROM training_courses c WHERE c.status<>'草稿' ORDER BY c.start_date DESC`);
      const header = '课程编号,名称,类型,讲师,开始,结束,地点,名额,报名数,状态\n';
      const csv = header + rows.map(r =>
        [r.course_id, r.title, r.train_type, r.trainer, fmtDate(r.start_date), fmtDate(r.end_date),
          r.location, r.capacity, r.ec, r.status]
          .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=training_courses.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
