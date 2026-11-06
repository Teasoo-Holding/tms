import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, publicGet, qs } from '../api/client';
import { areaName, sectorLabel, subSectorLabel } from '../areaLabels';
import { ChartEmpty, LineChart, SERIES } from '../charts/charts';
import { Pagination, usePage } from '../components/Pagination';
import { fmtHeight, LatestPhoto, Lightbox, newestFirst, Thumbs } from '../components/Photos';
import { listSearchAt, neighbourQuery, Neighbours, TreePager } from '../components/TreePager';
import { ActiveFilter, CardHeader, EmptyState, ErrorNotice, FilterChips, fmtDate, fmtNum, SortOrder, SortTh, StatusBadge, VisitTypeTag } from '../components/ui';
import { SHOW_HEIGHT } from '../features';
import type { ShareContext } from './Share';
import { fmtShortDate } from '../time';

const FILTER_KEYS = ['planting_year_id', 'sector_id', 'sub_sector_id', 'species_id', 'status_id'];
/** Keys cleared when a parent filter changes: each planting year has its own sectors. */
const DEPENDENTS: Record<string, string[]> = { planting_year_id: ['sector_id', 'sub_sector_id'], sector_id: ['sub_sector_id'] };
const SORTS = ['tree_id', 'planting_year', 'area', 'species', 'status', 'last_observed'];
/** What a tree's page needs to step through the list it was opened from: its filters and sort. */
const LIST_KEYS = [...FILTER_KEYS, 'q', 'sort', 'order'];
const notMissing = (n: number, e: unknown) => (e as ApiError).status !== 404 && n < 1;

/** The client's tree list: search by tree ID, the main filters, sortable columns and pages, all in the URL. */
export function ShareTrees({ token, base, root, view }: ShareContext) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
      (DEPENDENTS[k] ?? []).forEach((d) => next.delete(d));
    }
    next.delete('offset');
    setParams(next, { replace: true });
  };
  const set = (k: string, v: string) => update({ [k]: v });
  const [q, setQ] = useState(get('q'));
  useEffect(() => setQ(get('q')), [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = usePage('', 50);
  const sort = SORTS.includes(get('sort')) ? get('sort') : 'tree_id';
  const order: SortOrder = get('order') === 'desc' ? 'desc' : 'asc';
  const query = qs({
    ...Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])),
    q: get('q'), sort: sort === 'tree_id' ? '' : sort, order: order === 'asc' ? '' : order, limit: page.limit, offset: page.offset,
  });
  const trees = useQuery({ queryKey: ['share-trees', token, query], queryFn: () => publicGet(`${base}/trees${query}`), retry: notMissing });

  const years: any[] = view?.planting_years ?? [];
  const yearId = get('planting_year_id');
  const yearLabel = new Map(years.map((y) => [y.id as string, y.year_label as string]));
  const sectors: any[] = (view?.areas ?? []).filter((s: any) => !yearId || s.planting_year_id === yearId || s.planting_year_id == null);
  const sector = sectors.find((s) => s.id === get('sector_id'));
  const subSectors: any[] = sector?.sub_sectors ?? [];
  const species: any[] = view?.species ?? [];
  const statuses: any[] = view?.statuses ?? [];
  const speciesName = (s: any) => s.common_name ?? s.scientific_name;

  const select = (k: string, label: string, options: [string, string][], all: string, disabled = false) => (
    <select aria-label={label} title={label} value={get(k)} onChange={(e) => set(k, e.target.value)} disabled={disabled}>
      <option value="">{all}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const chip = (key: string, label: string, value: string | undefined): ActiveFilter | null => (get(key) ? { key, label, value: value ?? '…', onClear: () => set(key, '') } : null);
  const chips = [
    chip('q', 'Tree ID', get('q')),
    chip('planting_year_id', 'Planting year', yearLabel.get(yearId)),
    chip('sector_id', 'Sector', sector && sectorLabel(sector)),
    chip('sub_sector_id', 'Sub-sector', (() => {
      const ss = subSectors.find((x) => x.id === get('sub_sector_id'));
      return ss && subSectorLabel(sector?.short_code, ss.short_code, ss.name);
    })()),
    chip('species_id', 'Species', (() => {
      const sp = species.find((x) => x.id === get('species_id'));
      return sp && speciesName(sp);
    })()),
    chip('status_id', 'Status', statuses.find((x) => x.id === get('status_id'))?.name),
  ].filter((c): c is ActiveFilter => !!c);
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  const onSort = (column: string, dir: SortOrder) => update({ sort: column === 'tree_id' ? '' : column, order: dir === 'asc' ? '' : dir });
  const th = (column: string, label: string, className?: string, initial?: SortOrder) => (
    <SortTh label={label} column={column} sort={sort} order={order} onSort={onSort} className={className} initial={initial} />
  );
  const open = (id: string) => navigate(`${root}/trees/${id}`, { state: { from: location.search } });
  const total: number = trees.data?.total ?? 0;
  const items: any[] = trees.data?.items ?? [];

  return (
    <div className="stack">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-title"><h2 style={{ margin: 0 }}>Trees</h2></div>
        <span className="spacer" />
        {trees.data && <span className="pill">{fmtNum(total)}</span>}
      </div>
      <div className="filter-bar">
        <form className="search" role="search" onSubmit={(e) => (e.preventDefault(), set('q', q.trim()))}>
          <input type="search" aria-label="Search by tree ID" placeholder="Search tree ID" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q.trim() !== get('q') && set('q', q.trim())} />
        </form>
        <div className="inline-filters" role="group" aria-label="Filters">
          {select('planting_year_id', 'Planting year', years.map((y) => [y.id, y.year_label]), 'All years')}
          {select('sector_id', 'Sector', sectors.map((s) => [s.id, `${sectorLabel(s)}${!yearId && s.planting_year_id ? ` (${yearLabel.get(s.planting_year_id) ?? ''})` : ''}`]), 'All sectors', sectors.length === 0)}
          {select('sub_sector_id', 'Sub-sector', subSectors.map((s) => [s.id, subSectorLabel(sector?.short_code, s.short_code, s.name)]), 'All sub-sectors', !sector)}
          {select('species_id', 'Species', species.map((s) => [s.id, speciesName(s)]), 'All species')}
          {select('status_id', 'Status', statuses.map((s) => [s.id, s.name]), 'Any status')}
        </div>
      </div>
      <FilterChips filters={chips} onClearAll={clearAll} />
      <ErrorNotice error={trees.error} />
      <div className={`card table-wrap ${trees.isFetching ? 'refetching' : ''}`}>
        {items.length > 0 && (
          <table>
            <thead>
              <tr>
                {th('tree_id', 'Tree ID')}
                {th('status', 'Status')}
                {th('species', 'Species', 'hide-sm')}
                {th('area', 'Area', 'hide-sm')}
                {th('planting_year', 'Planting year', 'hide-sm', 'desc')}
                {th('last_observed', 'Last visit', 'hide-sm', 'desc')}
                <th className="num hide-sm">Photos</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const area = subSectorLabel(t.sector_code, t.sub_sector_code, t.sub_sector_name);
                return (
                  <tr key={t.id} className="clickable" onClick={() => open(t.id)}>
                    <td className="mono nowrap">
                      <Link to={`${root}/trees/${t.id}`} state={{ from: location.search }} onClick={(e) => e.stopPropagation()}>{t.physical_tree_id}</Link>
                      <div className="muted show-sm" style={{ fontFamily: 'inherit' }}>{t.species_common_name ?? t.species_name} · {area}</div>
                    </td>
                    <td><StatusBadge code={t.status_code} name={t.status_name} terminal={t.status_terminal} /></td>
                    <td className="hide-sm">{t.species_common_name ?? t.species_name}</td>
                    <td className="hide-sm">{area}</td>
                    <td className="hide-sm nowrap">{t.year_label}</td>
                    <td className="hide-sm nowrap">{t.last_observed_at ? fmtDate(t.last_observed_at) : <span className="muted">Never</span>}</td>
                    <td className="num hide-sm">{t.photos ? fmtNum(t.photos) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {trees.data && items.length === 0 && <EmptyState title="No trees found">{chips.length ? 'Clear a filter or check the tree ID.' : undefined}</EmptyState>}
        {trees.isLoading && <div className="empty">Loading…</div>}
        <Pagination page={page} total={total} label="trees" />
      </div>
    </div>
  );
}

/** One tree: its photos (full size on click), details, height history and visit history. */
export function ShareTree({ token, base, root }: ShareContext) {
  const { treeId = '' } = useParams<{ treeId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  // The list's search string when opened from the tree list: Previous / Next follow its filters and sort.
  const from = (location.state as { from?: string } | null)?.from ?? '';
  const nq = neighbourQuery(from, LIST_KEYS);
  const neighbours = useQuery({
    queryKey: ['share-tree-neighbours', token, treeId, nq],
    queryFn: () => publicGet<Neighbours>(`${base}/trees/${treeId}/neighbours${nq}`),
    retry: notMissing,
  });
  const back = `${root}/trees${listSearchAt(from, neighbours.data?.position)}`;
  const tree = useQuery({ queryKey: ['share-tree', token, treeId], queryFn: () => publicGet(`${base}/trees/${treeId}`), retry: notMissing });
  const [lightbox, setLightbox] = useState<{ media: any[]; index: number } | null>(null);
  const t = tree.data;
  const crumbs = <TreePager data={neighbours.data} backTo={back} onGo={(id) => navigate(`${root}/trees/${id}`, { state: { from } })} />;
  if (tree.error) {
    return (
      <div className="stack">
        {crumbs}
        {(tree.error as ApiError).status === 404 && (tree.error as ApiError).code !== 'LINK_INVALID' ? <EmptyState title="Tree not found" /> : <ErrorNotice error={tree.error} />}
      </div>
    );
  }
  if (!t) return <div className="empty">Loading…</div>;
  const media: any[] = newestFirst(t.media ?? []);
  const observations: any[] = t.observations ?? [];
  const heights = observations
    .filter((o) => o.height_cm != null)
    .map((o) => ({ x: new Date(o.observed_at).getTime(), y: Number(o.height_cm) }))
    .sort((a, b) => a.x - b.x);
  const openPhoto = (list: any[], index: number) => setLightbox({ media: list, index });

  return (
    <div className="stack">
      {crumbs}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div className="page-title"><h2 className="mono" style={{ margin: 0 }}>{t.physical_tree_id}</h2></div>
        <StatusBadge code={t.status_code} name={t.status_name} terminal={t.status_terminal} />
      </div>

      {media[0] && <LatestPhoto media={media[0]} onOpen={() => openPhoto(media, 0)} />}

      <section className="card">
        <dl className="kv">
          <dt>Species</dt><dd>{t.species_common_name ? `${t.species_common_name} (${t.species_name})` : t.species_name}</dd>
          <dt>Area</dt>
          <dd>
            {subSectorLabel(t.sector_code, t.sub_sector_code, t.sub_sector_name)}
            {areaName(t.sector_code, t.sector_name) && <span className="muted"> · sector {areaName(t.sector_code, t.sector_name)}</span>}
          </dd>
          <dt>Planting year</dt><dd>{t.year_label}</dd>
          <dt>Planted on</dt><dd>{fmtDate(t.planted_on)}</dd>
          {t.vendor_name && (<><dt>Vendor</dt><dd>{t.vendor_name}</dd></>)}
          <dt>Last visit</dt><dd>{t.last_observed_at ? fmtDate(t.last_observed_at) : 'Not visited yet'}</dd>
          {SHOW_HEIGHT && heights.length > 0 && (<><dt>Height</dt><dd><strong>{fmtHeight(heights[heights.length - 1].y)}</strong> <span className="muted">on {fmtDate(new Date(heights[heights.length - 1].x).toISOString())}</span></dd></>)}
        </dl>
      </section>

      {media.length > 1 && (
        <section className="card">
          <CardHeader title={`Photos (${media.length})`} />
          <Thumbs media={media} onOpen={(i) => openPhoto(media, i)} />
        </section>
      )}

      {SHOW_HEIGHT && (
        <section className="card">
          <CardHeader title="Height history" description="Height at each visit." />
          {heights.length < 2 ? (
            <ChartEmpty>{heights.length === 1 ? `One height so far: ${fmtHeight(heights[0].y)}.` : 'No heights recorded yet.'}</ChartEmpty>
          ) : (
            <LineChart
              series={[{ key: 'height', label: 'Height', color: SERIES[2], points: heights }]}
              unit="cm"
              xFormat={fmtShortDate}
              ariaLabel={`Height of tree ${t.physical_tree_id} over time`}
            />
          )}
        </section>
      )}

      <section className="card">
        <CardHeader title="Visits" />
        {observations.length === 0 && <div className="empty">No visits yet.</div>}
        <ol className="timeline">
          {observations.map((o) => {
            const photos = media.filter((m) => m.observation_id === o.id);
            return (
              <li key={o.id}>
                <div className="row">
                  <StatusBadge code={o.status_code} name={o.status_name} terminal={o.status_terminal} />
                  <strong>{fmtDate(o.observed_at)}</strong>
                  <VisitTypeTag visit={o} />
                  {o.is_amendment && <span className="pill" title="This record corrects an earlier one">Corrected</span>}
                </div>
                {SHOW_HEIGHT && o.height_cm != null && <div className="muted">Height {fmtHeight(Number(o.height_cm))}</div>}
                {o.remarks && <div>{o.remarks}</div>}
                {photos.length > 0 && <Thumbs media={photos} onOpen={(i) => openPhoto(photos, i)} />}
              </li>
            );
          })}
        </ol>
      </section>
      {lightbox && <Lightbox media={lightbox.media} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
