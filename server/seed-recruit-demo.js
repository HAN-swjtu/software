// 演示数据（UTF-8）node seed-recruit-demo.js
const mysql = require('mysql2/promise');

(async () => {
  const pool = mysql.createPool({
    host: '127.0.0.1', user: 'root', password: '123456', database: 'ems',
    charset: 'utf8mb4_unicode_ci'
  });
  await pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");

  const [[ex]] = await pool.query("SELECT job_id FROM recruit_jobs WHERE job_id='R0001'");
  if (ex) {
    console.log('演示岗位已存在，跳过');
    await pool.end();
    return;
  }

  await pool.query(`
    INSERT INTO recruit_jobs
    (job_id, department_id, title, job_duties, job_requirements, salary_range, location, headcount, deadline, status, publisher, published_at)
    VALUES ('R0001', 1, '高级前端工程师', '负责Web前端开发', '熟悉Vue/React', '15K-25K', '技术部A座3楼', 2, DATE_ADD(CURDATE(), INTERVAL 30 DAY), '招聘中', 'linjing', NOW())`);

  await pool.query(`
    INSERT INTO recruit_resumes
    (resume_id, job_id, name, phone, email, education, work_experience, expected_salary, screen_status, screened_by, screened_at)
    VALUES ('CV0001', 'R0001', '李明', '13800001111', 'liming@test.com', '本科', '3年前端经验', '18K', '通过', 'linjing', NOW())`);

  console.log('已写入演示岗位 R0001、简历 CV0001');
  const [rows] = await pool.query('SELECT job_id, title, location FROM recruit_jobs');
  console.log(rows);
  await pool.end();
})();
