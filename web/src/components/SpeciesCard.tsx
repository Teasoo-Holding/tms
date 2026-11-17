import { ReactNode } from 'react';
import { ChartCard, HBarChart, sharePct } from '../charts/charts';
import { fmtNum, SimpleTable } from './ui';

type Row = { id?: string | null; name: string; common_name?: string | null; count: number };

/**
 * Trees by species with each species' share of the total (#134). The total is the trees in the chart, under the same
 * project, filters and dates as the counts. Each percentage is rounded to one decimal on its own, so the shares can
 * add up to 99.9% or 100.1%; the total row always shows 100%.
 */
export function SpeciesCard({ rows, name = (r) => r.common_name ?? r.name }: { rows: Row[]; name?: (r: Row) => ReactNode }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ChartCard
      title="Trees by species"
      subtitle={total > 0 ? `Share of the ${fmtNum(total)} ${total === 1 ? 'tree' : 'trees'} shown, to one decimal place.` : undefined}
      empty={rows.length === 0 && 'No trees yet.'}
      table={
        <SimpleTable
          head={['Species', 'Trees', 'Share']}
          numeric={[1, 2]}
          rows={[...rows.map((r) => [name(r), fmtNum(r.count), sharePct(r.count, total)]), [<strong key="t">Total</strong>, <strong key="n">{fmtNum(total)}</strong>, <strong key="p">100%</strong>]]}
        />
      }
    >
      <HBarChart share data={rows.map((r) => ({ label: r.common_name ?? r.name, value: r.count }))} />
    </ChartCard>
  );
}
