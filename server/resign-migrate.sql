USE ems;

CREATE TABLE IF NOT EXISTS resign_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  apply_id VARCHAR(20) NOT NULL UNIQUE COMMENT '申请编号 RZxxxx',
  emp_id VARCHAR(10) NOT NULL,
  name VARCHAR(30) NOT NULL,
  department VARCHAR(50) DEFAULT '',
  role_name VARCHAR(30) DEFAULT '',
  hire_date DATE NULL,
  expected_resign_date DATE NOT NULL COMMENT '预计离职日期',
  resign_reason VARCHAR(500) DEFAULT '',
  handover_plan TEXT,
  status VARCHAR(20) DEFAULT '待主管审批' COMMENT '待主管审批/待HR审批/已批准/已拒绝/已撤销',
  mgr_approver_id VARCHAR(10) DEFAULT '',
  mgr_comment VARCHAR(500) DEFAULT '',
  mgr_time DATETIME NULL,
  hr_approver_id VARCHAR(10) DEFAULT '',
  hr_comment VARCHAR(500) DEFAULT '',
  hr_time DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_emp (emp_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE resigned_archives
  ADD COLUMN apply_id VARCHAR(20) DEFAULT '' COMMENT '关联离职申请' AFTER archive_id,
  ADD COLUMN archive_status VARCHAR(20) DEFAULT '已归档' COMMENT '归档状态' AFTER handover_status,
  ADD COLUMN work_years DECIMAL(4,1) DEFAULT 0 COMMENT '工龄(年)' AFTER resign_date;
