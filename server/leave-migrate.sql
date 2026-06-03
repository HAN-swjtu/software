USE ems;

ALTER TABLE leave_records
  ADD COLUMN apply_id VARCHAR(20) NULL COMMENT '申请编号' AFTER id,
  ADD COLUMN approve_comment VARCHAR(500) DEFAULT '' COMMENT '审批意见' AFTER approver_id,
  ADD COLUMN approve_time DATETIME NULL COMMENT '审批时间' AFTER approve_comment;

UPDATE leave_records SET apply_id = CONCAT('L', LPAD(id, 4, '0')) WHERE apply_id IS NULL OR apply_id = '';
