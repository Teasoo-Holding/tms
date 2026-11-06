/**
 * Maintenance planning. Each project has a maintenance interval (projects.maintenance_interval_days). A tree's
 * proposed maintenance date is that many days after its latest maintenance visit (an observation with visit_type
 * MAINTENANCE that no correction replaced), else after its planting date, else after its registration date.
 *
 * Status: `none` for trees that are not active registry records or whose current status is terminal (dead, missing);
 * otherwise `overdue` when the proposed date has passed, `due_soon` when it falls within the next
 * MAINTENANCE_DUE_SOON_DAYS days (today included), else `scheduled`. Dates are UTC calendar days.
 *
 * The SQL below expects the aliases t (trees), p (projects) and st (tree_statuses, left-joined on the tree's current
 * status), plus MAINTENANCE_JOIN.
 */
export const MAINTENANCE_DUE_SOON_DAYS = 14;
export const MAINTENANCE_STATUSES = ['none', 'overdue', 'due_soon', 'scheduled'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

/** mt.last_at: the tree's latest maintenance visit (null when it has none). */
export const MAINTENANCE_JOIN = `LEFT JOIN LATERAL (
    SELECT max(o.observed_at) AS last_at FROM tree_observations o
     WHERE o.tree_id = t.id AND o.visit_type = 'MAINTENANCE'
       AND NOT EXISTS (SELECT 1 FROM tree_observations a WHERE a.amends_observation_id = o.id)) mt ON true`;

const TODAY = `(now() AT TIME ZONE 'Africa/Lagos')::date`;
export const MAINTENANCE_PROPOSED_SQL =
  `(COALESCE((mt.last_at AT TIME ZONE 'Africa/Lagos')::date, t.planted_on, (t.created_at AT TIME ZONE 'Africa/Lagos')::date) + p.maintenance_interval_days)`;
export const MAINTENANCE_STATUS_SQL = `(CASE
    WHEN t.record_state <> 'ACTIVE' OR COALESCE(st.is_terminal, false) THEN 'none'
    WHEN ${MAINTENANCE_PROPOSED_SQL} < ${TODAY} THEN 'overdue'
    WHEN ${MAINTENANCE_PROPOSED_SQL} <= ${TODAY} + ${MAINTENANCE_DUE_SOON_DAYS} THEN 'due_soon'
    ELSE 'scheduled' END)`;

/** Select-list columns; withMaintenance() folds them into one `maintenance` object. */
export const MAINTENANCE_COLUMNS = `mt.last_at AS maintenance_last_at, ${MAINTENANCE_PROPOSED_SQL} AS maintenance_proposed_on,
  ${MAINTENANCE_STATUS_SQL} AS maintenance_status`;

export interface Maintenance {
  /** Latest maintenance visit, or null. */
  last_at: string | null;
  /** YYYY-MM-DD. */
  proposed_on: string;
  status: MaintenanceStatus;
}

export function withMaintenance<T extends Record<string, any>>(row: T) {
  const { maintenance_last_at, maintenance_proposed_on, maintenance_status, ...rest } = row;
  const maintenance: Maintenance = {
    last_at: maintenance_last_at ? new Date(maintenance_last_at).toISOString() : null,
    proposed_on: maintenance_proposed_on,
    status: maintenance_status,
  };
  return { ...rest, maintenance };
}
