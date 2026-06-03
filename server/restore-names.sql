-- 恢复部门与角色中文名称
USE ems;
SET NAMES utf8mb4;

UPDATE departments SET name='技术部' WHERE id=1;
UPDATE departments SET name='市场部' WHERE id=2;
UPDATE departments SET name='财务部' WHERE id=3;
UPDATE departments SET name='人事部' WHERE id=4;
UPDATE departments SET name='销售部' WHERE id=5;
UPDATE departments SET name='运营部' WHERE id=6;
UPDATE departments SET name='产品部' WHERE id=7;
UPDATE departments SET name='客服部' WHERE id=8;
UPDATE departments SET name='法务部' WHERE id=9;
UPDATE departments SET name='行政部' WHERE id=10;
UPDATE departments SET name='研发部' WHERE id=11;
UPDATE departments SET name='设计部' WHERE id=12;

UPDATE roles SET name='管理员' WHERE id=1;
UPDATE roles SET name='部门主管' WHERE id=2;
UPDATE roles SET name='HR专员' WHERE id=3;
UPDATE roles SET name='招聘专员' WHERE id=4;
UPDATE roles SET name='普通员工' WHERE id=5;

UPDATE employees SET gender='男' WHERE gender='?' OR gender='' OR gender IS NULL;
UPDATE department_stats SET department_name=(SELECT name FROM departments WHERE departments.id=department_stats.department_id);
