-- 绩效管理模块 D4~D6 / P2.3 / P2.5
CREATE TABLE IF NOT EXISTS performance_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  cycle VARCHAR(30) NOT NULL COMMENT '考核周期如2026-Q1',
  department_id INT NULL COMMENT 'NULL表示全公司',
  indicators JSON NOT NULL COMMENT 'KPI指标数组',
  grade_distribution JSON NULL COMMENT 'A/B/C/D比例',
  status ENUM('草稿','已发布','已锁定') NOT NULL DEFAULT '草稿',
  published_at DATETIME NULL,
  published_by VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  record_id VARCHAR(20) NOT NULL UNIQUE,
  template_id VARCHAR(20) NOT NULL,
  emp_id VARCHAR(20) NOT NULL,
  cycle VARCHAR(30) NOT NULL,
  status ENUM('待自评','待主管评','待校准','已冻结','已归档') NOT NULL DEFAULT '待自评',
  self_tasks TEXT NULL,
  self_score DECIMAL(5,2) NULL,
  self_summary TEXT NULL,
  self_submitted_at DATETIME NULL,
  manager_id VARCHAR(20) NULL,
  manager_score DECIMAL(5,2) NULL,
  suggested_grade CHAR(1) NULL,
  interview_feedback TEXT NULL,
  improvement_suggestions TEXT NULL,
  manager_submitted_at DATETIME NULL,
  final_grade CHAR(1) NULL,
  performance_coefficient DECIMAL(4,2) NULL,
  frozen_at DATETIME NULL,
  archived_at DATETIME NULL,
  archived_by VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_emp_cycle (emp_id, cycle)
);

CREATE TABLE IF NOT EXISTS performance_calibrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  calibration_id VARCHAR(20) NOT NULL UNIQUE,
  record_id VARCHAR(20) NOT NULL,
  hr_operator VARCHAR(50) NOT NULL,
  grade_before CHAR(1) NULL,
  grade_after CHAR(1) NOT NULL,
  reason TEXT NULL,
  batch_id VARCHAR(30) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_interviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  interview_id VARCHAR(20) NOT NULL UNIQUE,
  record_id VARCHAR(20) NOT NULL,
  interview_time DATETIME NULL,
  suggestions TEXT NULL,
  evaluation TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_talent_pool (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pool_id VARCHAR(20) NOT NULL UNIQUE,
  emp_id VARCHAR(20) NOT NULL,
  cycle VARCHAR(30) NOT NULL,
  final_grade CHAR(1) NOT NULL,
  core_strengths TEXT NULL,
  match_suggestion TEXT NULL,
  promotion_score DECIMAL(4,2) NULL,
  created_by VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_id VARCHAR(20) NOT NULL,
  cycle VARCHAR(30) NOT NULL,
  title VARCHAR(100) NOT NULL,
  content TEXT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
