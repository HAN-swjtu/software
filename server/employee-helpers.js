// 部门主管唯一、负责人同步
async function syncDepartmentManager(pool, departmentId, managerEmpId) {
  if (!departmentId) return;
  if (!managerEmpId) {
    await pool.query(
      'UPDATE employees SET role_id=5 WHERE department_id=? AND role_id=2',
      [departmentId]
    );
    await pool.query('UPDATE departments SET manager_emp_id=NULL WHERE id=?', [departmentId]);
    return;
  }
  const [[emp]] = await pool.query(
    'SELECT emp_id, department_id, name FROM employees WHERE emp_id=? LIMIT 1',
    [managerEmpId]
  );
  if (!emp) throw new Error('指定的负责人不存在');
  if (emp.department_id !== departmentId) {
    throw new Error(`负责人「${emp.name}」不属于本部门，请先在员工列表中调整其部门`);
  }
  await pool.query(
    'UPDATE employees SET role_id=5 WHERE department_id=? AND role_id=2 AND emp_id<>?',
    [departmentId, managerEmpId]
  );
  await pool.query('UPDATE employees SET role_id=2 WHERE emp_id=?', [managerEmpId]);
  await pool.query('UPDATE departments SET manager_emp_id=? WHERE id=?', [managerEmpId, departmentId]);
}

async function assertCanAssignDeptManager(pool, departmentId, excludeEmpId = null) {
  let sql = 'SELECT emp_id, name FROM employees WHERE department_id=? AND role_id=2';
  const params = [departmentId];
  if (excludeEmpId) {
    sql += ' AND emp_id<>?';
    params.push(excludeEmpId);
  }
  const [[row]] = await pool.query(sql + ' LIMIT 1', params);
  return row || null;
}

module.exports = { syncDepartmentManager, assertCanAssignDeptManager };
