-- 薪资管理模块 D5/D6
USE ems;

CREATE TABLE IF NOT EXISTS employee_salary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_id VARCHAR(10) NOT NULL UNIQUE,
  base_salary DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '基本工资',
  performance_bonus DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '绩效奖金',
  allowance DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '岗位津贴',
  social_insurance DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '社保公积金',
  effective_date DATE NULL COMMENT '生效日期',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_salary_emp FOREIGN KEY (emp_id) REFERENCES employees(emp_id)
);

CREATE TABLE IF NOT EXISTS salary_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pay_id VARCHAR(20) NOT NULL UNIQUE COMMENT '工资单号',
  emp_id VARCHAR(10) NOT NULL,
  pay_month VARCHAR(7) NOT NULL COMMENT '发薪月份 YYYY-MM',
  base_salary DECIMAL(10,2) NOT NULL DEFAULT 0,
  performance_bonus DECIMAL(10,2) NOT NULL DEFAULT 0,
  allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  overtime_pay DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '加班补贴',
  attendance_deduct DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '考勤扣款',
  social_insurance DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '个人所得税',
  gross_pay DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '应发合计',
  net_pay DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '实发合计',
  pay_status VARCHAR(10) NOT NULL DEFAULT '草稿' COMMENT '草稿/已发放',
  remark VARCHAR(200) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  UNIQUE KEY uk_emp_month (emp_id, pay_month),
  KEY idx_pay_month (pay_month),
  CONSTRAINT fk_payroll_emp FOREIGN KEY (emp_id) REFERENCES employees(emp_id)
);
