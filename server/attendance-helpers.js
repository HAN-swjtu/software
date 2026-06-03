// 考勤与假期联动：本地日期、请假同步、9:00 未签到记迟到
const LATE_DEADLINE = '09:00:00'; // 9:00 前未签到 → 迟到
const CHECKIN_LATE_AFTER = '09:05:00'; // 实际打卡晚于此刻记迟到

function fmtLocalDate(val) {
  if (!val) return '';
  const s = String(val);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  if (val instanceof Date) {
    const y = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  return s.slice(0, 10);
}

function addCalendarDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function dateRangeLocal(start, end) {
  const dates = [];
  let cur = fmtLocalDate(start);
  const last = fmtLocalDate(end);
  if (!cur || !last || cur > last) return dates;
  while (cur <= last) {
    dates.push(cur);
    if (cur === last) break;
    cur = addCalendarDay(cur);
  }
  return dates;
}

function nowLocal() {
  const n = new Date();
  const y = n.getFullYear();
  const mo = String(n.getMonth() + 1).padStart(2, '0');
  const day = String(n.getDate()).padStart(2, '0');
  return { date: `${y}-${mo}-${day}`, time: n.toTimeString().slice(0, 8) };
}

async function mysqlToday(pool) {
  const [[r]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d");
  return r.d;
}

async function isOnApprovedLeave(pool, empId, date) {
  const d = fmtLocalDate(date);
  const [[row]] = await pool.query(`
    SELECT id FROM leave_records
    WHERE emp_id=? AND status='已批准'
      AND DATE_FORMAT(start_date,'%Y-%m-%d') <= ?
      AND DATE_FORMAT(end_date,'%Y-%m-%d') >= ?
    LIMIT 1`, [empId, d, d]);
  return !!row;
}

async function upsertLeaveAttendance(pool, empId, date) {
  const d = fmtLocalDate(date);
  const [[ex]] = await pool.query(
    'SELECT id, status FROM attendance WHERE emp_id=? AND check_date=?', [empId, d]);
  const remark = '假期批准同步';
  if (ex) {
    await pool.query(
      `UPDATE attendance SET status='请假', check_in=NULL, check_out=NULL, remark=? WHERE id=?`,
      [remark, ex.id]);
  } else {
    await pool.query(
      `INSERT INTO attendance (emp_id, check_date, status, remark) VALUES (?,?, '请假', ?)`,
      [empId, d, remark]);
  }
}

/** 用数据库 DATE_FORMAT 取准确日期，避免 JS 时区差一天 */
async function removeOrphanLeaveAttendance(pool, empId) {
  await pool.query(`
    DELETE FROM attendance
    WHERE emp_id=? AND status='请假' AND remark='假期批准同步'
      AND NOT EXISTS (
        SELECT 1 FROM leave_records l
        WHERE l.emp_id = attendance.emp_id AND l.status='已批准'
          AND attendance.check_date >= l.start_date
          AND attendance.check_date <= l.end_date
      )`, [empId]);
}

async function syncLeaveByApplyId(pool, applyId) {
  const [[row]] = await pool.query(`
    SELECT emp_id,
      DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
      DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date
    FROM leave_records WHERE apply_id=? LIMIT 1`, [applyId]);
  if (!row) return;
  await syncLeaveToAttendance(pool, row.emp_id, row.start_date, row.end_date);
  await removeOrphanLeaveAttendance(pool, row.emp_id);
}

async function syncLeaveToAttendance(pool, empId, startDate, endDate) {
  const dates = dateRangeLocal(startDate, endDate);
  for (const d of dates) {
    await upsertLeaveAttendance(pool, empId, d);
  }
}

async function markLateIfNeeded(pool, empId, date) {
  const d = fmtLocalDate(date);
  if (await isOnApprovedLeave(pool, empId, d)) {
    await upsertLeaveAttendance(pool, empId, d);
    return;
  }
  const [[rec]] = await pool.query(
    'SELECT id, status, check_in FROM attendance WHERE emp_id=? AND check_date=?',
    [empId, d]);
  if (rec?.status === '请假') return;
  if (rec?.check_in) return;
  const remark = '未在9:00前签到（系统自动）';
  if (rec) {
    if (rec.status === '迟到') return;
    await pool.query(
      `UPDATE attendance SET status='迟到', remark=? WHERE id=?`,
      [remark, rec.id]);
  } else {
    await pool.query(
      `INSERT INTO attendance (emp_id, check_date, status, remark) VALUES (?,?, '迟到', ?)`,
      [empId, d, remark]);
  }
}

/** 查询前同步：范围内已批准假期→请假；今日 9:00 后未签到→迟到 */
async function ensureAttendanceForRange(pool, dateFrom, dateTo) {
  const from = fmtLocalDate(dateFrom);
  const to = fmtLocalDate(dateTo);
  if (!from || !to || to < from) return;

  const { date: today, time: nowTime } = nowLocal();
  const capTo = to > today ? today : to;
  const dates = dateRangeLocal(from, capTo);

  for (const d of dates) {
    const [leaves] = await pool.query(`
      SELECT DISTINCT emp_id FROM leave_records
      WHERE status='已批准'
        AND DATE_FORMAT(start_date,'%Y-%m-%d') <= ?
        AND DATE_FORMAT(end_date,'%Y-%m-%d') >= ?`, [d, d]);
    for (const row of leaves) {
      await upsertLeaveAttendance(pool, row.emp_id, d);
      await removeOrphanLeaveAttendance(pool, row.emp_id);
    }
  }

  const isTodayInRange = today >= from && today <= capTo;
  if (isTodayInRange && nowTime >= LATE_DEADLINE) {
    const [employees] = await pool.query(
      `SELECT emp_id FROM employees WHERE emp_status IS NULL OR emp_status != '已离职'`);
    for (const emp of employees) {
      await markLateIfNeeded(pool, emp.emp_id, today);
    }
  }

  for (const d of dates) {
    if (d === today) continue;
    const [rows] = await pool.query(`
      SELECT emp_id FROM attendance
      WHERE check_date=? AND check_in IS NULL AND status NOT IN ('请假', '迟到')`, [d]);
    for (const row of rows) {
      await markLateIfNeeded(pool, row.emp_id, d);
    }
  }
}

module.exports = {
  LATE_DEADLINE,
  CHECKIN_LATE_AFTER,
  fmtLocalDate,
  dateRangeLocal,
  nowLocal,
  mysqlToday,
  isOnApprovedLeave,
  removeOrphanLeaveAttendance,
  syncLeaveToAttendance,
  syncLeaveByApplyId,
  ensureAttendanceForRange,
  upsertLeaveAttendance
};
