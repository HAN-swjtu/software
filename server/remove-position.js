// 安全移除职位字段，各模块改用角色(role)
const mysql = require('mysql2/promise');

async function dropColIfExists(pool, table, col) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ems' AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, col]
  );
  if (cols.length) await pool.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
}

async function addColIfNotExists(pool, table, col, def) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='ems' AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, col]
  );
  if (!cols.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
}

async function main() {
  const pool = mysql.createPool({ host: '127.0.0.1', user: 'root', password: '123456', database: 'ems', charset: 'utf8mb4' });

  await dropColIfExists(pool, 'employees', 'position');

  await addColIfNotExists(pool, 'probation_applications', 'role_name', "VARCHAR(30) DEFAULT '' AFTER department");
  await pool.query(`
    UPDATE probation_applications pa
    JOIN employees e ON pa.emp_id = e.emp_id
    JOIN roles r ON e.role_id = r.id
    SET pa.role_name = r.name`);
  await dropColIfExists(pool, 'probation_applications', 'position');

  await addColIfNotExists(pool, 'resigned_archives', 'role_name', "VARCHAR(30) DEFAULT '' AFTER department");
  await pool.query(`
    UPDATE resigned_archives ra
    JOIN employees e ON ra.emp_id = e.emp_id
    JOIN roles r ON e.role_id = r.id
    SET ra.role_name = r.name`);
  await dropColIfExists(pool, 'resigned_archives', 'position');

  console.log('已移除职位字段，各表已关联角色');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
