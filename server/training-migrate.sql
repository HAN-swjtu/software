USE ems;

CREATE TABLE IF NOT EXISTS training_needs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  need_id VARCHAR(20) NOT NULL UNIQUE COMMENT '需求编号 TNxxxx',
  department_id INT NOT NULL,
  department_name VARCHAR(50) DEFAULT '',
  theme VARCHAR(100) NOT NULL COMMENT '培训主题',
  goal VARCHAR(500) DEFAULT '' COMMENT '培训目标',
  headcount INT DEFAULT 0 COMMENT '预计人数',
  submitter VARCHAR(30) DEFAULT '',
  status VARCHAR(20) DEFAULT '待汇总' COMMENT '待汇总/已汇总/已立项',
  summary_id VARCHAR(20) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dept (department_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id VARCHAR(20) NOT NULL UNIQUE COMMENT '培训编号 Txxxx',
  title VARCHAR(100) NOT NULL COMMENT '培训主题',
  content VARCHAR(500) DEFAULT '' COMMENT '培训内容',
  train_type VARCHAR(30) DEFAULT '内部培训' COMMENT '培训类型',
  trainer VARCHAR(100) DEFAULT '' COMMENT '讲师',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  location VARCHAR(100) DEFAULT '',
  notice VARCHAR(500) DEFAULT '' COMMENT '公告内容',
  capacity INT DEFAULT 50 COMMENT '名额上限',
  status VARCHAR(20) DEFAULT '草稿' COMMENT '草稿/报名中/未开始/进行中/已完成',
  publisher VARCHAR(30) DEFAULT '',
  published_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enroll_id VARCHAR(20) NOT NULL UNIQUE COMMENT '报名编号 TExxxx',
  course_id VARCHAR(20) NOT NULL,
  emp_id VARCHAR(10) NOT NULL,
  name VARCHAR(30) DEFAULT '',
  department VARCHAR(50) DEFAULT '',
  status VARCHAR(20) DEFAULT '已报名' COMMENT '已报名/已取消',
  enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_course_emp (course_id, emp_id),
  KEY idx_course (course_id),
  KEY idx_emp (emp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  att_id VARCHAR(20) NOT NULL UNIQUE COMMENT '考勤编号 TAxxxx',
  course_id VARCHAR(20) NOT NULL,
  emp_id VARCHAR(10) NOT NULL,
  name VARCHAR(30) DEFAULT '',
  check_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  check_status VARCHAR(20) DEFAULT '已签到' COMMENT '已签到/迟到/缺勤',
  UNIQUE KEY uk_course_emp_att (course_id, emp_id),
  KEY idx_course (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
