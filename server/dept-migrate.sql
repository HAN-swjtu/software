USE ems;
SET NAMES utf8mb4;

ALTER TABLE departments ADD COLUMN manager_emp_id VARCHAR(10) NULL COMMENT '部门负责人工号' AFTER name;
