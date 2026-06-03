// 每部门仅保留一名部门主管（role_id=2），与 departments.manager_emp_id 对齐
const mysql = require('mysql2/promise');
const { syncDepartmentManager } = require('./employee-helpers');

(async () => {
  const pool = mysql.createPool({ host: 'localhost', user: 'root', password: '123456', database: 'ems' });
  const [depts] = await pool.query('SELECT id, name, manager_emp_id FROM departments');
  for (const d of depts) {
    const [managers] = await pool.query(
      'SELECT emp_id, name FROM employees WHERE department_id=? AND role_id=2 ORDER BY emp_id',
      [d.id]
    );
    let keep = d.manager_emp_id;
    if (keep && !managers.find(m => m.emp_id === keep)) keep = null;
    if (!keep && managers.length) keep = managers[0].emp_id;
    if (keep) {
      await syncDepartmentManager(pool, d.id, keep);
      console.log(`部门 ${d.name}: 主管 ${keep}`);
    } else if (managers.length) {
      await syncDepartmentManager(pool, d.id, managers[0].emp_id);
      console.log(`部门 ${d.name}: 主管 ${managers[0].emp_id}`);
    }
  }
  await pool.end();
  console.log('完成');
})().catch(e => { console.error(e); process.exit(1); });
