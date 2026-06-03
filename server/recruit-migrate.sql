USE ems;

CREATE TABLE IF NOT EXISTS recruit_demands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  demand_id VARCHAR(20) NOT NULL UNIQUE COMMENT '需求编号 RNxxxx',
  department_id INT NOT NULL,
  job_title VARCHAR(100) NOT NULL,
  headcount INT DEFAULT 1,
  job_duties TEXT,
  job_requirements TEXT,
  salary_range VARCHAR(80) DEFAULT '',
  status VARCHAR(20) DEFAULT '草稿' COMMENT '草稿/已立项/已关闭',
  creator VARCHAR(30) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dept (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(20) NOT NULL UNIQUE COMMENT '岗位编号 Rxxxx',
  demand_id VARCHAR(20) DEFAULT '',
  department_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  job_duties TEXT,
  job_requirements TEXT,
  salary_range VARCHAR(80) DEFAULT '',
  location VARCHAR(100) DEFAULT '',
  headcount INT DEFAULT 1,
  deadline DATE NULL,
  status VARCHAR(20) DEFAULT '草稿' COMMENT '草稿/招聘中/已关闭/已招满',
  publisher VARCHAR(30) DEFAULT '',
  published_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_dept (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_resumes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resume_id VARCHAR(20) NOT NULL UNIQUE COMMENT '简历编号 CVxxxx',
  job_id VARCHAR(20) NOT NULL,
  name VARCHAR(30) NOT NULL,
  phone VARCHAR(20) DEFAULT '',
  email VARCHAR(80) DEFAULT '',
  education VARCHAR(50) DEFAULT '',
  work_experience TEXT,
  project_experience TEXT,
  expected_salary VARCHAR(50) DEFAULT '',
  screen_status VARCHAR(20) DEFAULT '待筛选' COMMENT '待筛选/通过/未通过',
  screen_comment VARCHAR(500) DEFAULT '',
  screened_by VARCHAR(30) DEFAULT '',
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  screened_at DATETIME NULL,
  KEY idx_job (job_id),
  KEY idx_screen (screen_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_interviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  interview_id VARCHAR(20) NOT NULL UNIQUE COMMENT '面试编号 IVxxxx',
  resume_id VARCHAR(20) NOT NULL,
  interviewer_emp_id VARCHAR(10) DEFAULT '',
  interviewer_name VARCHAR(30) DEFAULT '',
  round_num INT DEFAULT 1,
  interview_time DATETIME NOT NULL,
  location VARCHAR(100) DEFAULT '',
  status VARCHAR(20) DEFAULT '已安排' COMMENT '已安排/已完成/已取消',
  notify_status VARCHAR(20) DEFAULT '已通知',
  created_by VARCHAR(30) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_resume (resume_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_interview_evals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  eval_id VARCHAR(20) NOT NULL UNIQUE COMMENT '评价编号 EVxxxx',
  interview_id VARCHAR(20) NOT NULL,
  resume_id VARCHAR(20) NOT NULL,
  interviewer_emp_id VARCHAR(10) DEFAULT '',
  score DECIMAL(4,1) DEFAULT 0,
  content VARCHAR(1000) DEFAULT '',
  recommend_hire VARCHAR(10) DEFAULT '否' COMMENT '是/否',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_iv (interview_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_hire_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  approval_id VARCHAR(20) NOT NULL UNIQUE COMMENT '审批编号 HAxxxx',
  resume_id VARCHAR(20) NOT NULL,
  job_id VARCHAR(20) NOT NULL,
  proposed_salary VARCHAR(50) DEFAULT '',
  proposed_onboard DATE NULL,
  status VARCHAR(20) DEFAULT '待主管审批' COMMENT '待主管审批/已通过/已驳回',
  submitter VARCHAR(30) DEFAULT '',
  mgr_emp_id VARCHAR(10) DEFAULT '',
  mgr_comment VARCHAR(500) DEFAULT '',
  mgr_time DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recruit_offers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  offer_id VARCHAR(20) NOT NULL UNIQUE COMMENT 'Offer编号 OFxxxx',
  resume_id VARCHAR(20) NOT NULL,
  job_id VARCHAR(20) NOT NULL,
  salary VARCHAR(50) DEFAULT '',
  onboard_date DATE NULL,
  expire_date DATE NULL,
  issue_status VARCHAR(20) DEFAULT '已发放',
  confirm_status VARCHAR(20) DEFAULT '待确认' COMMENT '待确认/已接受/已拒绝',
  confirmed_at DATETIME NULL,
  synced_emp_id VARCHAR(10) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_resume (resume_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
