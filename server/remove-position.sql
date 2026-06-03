-- 移除员工「职位」字段，统一使用「角色」关联各模块
USE ems;
SET NAMES utf8mb4;

UPDATE employees SET position = NULL WHERE position IS NOT NULL;

ALTER TABLE employees DROP COLUMN position;

-- 扩展表中的职位字段改为角色（若列存在则更新数据后删除）
UPDATE probation_applications pa
  JOIN employees e ON pa.emp_id = e.emp_id
  JOIN roles r ON e.role_id = r.id
  SET pa.position = r.name
  WHERE pa.position IS NOT NULL AND pa.position != '';

-- 若已改为 role 列则跳过；此处删除 position 列
ALTER TABLE probation_applications DROP COLUMN IF EXISTS position;
ALTER TABLE probation_applications ADD COLUMN IF NOT EXISTS role_name VARCHAR(30) DEFAULT '' AFTER department;
UPDATE probation_applications pa
  JOIN employees e ON pa.emp_id = e.emp_id
  JOIN roles r ON e.role_id = r.id
  SET pa.role_name = r.name;

ALTER TABLE resigned_archives DROP COLUMN IF EXISTS position;
ALTER TABLE resigned_archives ADD COLUMN IF NOT EXISTS role_name VARCHAR(30) DEFAULT '' AFTER department;
UPDATE resigned_archives ra
  JOIN employees e ON ra.emp_id = e.emp_id
  JOIN roles r ON e.role_id = r.id
  SET ra.role_name = r.name
  WHERE e.emp_id IS NOT NULL;
