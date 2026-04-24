const db = require('../../config/db');
const { cache } = require('../../config/redis');

function calcChange(current, previous) {
  if (previous === 0) {
    return {
      value: current > 0 ? 100 : 0,
      trend: current > 0 ? 'up' : 'flat'
    };
  }
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change).toFixed(1),
    trend: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  };
}

exports.getDashboard = async (req, res, next) => {
  const client = await db.pool.connect();

  try {
    const salonId = req.user.salonId;
    console.log(`[Dashboard] Fetching for salonId: ${salonId}`);

    if (!salonId) {
      console.log('[Dashboard] Unauthorized - no salonId');
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const cacheKey = `dashboard:${salonId}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      console.log(`[Dashboard] Cache hit for ${cacheKey}`);
      return res.json(cached);
    }
    console.log(`[Dashboard] Cache miss for ${cacheKey}, querying DB`);

    await client.query('BEGIN');

    // Date ranges
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const prevMonthStart = new Date(monthStart);
    prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);

    // Queries
    console.log('[Dashboard] Running parallel queries');

    const [
      salonRes,
      todayVisitsRes,
      yesterdayVisitsRes,
      rewardsMonthRes,
      rewardsPrevMonthRes,
      pendingRes,
      totalCustomersRes,
      revenueCurrentRes,
      revenuePrevRes,
      recentScansRes
    ] = await Promise.all([
      // Salon name
      client.query(`SELECT name FROM salons WHERE id = $1`, [salonId]),
      // Today visits
      client.query(
        `SELECT COUNT(*) FROM visits
         WHERE salon_id = $1 AND created_at >= $2 AND created_at < $3`,
        [salonId, todayStart, todayEnd]
      ),
      // Yesterday visits
      client.query(
        `SELECT COUNT(*) FROM visits
         WHERE salon_id = $1 AND created_at >= $2 AND created_at < $3`,
        [salonId, new Date(todayStart - 86400000), todayStart]
      ),
      // Rewards this month (month-to-date)
      client.query(
        `SELECT COUNT(*) FROM reward_redemptions
         WHERE salon_id = $1 AND redeemed_at >= $2`,
        [salonId, monthStart]
      ),
      // Rewards previous month (full previous month)
      client.query(
        `SELECT COUNT(*) FROM reward_redemptions
         WHERE salon_id = $1 AND redeemed_at >= $2 AND redeemed_at < $3`,
        [salonId, prevMonthStart, monthStart]
      ),
      // Pending reviews (customers with no review)
      client.query(
        `SELECT COUNT(*) FROM salon_customers sc
         WHERE sc.salon_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM reviews r
           WHERE r.customer_id = sc.user_id
           AND r.salon_id = sc.salon_id
         )`,
        [salonId]
      ),
      // Total customers
      client.query(
        `SELECT COUNT(*) FROM salon_customers WHERE salon_id = $1`,
        [salonId]
      ),
      // Revenue current month
      client.query(
        `SELECT COALESCE(SUM(vs.price),0) FROM visit_services vs
         JOIN visits v ON v.id = vs.visit_id
         WHERE v.salon_id = $1
         AND v.created_at >= $2`,
        [salonId, monthStart]
      ),
      // Revenue previous month
      client.query(
        `SELECT COALESCE(SUM(vs.price),0) FROM visit_services vs
         JOIN visits v ON v.id = vs.visit_id
         WHERE v.salon_id = $1
         AND v.created_at >= $2 AND v.created_at < $3`,
        [salonId, prevMonthStart, monthStart]
      ),
      // Recent scans (last 10) – return raw timestamp
      client.query(
        `SELECT u.name AS customer_name, v.total_points, v.created_at
         FROM visits v
         JOIN users u ON u.id = v.customer_id
         WHERE v.salon_id = $1
         ORDER BY v.created_at DESC
         LIMIT 10`,
        [salonId]
      )
    ]);

    await client.query('COMMIT');
    console.log('[Dashboard] All queries committed');

    // Extract values
    const salonName = salonRes.rows[0]?.name || '';
    const todayVisits = Number(todayVisitsRes.rows[0].count);
    const yesterdayVisits = Number(yesterdayVisitsRes.rows[0].count);
    const rewardsMonth = Number(rewardsMonthRes.rows[0].count);
    const rewardsPrevMonth = Number(rewardsPrevMonthRes.rows[0].count);
    const pending = Number(pendingRes.rows[0].count);
    const totalCustomers = Number(totalCustomersRes.rows[0].count);
    const revenueCurrent = Number(revenueCurrentRes.rows[0].coalesce);
    const revenuePrev = Number(revenuePrevRes.rows[0].coalesce);

    // Format recent scans – send raw timestamp for frontend to format
    const recentScans = recentScansRes.rows.map(row => ({
      customerName: row.customer_name,
      createdAt: row.created_at.toISOString(), // ISO string (UTC)
      rewardPoints: row.total_points || 0
    }));

    // Calculate changes
    const visitChange = calcChange(todayVisits, yesterdayVisits);
    const rewardChange = calcChange(rewardsMonth, rewardsPrevMonth);
    const revenueChange = calcChange(revenueCurrent, revenuePrev);
    const pendingPercentage = totalCustomers === 0
      ? 0
      : ((pending / totalCustomers) * 100).toFixed(1);

    // Build response
    const response = {
      salonName,
      stats: {
        todayVisits,
        rewardsIssued: rewardsMonth,
        pendingReviews: pending,
        monthlyRevenue: revenueCurrent
      },
      changes: {
        visits: visitChange,
        rewards: rewardChange,
        revenue: revenueChange,
        pendingPercentage
      },
      recentScans
    };

    console.log('[Dashboard] Response prepared:', JSON.stringify(response, null, 2));

    await cache.set(cacheKey, response, 30);
    console.log(`[Dashboard] Cached for ${cacheKey}`);

    res.json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Dashboard] ERROR:', err);
    next(err);
  } finally {
    client.release();
    console.log('[Dashboard] DB client released');
  }
};