-- 员工管理模块功能扩展 - 数据字典 D1~D4 / P1~P4
USE ems;

-- 修复 gender 字段编码损坏问题
ALTER TABLE employees MODIFY gender VARCHAR(4) NOT NULL DEFAULT '男';
UPDATE employees SET gender = '男' WHERE gender = '?' OR gender = '' OR gender IS NULL;

-- D1/D2: 扩展员工信息表
ALTER TABLE employees
  ADD COLUMN birth_date DATE NULL COMMENT '出生日期',
  ADD COLUMN id_card VARCHAR(20) DEFAULT '' COMMENT '身份证号',
  ADD COLUMN email VARCHAR(100) DEFAULT '' COMMENT '电子邮箱',
  ADD COLUMN address VARCHAR(200) DEFAULT '' COMMENT '现居地址',
  ADD COLUMN emergency_contact VARCHAR(50) DEFAULT '' COMMENT '紧急联系人',
  ADD COLUMN emergency_phone VARCHAR(20) DEFAULT '' COMMENT '紧急联系电话',
  ADD COLUMN emp_status VARCHAR(10) DEFAULT '在职' COMMENT '员工状态',
  ADD COLUMN probation_start DATE NULL COMMENT '试用期开始',
  ADD COLUMN probation_end DATE NULL COMMENT '试用期结束',
  ADD COLUMN contract_start DATE NULL COMMENT '合同开始',
  ADD COLUMN contract_end DATE NULL COMMENT '合同结束',
  ADD COLUMN status_changed_at DATETIME NULL COMMENT '状态变更时间';

-- 初始化现有员工状态与合同日期
UPDATE employees SET
  emp_status = IF(emp_status IS NULL OR emp_status = '', '在职', emp_status),
  contract_start = COALESCE(contract_start, DATE(created_at)),
  contract_end = COALESCE(contract_end, DATE_ADD(DATE(created_at), INTERVAL 3 YEAR)),
  status_changed_at = COALESCE(status_changed_at, created_at)
WHERE emp_status IS NULL OR contract_start IS NULL;

-- 设置部分员工为试用期（演示 P2）
UPDATE employees SET emp_status = '试用期',
  probation_start = DATE_SUB(CURDATE(), INTERVAL 2 MONTH),
  probation_end = DATE_ADD(CURDATE(), INTERVAL 1 MONTH)
WHERE role_id = 5 AND emp_id IN ('E020','E021','E022','E023','E024');

-- D3: 部门员工统计表
CREATE TABLE IF NOT EXISTS department_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  department_name VARCHAR(50) NOT NULL,
  active_count INT DEFAULT 0,
  probation_count INT DEFAULT 0,
  resigned_count INT DEFAULT 0,
  stat_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dept (department_id)
);

-- D4: 离职员工归档表
CREATE TABLE IF NOT EXISTS resigned_archives (
  id INT AUTO_INCREMENT PRIMARY KEY,
  archive_id VARCHAR(20) NOT NULL UNIQUE,
  emp_id VARCHAR(10) NOT NULL,
  name VARCHAR(30) NOT NULL,
  department VARCHAR(50),
  role_name VARCHAR(30) DEFAULT '',
  hire_date DATE,
  resign_date DATE,
  resign_reason VARCHAR(200),
  work_history TEXT,
  performance_record TEXT,
  handover_status VARCHAR(100) DEFAULT '',
  archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- P2: 转正申请表
CREATE TABLE IF NOT EXISTS probation_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  apply_id VARCHAR(20) NOT NULL UNIQUE,
  emp_id VARCHAR(10) NOT NULL,
  name VARCHAR(30) NOT NULL,
  department VARCHAR(50),
  role_name VARCHAR(30) DEFAULT '',
  probation_start DATE,
  probation_end DATE,
  work_summary TEXT,
  self_evaluation TEXT,
  apply_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  approver_id VARCHAR(10),
  approve_status VARCHAR(10) DEFAULT '待审批',
  approve_comment TEXT,
  approve_score DECIMAL(3,1),
  approve_time DATETIME,
  effective_date DATE,
  notify_time DATETIME
);

-- 操作日志
CREATE TABLE IF NOT EXISTS operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operator VARCHAR(60),
  emp_id VARCHAR(10),
  action VARCHAR(50),
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 导出日志
CREATE TABLE IF NOT EXISTS export_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operator VARCHAR(60),
  filter_conditions TEXT,
  export_format VARCHAR(10),
  record_count INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
