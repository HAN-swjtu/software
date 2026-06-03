// 招聘管理模块 API - 文档 3.3.7（P1~P5 / D1~D7）
const fs = require('fs');
const path = require('path');

module.exports = function (app, pool, send) {

  async function ensureRecruitSchema() {
    try {
      const [[t]] = await pool.query(
        "SELECT COUNT(*) AS v FROM information_schema.TABLES WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='recruit_jobs'");
      if (!t.v) {
        const sql = fs.readFileSync(path.join(__dirname, 'recruit-migrate.sql'), 'utf8');
        for (const stmt of sql.split(';')) {
          const s = stmt.trim();
          if (s && !s.startsWith('--') && s.toUpperCase().startsWith('CREATE')) {
            try { await pool.query(s); } catch (e) { /* ignore */ }
          }
        }
      }
    } catch (e) { console.warn('招聘表迁移:', e.message); }
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

  function isRecruiter(emp) {
    return emp?.role_id === 4;
  }

  function isManager(emp) {
    return emp?.role_id === 2;
  }

  function canManageRecruit(emp, username) {
    return isHR(emp, username) || isRecruiter(emp);
  }

  function fmtDate(val) {
    if (!val) return '';
    const s = String(val);
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  }

  function checkText(fields) {
    for (const [label, val] of fields) {
      if (val != null && val !== '' && hasBadUtf8(val)) {
        return `${label}含乱码占位符，请刷新页面后重新输入`;
      }
    }
    return null;
  }

  function hasBadUtf8(s) {
    if (s == null || s === '') return false;
    const t = String(s).trim();
    if (/^\?+$/.test(t)) return true;
    if (t.length >= 3 && (t.match(/\?/g) || []).length >= Math.ceil(t.length * 0.5)) return true;
    return false;
  }

  async function nextId(pool, table, col, prefix, pad) {
    const [[maxRow]] = await pool.query(`SELECT ${col} AS v FROM ${table} ORDER BY id DESC LIMIT 1`);
    let num = maxRow?.v ? parseInt(String(maxRow.v).replace(/\D/g, ''), 10) + 1 : 1;
    return prefix + String(num).padStart(pad, '0');
  }

  async function getDeptName(pool, departmentId) {
    const [[d]] = await pool.query('SELECT name FROM departments WHERE id=?', [departmentId]);
    return d?.name || '';
  }

  function jobRow(r) {
    return {
      job_id: r.job_id,
      demand_id: r.demand_id || '',
      department_id: r.department_id,
      department: r.department || '',
      title: r.title,
      job_duties: r.job_duties || '',
      job_requirements: r.job_requirements || '',
      salary_range: r.salary_range || '',
      location: r.location || '',
      headcount: r.headcount || 1,
      deadline: fmtDate(r.deadline),
      status: r.status,
      resume_count: r.resume_count || 0,
      published_at: r.published_at,
      publisher: r.publisher || ''
    };
  }

  function resumeRow(r) {
    return {
      resume_id: r.resume_id,
      job_id: r.job_id,
      job_title: r.job_title || '',
      name: r.name,
      phone: r.phone || '',
      email: r.email || '',
      education: r.education || '',
      work_experience: r.work_experience || '',
      project_experience: r.project_experience || '',
      expected_salary: r.expected_salary || '',
      screen_status: r.screen_status,
      screen_comment: r.screen_comment || '',
      applied_at: r.applied_at,
      screened_at: r.screened_at
    };
  }

  pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci").catch(() => {});
  ensureRecruitSchema();

  // ========== P1 岗位发布 ==========
  app.post('/api/recruit/job', async (req, res) => {
    try {
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!canManageRecruit(emp, b.operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可发布岗位' });
      }
      const err = checkText([
        ['岗位名称', b.title], ['职责', b.job_duties], ['要求', b.job_requirements],
        ['薪资', b.salary_range], ['地点', b.location]
      ]);
      if (err) return send(res, { success: false, error: err });
      if (!b.title || !b.department_id) {
        return send(res, { success: false, error: '请填写岗位名称与部门' });
      }

      const job_id = await nextId(pool, 'recruit_jobs', 'job_id', 'R', 4);
      await pool.query(`
        INSERT INTO recruit_jobs
        (job_id, demand_id, department_id, title, job_duties, job_requirements, salary_range, location, headcount, deadline, status, publisher)
        VALUES (?,?,?,?,?,?,?,?,?,?, '草稿', ?)`,
        [job_id, b.demand_id || '', b.department_id, b.title, b.job_duties || '',
          b.job_requirements || '', b.salary_range || '', b.location || '',
          parseInt(b.headcount, 10) || 1, b.deadline || null, b.operator]);

      if (b.demand_id) {
        await pool.query("UPDATE recruit_demands SET status='已立项' WHERE demand_id=?", [b.demand_id]);
      }
      await logOp(b.operator, emp?.emp_id, '创建招聘岗位', job_id);
      send(res, { success: true, job_id, message: '岗位已创建，请发布后对外展示' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.put('/api/recruit/job/:job_id', async (req, res) => {
    try {
      const job_id = req.params.job_id;
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!canManageRecruit(emp, b.operator)) return send(res, { success: false, error: '无权限' });
      const err = checkText([
        ['岗位名称', b.title], ['职责', b.job_duties], ['要求', b.job_requirements]
      ]);
      if (err) return send(res, { success: false, error: err });

      const [[j]] = await pool.query('SELECT status FROM recruit_jobs WHERE job_id=?', [job_id]);
      if (!j) return send(res, { success: false, error: '岗位不存在' });

      await pool.query(`
        UPDATE recruit_jobs SET title=?, job_duties=?, job_requirements=?, salary_range=?,
          location=?, headcount=?, deadline=?, department_id=?
        WHERE job_id=?`,
        [b.title, b.job_duties || '', b.job_requirements || '', b.salary_range || '',
          b.location || '', parseInt(b.headcount, 10) || 1, b.deadline || null,
          b.department_id, job_id]);
      send(res, { success: true, message: '岗位已更新' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/job/publish', async (req, res) => {
    try {
      const { operator, job_id } = req.body;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator)) return send(res, { success: false, error: '无权限' });
      const [[j]] = await pool.query('SELECT * FROM recruit_jobs WHERE job_id=?', [job_id]);
      if (!j) return send(res, { success: false, error: '岗位不存在' });
      await pool.query(
        `UPDATE recruit_jobs SET status='招聘中', publisher=?, published_at=NOW() WHERE job_id=?`,
        [operator, job_id]);
      await logOp(operator, emp?.emp_id, '发布招聘岗位', job_id);
      send(res, { success: true, message: '岗位已发布，候选人可投递简历' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/job/query', async (req, res) => {
    try {
      const { operator, status, department_id, keyword } = req.body;
      const emp = await getEmployee(operator);
      let sql = `
        SELECT j.*, d.name AS department,
          (SELECT COUNT(*) FROM recruit_resumes r WHERE r.job_id=j.job_id) AS resume_count
        FROM recruit_jobs j
        LEFT JOIN departments d ON j.department_id=d.id
        WHERE 1=1`;
      const params = [];
      if (!canManageRecruit(emp, operator) && operator !== 'root') {
        if (isManager(emp)) {
          sql += ' AND j.department_id=?';
          params.push(emp.department_id);
        } else {
          sql += " AND j.status='招聘中'";
        }
      }
      if (status) { sql += ' AND j.status=?'; params.push(status); }
      if (department_id) { sql += ' AND j.department_id=?'; params.push(department_id); }
      if (keyword) {
        sql += ' AND (j.title LIKE ? OR j.job_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      sql += ' ORDER BY j.published_at DESC, j.created_at DESC LIMIT 300';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(jobRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.get('/api/recruit/jobs/public', async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT j.job_id, j.title, d.name AS department, j.salary_range, j.location,
          j.deadline, j.job_duties, j.job_requirements
        FROM recruit_jobs j
        LEFT JOIN departments d ON j.department_id=d.id
        WHERE j.status='招聘中'
        ORDER BY j.published_at DESC`);
      send(res, {
        success: true,
        data: rows.map(r => ({
          job_id: r.job_id,
          title: r.title,
          department: r.department,
          salary_range: r.salary_range,
          location: r.location,
          deadline: fmtDate(r.deadline),
          job_duties: r.job_duties,
          job_requirements: r.job_requirements
        }))
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.delete('/api/recruit/job/:job_id', async (req, res) => {
    try {
      const { operator } = req.query;
      const job_id = req.params.job_id;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator)) return send(res, { success: false, error: '无权限' });
      const [[j]] = await pool.query('SELECT status FROM recruit_jobs WHERE job_id=?', [job_id]);
      if (!j) return send(res, { success: false, error: '岗位不存在' });
      if (j.status !== '草稿') return send(res, { success: false, error: '仅可删除草稿岗位' });
      await pool.query('DELETE FROM recruit_jobs WHERE job_id=?', [job_id]);
      send(res, { success: true, message: '已删除' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P2 简历 ==========
  app.post('/api/recruit/resume/apply', async (req, res) => {
    try {
      const b = req.body;
      const err = checkText([
        ['姓名', b.name], ['学历', b.education], ['工作经历', b.work_experience]
      ]);
      if (err) return send(res, { success: false, error: err });
      if (!b.job_id || !b.name) return send(res, { success: false, error: '请选择岗位并填写姓名' });

      const [[j]] = await pool.query("SELECT * FROM recruit_jobs WHERE job_id=? AND status='招聘中'", [b.job_id]);
      if (!j) return send(res, { success: false, error: '岗位不存在或已停止招聘' });

      const resume_id = await nextId(pool, 'recruit_resumes', 'resume_id', 'CV', 4);
      await pool.query(`
        INSERT INTO recruit_resumes
        (resume_id, job_id, name, phone, email, education, work_experience, project_experience, expected_salary, screen_status)
        VALUES (?,?,?,?,?,?,?,?,?, '待筛选')`,
        [resume_id, b.job_id, b.name, b.phone || '', b.email || '', b.education || '',
          b.work_experience || '', b.project_experience || '', b.expected_salary || '']);

      send(res, { success: true, resume_id, message: '简历投递成功，请等待筛选结果' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/resume/query', async (req, res) => {
    try {
      const { operator, job_id, screen_status, keyword } = req.body;
      const emp = await getEmployee(operator);
      let sql = `
        SELECT r.*, j.title AS job_title, j.department_id
        FROM recruit_resumes r
        JOIN recruit_jobs j ON r.job_id=j.job_id
        WHERE 1=1`;
      const params = [];
      if (isManager(emp) && !canManageRecruit(emp, operator) && operator !== 'root') {
        sql += ' AND j.department_id=?';
        params.push(emp.department_id);
      }
      if (job_id) { sql += ' AND r.job_id=?'; params.push(job_id); }
      if (screen_status) { sql += ' AND r.screen_status=?'; params.push(screen_status); }
      if (keyword) {
        sql += ' AND (r.name LIKE ? OR r.phone LIKE ? OR r.resume_id LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      if (!canManageRecruit(emp, operator) && !isManager(emp) && operator !== 'root') {
        return send(res, { success: false, error: '无权限' });
      }
      sql += ' ORDER BY r.applied_at DESC LIMIT 500';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows.map(resumeRow) });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/resume/screen', async (req, res) => {
    try {
      const { operator, resume_id, action, comment } = req.body;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可筛选简历' });
      }
      const status = action === 'pass' ? '通过' : '未通过';
      const [[r]] = await pool.query('SELECT * FROM recruit_resumes WHERE resume_id=?', [resume_id]);
      if (!r) return send(res, { success: false, error: '简历不存在' });

      await pool.query(`
        UPDATE recruit_resumes SET screen_status=?, screen_comment=?, screened_by=?, screened_at=NOW()
        WHERE resume_id=?`, [status, comment || '', operator, resume_id]);

      await logOp(operator, emp?.emp_id, '简历筛选', `${resume_id} ${status}`);
      send(res, { success: true, message: `已标记为「${status}」` });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P3 面试 ==========
  app.post('/api/recruit/interview', async (req, res) => {
    try {
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!canManageRecruit(emp, b.operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可安排面试' });
      }
      const err = checkText([['地点', b.location]]);
      if (err) return send(res, { success: false, error: err });

      const [[r]] = await pool.query("SELECT * FROM recruit_resumes WHERE resume_id=? AND screen_status='通过'", [b.resume_id]);
      if (!r) return send(res, { success: false, error: '简历不存在或未通过筛选' });

      const interview_id = await nextId(pool, 'recruit_interviews', 'interview_id', 'IV', 4);
      let interviewerName = b.interviewer_name || '';
      if (b.interviewer_emp_id) {
        const [[ie]] = await pool.query('SELECT name FROM employees WHERE emp_id=?', [b.interviewer_emp_id]);
        interviewerName = ie?.name || interviewerName;
      }

      await pool.query(`
        INSERT INTO recruit_interviews
        (interview_id, resume_id, interviewer_emp_id, interviewer_name, round_num, interview_time, location, created_by)
        VALUES (?,?,?,?,?,?,?,?)`,
        [interview_id, b.resume_id, b.interviewer_emp_id || '', interviewerName,
          parseInt(b.round_num, 10) || 1, b.interview_time, b.location || '', b.operator]);

      await logOp(b.operator, emp?.emp_id, '安排面试', interview_id);
      send(res, { success: true, interview_id, message: '面试已安排并通知候选人' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/interview/query', async (req, res) => {
    try {
      const { operator, resume_id, job_id } = req.body;
      const emp = await getEmployee(operator);
      let sql = `
        SELECT iv.*, r.name AS candidate_name, r.job_id, j.title AS job_title, j.department_id
        FROM recruit_interviews iv
        JOIN recruit_resumes r ON iv.resume_id=r.resume_id
        JOIN recruit_jobs j ON r.job_id=j.job_id
        WHERE 1=1`;
      const params = [];
      if (isManager(emp) && !canManageRecruit(emp, operator) && operator !== 'root') {
        sql += ' AND (j.department_id=? OR iv.interviewer_emp_id=?)';
        params.push(emp.department_id, emp.emp_id);
      }
      if (resume_id) { sql += ' AND iv.resume_id=?'; params.push(resume_id); }
      if (job_id) { sql += ' AND r.job_id=?'; params.push(job_id); }
      sql += ' ORDER BY iv.interview_time DESC LIMIT 300';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/interview/eval', async (req, res) => {
    try {
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!emp && b.operator !== 'root') return send(res, { success: false, error: '用户不存在' });
      if (!isManager(emp) && !canManageRecruit(emp, b.operator) && b.operator !== 'root') {
        return send(res, { success: false, error: '仅面试官、主管或 HR 可提交评价' });
      }
      const err = checkText([['评价', b.content]]);
      if (err) return send(res, { success: false, error: err });

      const eval_id = await nextId(pool, 'recruit_interview_evals', 'eval_id', 'EV', 4);
      await pool.query(`
        INSERT INTO recruit_interview_evals
        (eval_id, interview_id, resume_id, interviewer_emp_id, score, content, recommend_hire)
        VALUES (?,?,?,?,?,?,?)`,
        [eval_id, b.interview_id, b.resume_id, emp?.emp_id || '', b.score || 0,
          b.content || '', b.recommend_hire === '是' ? '是' : '否']);

      await pool.query("UPDATE recruit_interviews SET status='已完成' WHERE interview_id=?", [b.interview_id]);
      send(res, { success: true, eval_id, message: '面试评价已提交' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P4 录用审批与 Offer ==========
  app.post('/api/recruit/hire/apply', async (req, res) => {
    try {
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!canManageRecruit(emp, b.operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可发起录用审批' });
      }
      const [[r]] = await pool.query("SELECT * FROM recruit_resumes WHERE resume_id=? AND screen_status='通过'", [b.resume_id]);
      if (!r) return send(res, { success: false, error: '简历须为通过状态' });

      const approval_id = await nextId(pool, 'recruit_hire_approvals', 'approval_id', 'HA', 4);
      await pool.query(`
        INSERT INTO recruit_hire_approvals
        (approval_id, resume_id, job_id, proposed_salary, proposed_onboard, status, submitter)
        VALUES (?,?,?,?,?, '待主管审批', ?)`,
        [approval_id, b.resume_id, r.job_id, b.proposed_salary || '', b.proposed_onboard || null, b.operator]);

      await logOp(b.operator, emp?.emp_id, '录用审批申请', approval_id);
      send(res, { success: true, approval_id, message: '录用申请已提交，等待部门主管审批' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/hire/approve', async (req, res) => {
    try {
      const { operator, approval_id, action, comment } = req.body;
      const emp = await getEmployee(operator);
      if (!isManager(emp) && !isHR(emp, operator)) {
        return send(res, { success: false, error: '仅部门主管或 HR 可审批' });
      }

      const [[row]] = await pool.query('SELECT * FROM recruit_hire_approvals WHERE approval_id=?', [approval_id]);
      if (!row) return send(res, { success: false, error: '审批单不存在' });
      if (row.status !== '待主管审批') return send(res, { success: false, error: '当前状态不可审批' });

      if (isManager(emp) && !isHR(emp, operator)) {
        const [[j]] = await pool.query('SELECT department_id FROM recruit_jobs WHERE job_id=?', [row.job_id]);
        if (j?.department_id !== emp.department_id) {
          return send(res, { success: false, error: '仅可审批本部门岗位录用' });
        }
      }

      const status = action === 'approve' ? '已通过' : '已驳回';
      await pool.query(`
        UPDATE recruit_hire_approvals SET status=?, mgr_emp_id=?, mgr_comment=?, mgr_time=NOW()
        WHERE approval_id=?`, [status, emp?.emp_id || operator, comment || '', approval_id]);

      send(res, { success: true, message: status === '已通过' ? '审批通过，可发放 Offer' : '已驳回录用申请' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/hire/query', async (req, res) => {
    try {
      const { operator, status, scope } = req.body;
      const emp = await getEmployee(operator);
      let sql = `
        SELECT h.*, r.name AS candidate_name, j.title AS job_title, j.department_id, d.name AS department
        FROM recruit_hire_approvals h
        JOIN recruit_resumes r ON h.resume_id=r.resume_id
        JOIN recruit_jobs j ON h.job_id=j.job_id
        LEFT JOIN departments d ON j.department_id=d.id
        WHERE 1=1`;
      const params = [];
      if (scope === 'pending_mgr' && isManager(emp)) {
        sql += " AND h.status='待主管审批' AND j.department_id=?";
        params.push(emp.department_id);
      } else if (!canManageRecruit(emp, operator) && !isHR(emp, operator) && operator !== 'root') {
        if (isManager(emp)) {
          sql += ' AND j.department_id=?';
          params.push(emp.department_id);
        } else {
          return send(res, { success: true, data: [] });
        }
      }
      if (status) { sql += ' AND h.status=?'; params.push(status); }
      sql += ' ORDER BY h.created_at DESC LIMIT 200';
      const [rows] = await pool.query(sql, params);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/offer/issue', async (req, res) => {
    try {
      const b = req.body;
      const emp = await getEmployee(b.operator);
      if (!canManageRecruit(emp, b.operator)) {
        return send(res, { success: false, error: '仅招聘专员或 HR 可发放 Offer' });
      }

      const [[ap]] = await pool.query(
        "SELECT * FROM recruit_hire_approvals WHERE resume_id=? AND status='已通过' ORDER BY created_at DESC LIMIT 1",
        [b.resume_id]);
      if (!ap) return send(res, { success: false, error: '须先通过录用审批' });

      const offer_id = await nextId(pool, 'recruit_offers', 'offer_id', 'OF', 4);
      await pool.query(`
        INSERT INTO recruit_offers
        (offer_id, resume_id, job_id, salary, onboard_date, expire_date, issue_status, confirm_status)
        VALUES (?,?,?,?,?,?, '已发放', '待确认')`,
        [offer_id, b.resume_id, ap.job_id, b.salary || ap.proposed_salary,
          b.onboard_date || ap.proposed_onboard, b.expire_date || null]);

      await logOp(b.operator, emp?.emp_id, '发放Offer', offer_id);
      send(res, { success: true, offer_id, message: 'Offer 已发放，等待候选人确认' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/offer/confirm', async (req, res) => {
    try {
      const { offer_id, action } = req.body;
      const status = action === 'accept' ? '已接受' : '已拒绝';
      const [[o]] = await pool.query('SELECT * FROM recruit_offers WHERE offer_id=?', [offer_id]);
      if (!o) return send(res, { success: false, error: 'Offer 不存在' });
      if (o.confirm_status !== '待确认') return send(res, { success: false, error: 'Offer 已处理' });

      await pool.query(
        'UPDATE recruit_offers SET confirm_status=?, confirmed_at=NOW() WHERE offer_id=?',
        [status, offer_id]);
      send(res, { success: true, message: status === '已接受' ? '已接受 Offer' : '已拒绝 Offer' });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/offer/query', async (req, res) => {
    try {
      const { operator } = req.body;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator) && !isHR(emp, operator) && operator !== 'root') {
        return send(res, { success: false, error: '无权限' });
      }
      const [rows] = await pool.query(`
        SELECT o.*, r.name AS candidate_name, j.title AS job_title
        FROM recruit_offers o
        JOIN recruit_resumes r ON o.resume_id=r.resume_id
        JOIN recruit_jobs j ON o.job_id=j.job_id
        ORDER BY o.created_at DESC LIMIT 200`);
      send(res, { success: true, data: rows });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== P5 入职同步 ==========
  app.post('/api/recruit/onboard/sync', async (req, res) => {
    try {
      const { operator, offer_id } = req.body;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator) && !isHR(emp, operator)) {
        return send(res, { success: false, error: '仅 HR 或招聘专员可办理入职同步' });
      }

      const [[o]] = await pool.query("SELECT * FROM recruit_offers WHERE offer_id=? AND confirm_status='已接受'", [offer_id]);
      if (!o) return send(res, { success: false, error: 'Offer 须为已接受状态' });
      if (o.synced_emp_id) return send(res, { success: true, emp_id: o.synced_emp_id, message: '已同步过' });

      const [[r]] = await pool.query('SELECT * FROM recruit_resumes WHERE resume_id=?', [o.resume_id]);
      const [[j]] = await pool.query('SELECT * FROM recruit_jobs WHERE job_id=?', [o.job_id]);
      if (!r || !j) return send(res, { success: false, error: '数据不完整' });

      const [[maxRow]] = await pool.query('SELECT emp_id FROM employees ORDER BY id DESC LIMIT 1');
      let num = maxRow?.emp_id ? parseInt(String(maxRow.emp_id).replace(/\D/g, ''), 10) + 1 : 1;
      const emp_id = 'E' + String(num).padStart(3, '0');
      const onboard = fmtDate(o.onboard_date) || fmtDate(new Date());

      let base = (r.name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
      let username = base, suf = 1;
      while (true) {
        const [[ex]] = await pool.query('SELECT id FROM employees WHERE username=?', [username]);
        if (!ex) break;
        username = base + suf++;
      }

      await pool.query(`
        INSERT INTO employees (emp_id, name, gender, phone, email, department_id, role_id, username, password,
          contract_start, contract_end, emp_status, status_changed_at)
        VALUES (?,?,?,?,?,?,5,?,?,?,DATE_ADD(?,INTERVAL 3 YEAR),'在职',NOW())`,
        [emp_id, r.name, '男', r.phone || '', r.email || '', j.department_id,
          username, 'admin', onboard, onboard, onboard]);

      await pool.query('UPDATE recruit_offers SET synced_emp_id=? WHERE offer_id=?', [emp_id, offer_id]);
      await pool.query("UPDATE recruit_jobs SET status='已招满' WHERE job_id=?", [o.job_id]).catch(() => {});

      await logOp(operator, emp_id, '招聘入职同步', offer_id);
      send(res, {
        success: true, emp_id, username, password: 'admin',
        message: `已创建员工 ${emp_id}，账号 ${username}，初始密码 admin`
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  // ========== 统计与导出 ==========
  app.post('/api/recruit/summary', async (req, res) => {
    try {
      const [[jobs]] = await pool.query("SELECT COUNT(*) AS v FROM recruit_jobs WHERE status='招聘中'");
      const [[resumes]] = await pool.query('SELECT COUNT(*) AS v FROM recruit_resumes');
      const [[hired]] = await pool.query(`
        SELECT COUNT(*) AS v FROM recruit_offers
        WHERE confirm_status='已接受' AND MONTH(confirmed_at)=MONTH(CURDATE())`);
      const [[pending]] = await pool.query(
        "SELECT COUNT(*) AS v FROM recruit_hire_approvals WHERE status='待主管审批'");
      send(res, {
        success: true,
        data: {
          active_jobs: jobs.v,
          resume_total: resumes.v,
          hired_month: hired.v,
          pending_approval: pending.v
        }
      });
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });

  app.post('/api/recruit/export', async (req, res) => {
    try {
      const { operator, type } = req.body;
      const emp = await getEmployee(operator);
      if (!canManageRecruit(emp, operator) && !isHR(emp, operator) && operator !== 'root') {
        return send(res, { success: false, error: '无权限导出' });
      }
      if (type === 'resume') {
        const [rows] = await pool.query(`
          SELECT r.resume_id, r.job_id, j.title, r.name, r.phone, r.education, r.screen_status, r.applied_at
          FROM recruit_resumes r JOIN recruit_jobs j ON r.job_id=j.job_id ORDER BY r.applied_at DESC`);
        const header = '简历编号,岗位,职位,姓名,手机,学历,筛选状态,投递时间\n';
        const csv = header + rows.map(r =>
          [r.resume_id, r.job_id, r.title, r.name, r.phone, r.education, r.screen_status, r.applied_at]
            .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=recruit_resumes.csv');
        return res.send('\uFEFF' + csv);
      }
      const [rows] = await pool.query(`
        SELECT j.job_id, j.title, d.name AS dept, j.headcount, j.status, j.published_at,
          (SELECT COUNT(*) FROM recruit_resumes r WHERE r.job_id=j.job_id) AS rc
        FROM recruit_jobs j LEFT JOIN departments d ON j.department_id=d.id
        ORDER BY j.created_at DESC`);
      const header = '岗位编号,职位,部门,人数,状态,发布日期,简历数\n';
      const csv = header + rows.map(r =>
        [r.job_id, r.title, r.dept, r.headcount, r.status, r.published_at, r.rc]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=recruit_jobs.csv');
      res.send('\uFEFF' + csv);
    } catch (e) { res.status(500); send(res, { error: e.message }); }
  });
};
