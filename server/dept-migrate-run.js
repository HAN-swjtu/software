const mysql = require('mysql2/promise');
(async () => {
  const p = mysql.createPool({ host: '127.0.0.1', user: 'root', password: '123456', database: 'ems', charset: 'utf8mb4' });
  const [c] = await p.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ems' AND TABLE_NAME='departments' AND COLUMN_NAME='manager_emp_id'"
  );
  if (!c.length) await p.query('ALTER TABLE departments ADD COLUMN manager_emp_id VARCHAR(10) NULL AFTER name');
  const [depts] = await p.query('SELECT id FROM departments');
  for (const d of depts) {
    const [[m]] = await p.query('SELECT emp_id FROM employees WHERE department_id=? AND role_id=2 LIMIT 1', [d.id]);
    if (m) await p.query('UPDATE departments SET manager_emp_id=? WHERE id=?', [m.emp_id, d.id]);
  }
  console.log('部门负责人字段已就绪');
  await p.end();
})();
