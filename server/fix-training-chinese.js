// 修复培训表中因错误编码写入的 ? 占位（在 server 目录执行: node fix-training-chinese.js）
const mysql = require('mysql2/promise');

const FIX_ROWS = [
  {
    course_id: 'T0001',
    title: '新员工入职培训',
    trainer: 'HR团队',
    location: '会议室A',
    notice: '请准时参加',
    content: '入职制度、企业文化与岗位须知'
  }
];

function looksCorrupt(s) {
  if (s == null || s === '') return false;
  const t = String(s);
  if (/^\?+$/.test(t.trim())) return true;
  if (/^\?+[^?]*$/.test(t) && !/[\u4e00-\u9fff]/.test(t)) return true;
  return false;
}

(async () => {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'root', password: '123456', database: 'ems',
    charset: 'utf8mb4_unicode_ci'
  });
  await pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");

  for (const row of FIX_ROWS) {
    await pool.query(
      `UPDATE training_courses SET title=?, trainer=?, location=?, notice=?, content=?
       WHERE course_id=?`,
      [row.title, row.trainer, row.location, row.notice, row.content, row.course_id]
    );
  }

  const [all] = await pool.query(
    'SELECT course_id, title, trainer, location, notice, content FROM training_courses');
  for (const r of all) {
    const fields = ['title', 'trainer', 'location', 'notice', 'content'];
    const bad = fields.filter(f => looksCorrupt(r[f]));
    if (bad.length) {
      console.warn('仍含疑似乱码:', r.course_id, bad.join(','), r);
    }
  }

  await pool.query(`
    UPDATE training_needs tn
    JOIN departments d ON tn.department_id = d.id
    SET tn.department_name = d.name
    WHERE tn.department_name LIKE '%?%' OR tn.department_name = ''
  `).catch(() => {});

  const [rows] = await pool.query(
    'SELECT course_id, title, location, notice FROM training_courses');
  console.log('培训课程:', rows);
  await pool.end();
})();
