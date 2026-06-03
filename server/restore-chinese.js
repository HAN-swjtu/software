// 恢复部门/角色中文名称（数据库导入后执行）
const mysql = require('mysql2/promise');

const DEPT = ['技术部','市场部','财务部','人事部','销售部','运营部','产品部','客服部','法务部','行政部','研发部','设计部'];
const ROLE = ['管理员','部门主管','HR专员','招聘专员','普通员工'];

(async () => {
  const pool = mysql.createPool({ host:'127.0.0.1', user:'root', password:'123456', database:'ems', charset:'utf8mb4' });
  for (let i = 0; i < DEPT.length; i++) await pool.query('UPDATE departments SET name=? WHERE id=?', [DEPT[i], i + 1]);
  for (let i = 0; i < ROLE.length; i++) await pool.query('UPDATE roles SET name=? WHERE id=?', [ROLE[i], i + 1]);
  await pool.query("UPDATE employees SET gender='男' WHERE gender NOT IN ('男','女')");
  try {
    await pool.query('UPDATE department_stats ds JOIN departments d ON ds.department_id=d.id SET ds.department_name=d.name');
  } catch (_) {}
  console.log('中文名称已恢复');
  await pool.end();
})();
