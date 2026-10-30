import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useIsAdmin } from '../auth';
import { ChartEmpty, LineChart, SERIES } from '../charts/charts';
import { fmtHeight, LatestPhoto, Lightbox, newestFirst, Thumbs } from '../components/Photos';
import { CardHeader, ErrorNotice, Field, fmtDate, fmtDateTime, Modal, PageHeader, RecordStatePill, RowMenu, StatusPill } from '../components/ui';
import { SHOW_HEIGHT } from '../features';
import { currentScheme, previewId, Scheme } from '../idscheme';
import type { CustomField } from './ProjectDetail';

export function TreeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const [correcting, setCorrecting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [lightbox, setLightbox] = useState<{ media: any[]; index: number; observation?: any } | null>(null);
  const tree = useQuery({ queryKey: ['tree', id], queryFn: () => api.get(`/trees/${id}`) });
  const t = tree.data;
  const defs = useQuery({
    queryKey: ['custom-fields', t?.project_id],
    queryFn: () => api.get<CustomField[]>(`/projects/${t.project_id}/custom-fields`),
    enabled: !!t?.project_id,
  });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses'), enabled: isAdmin });
  if (tree.error) return <ErrorNotice error={tree.error} />;
  if (!t) return null;
  const media: any[] = t.media ?? [];
  const observations: any[] = t.observations ?? [];
  const treeDefs = (defs.data ?? []).filter((d) => d.applies_to === 'TREE');
  const obsDefs = (defs.data ?? []).filter((d) => d.applies_to === 'OBSERVATION');
  const heights = observations
    .filter((o) => !o.superseded && o.height_cm != null)
    .map((o) => ({ x: new Date(o.observed_at).getTime(), y: Number(o.height_cm) }))
    .sort((a, b) => a.x - b.x);
  // The most recent visit with a height (corrections replace the originals).
  const latestHeight = heights[heights.length - 1];
  // Replanting: an active tree whose current status allows replacement and that has not been replaced yet.
  const currentStatus = statuses.data?.find((s) => s.code === t.status_code);
  const alreadyReplaced = t.lineage.some((l: any) => l.generation === 1);
  const canReplace = isAdmin && t.record_state === 'ACTIVE' && !!currentStatus?.allows_replacement && !alreadyReplaced;
  const hasLineage = t.lineage.length > 1 || t.physical_id_history.length > 0;
  const latest = newestFirst(media)[0];
  const openPhoto = (m: any) => {
    const list = m.observation_id ? media.filter((x) => x.observation_id === m.observation_id) : media.filter((x) => !x.observation_id);
    setLightbox({ media: list, index: Math.max(0, list.indexOf(m)), observation: observations.find((o) => o.id === m.observation_id) });
  };
  return (
    <div className="stack">
      <PageHeader
        crumbs={<><Link to="/trees">Trees</Link> / {t.project_name}</>}
        title={t.physical_tree_id}
        mono
        actions={
          <>
            {canReplace && <button className="primary" onClick={() => setReplacing(true)}>Plant replacement</button>}
            <Link className="btn" to={`/visits?q=${encodeURIComponent(t.physical_tree_id)}`}>Visits</Link>
            {isAdmin && <RowMenu label="Tree actions" items={[{ label: 'Correct serial', onClick: () => setCorrecting(true) }]} />}
          </>
        }
      >
        <StatusPill code={t.status_code} name={t.status_name} />
        <RecordStatePill state={t.record_state} />
      </PageHeader>

      {latest && <LatestPhoto media={latest} onOpen={() => openPhoto(latest)} />}

      <div className={hasLineage ? 'grid cols-2' : 'stack'}>
        <section className="card">
          <dl className="kv">
            <dt>Planting year</dt><dd>{t.year_label}</dd>
            <dt>Area</dt><dd>{t.sector_code} · {t.sector_name} / {t.sub_sector_code} · {t.sub_sector_name}</dd>
            <dt>Species</dt><dd>{t.species_name}{t.species_common_name && ` (${t.species_common_name})`}</dd>
            {t.vendor_name && (<><dt>Vendor</dt><dd>{t.vendor_name}</dd></>)}
            <dt>Planted on</dt><dd>{fmtDate(t.planted_on)}</dd>
            {SHOW_HEIGHT && (
              <>
                <dt>Height</dt>
                <dd>
                  {latestHeight ? (
                    <><strong>{fmtHeight(latestHeight.y)}</strong> <span className="muted">on {fmtDate(new Date(latestHeight.x).toISOString())}</span></>
                  ) : (
                    <span className="muted">not recorded</span>
                  )}
                </dd>
              </>
            )}
            {t.notes && (<><dt>Notes</dt><dd>{t.notes}</dd></>)}
          </dl>
          <CustomValues values={t.custom_fields} defs={treeDefs} empty="" />
          <details className="more" style={{ marginTop: 12 }}>
            <summary>More details</summary>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>Registered</dt><dd>{fmtDateTime(t.created_at)} by {t.created_by_name}</dd>
              <dt>Synced</dt><dd>{fmtDateTime(t.synced_at)}</dd>
              <dt>ID format</dt>
              <dd>
                Version {t.id_scheme_version}:{' '}
                {t.id_components_snapshot.components.map((c: any) => (
                  <span key={c.type} className="mono" title={c.type} style={{ marginRight: 6 }}>
                    {c.value ?? '∅'}{c.matches_current_code === false && <span className="muted"> (code since changed)</span>}
                  </span>
                ))}
              </dd>
              <dt>Internal ID</dt><dd className="mono" style={{ fontSize: 12 }}>{t.id}</dd>
              <dt>Revision</dt><dd>{t.revision}</dd>
            </dl>
          </details>
        </section>

        {hasLineage && <section className="card">
          {t.lineage.length > 1 && <h2>Replacements</h2>}
          {t.lineage.length > 1 && (
            <ol className="timeline">
              {t.lineage.map((l: any) => (
                <li key={l.id}>
                  <div>
                    {l.id === t.id ? <strong className="mono">{l.physical_tree_id}</strong> : <Link className="mono" to={`/trees/${l.id}`}>{l.physical_tree_id}</Link>}{' '}
                    <span className="muted">· planting year {l.year_label} · {l.status_name ?? 'not observed'}</span>
                  </div>
                  <div className="muted">{l.generation < 0 ? 'Original (replaced)' : l.generation === 0 ? 'This tree' : `Replacement generation ${l.generation}`}</div>
                </li>
              ))}
            </ol>
          )}
          {t.physical_id_history.length > 0 && (
            <>
              <h3 style={{ marginTop: t.lineage.length > 1 ? 16 : 0 }}>ID corrections</h3>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {t.physical_id_history.map((h: any) => (
                  <li key={h.id}>
                    <span className="mono">{h.previous_physical_id}</span> → <span className="mono">{h.new_physical_id}</span>
                    <div className="muted">{fmtDateTime(h.changed_at)} by {h.changed_by_name}: {h.reason}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>}
      </div>

      {SHOW_HEIGHT && (
      <section className="card">
        <CardHeader title="Growth" description="Height at each visit (corrected entries replace the originals)." />
        {heights.length < 2 ? (
          <ChartEmpty>Record height on at least two visits to see growth.{heights.length === 1 && ` One height so far: ${fmtHeight(heights[0].y)}.`}</ChartEmpty>
        ) : (
          <LineChart
            series={[{ key: 'height', label: 'Height', color: SERIES[2], points: heights }]}
            unit="cm"
            xFormat={(x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })}
            ariaLabel={`Height of tree ${t.physical_tree_id} over time`}
          />
        )}
      </section>
      )}

      <section className="card">
        <CardHeader title="Visits" />
        {observations.length === 0 && <div className="empty">No visits yet.</div>}
        <ol className="timeline">
          {observations.map((o: any) => {
            const photos = media.filter((m: any) => m.observation_id === o.id);
            const extras = customEntries(o.custom_fields, obsDefs);
            return (
              <li key={o.id} className={o.superseded ? 'superseded' : ''}>
                <div className="row">
                  <StatusPill code={o.status_code} name={o.status_name} />
                  <strong>{fmtDateTime(o.observed_at)}</strong>
                  {o.is_amendment && <span className="pill warning">Correction</span>}
                  {o.superseded && <span className="pill">Superseded by a correction</span>}
                </div>
                <div className="muted" title={`Recorded ${fmtDateTime(o.recorded_at ?? o.observed_at)} · synced ${fmtDateTime(o.synced_at)}`}>
                  {o.recorded_by_name ?? 'Unknown'}
                </div>
                {(SHOW_HEIGHT || extras.length > 0) && (
                <dl className="obs-meta">
                  {SHOW_HEIGHT && (
                  <div>
                    <dt>Height</dt>
                    <dd>
                      {o.height_cm != null ? (
                        <>
                          <strong>{fmtHeight(Number(o.height_cm))}</strong>{' '}
                          <span className="muted">({o.height_method === 'PHOTO_REFERENCE' ? 'measured on photo' : 'entered'})</span>
                        </>
                      ) : (
                        <span className="muted">not recorded</span>
                      )}
                    </dd>
                  </div>
                  )}
                  {extras.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                )}
                {o.amendment_reason && <div>Correction reason: {o.amendment_reason}</div>}
                {o.remarks && <div>{o.remarks}</div>}
                <Thumbs media={photos} onOpen={(index) => setLightbox({ media: photos, index, observation: o })} />
              </li>
            );
          })}
        </ol>
        {media.some((m: any) => !m.observation_id) && (
          <>
            <h3 style={{ marginTop: 8 }}>Other photos</h3>
            <Thumbs
              media={media.filter((m: any) => !m.observation_id)}
              onOpen={(index) => setLightbox({ media: media.filter((m: any) => !m.observation_id), index })}
            />
          </>
        )}
      </section>
      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
      {correcting && <CorrectSerial tree={t} onClose={() => setCorrecting(false)} />}
      {replacing && <ReplacementForm tree={t} onClose={() => setReplacing(false)} />}
    </div>
  );
}

function formatValue(v: unknown, type?: CustomField['field_type']): string {
  if (v == null || v === '') return '—';
  if (type === 'BOOLEAN' || typeof v === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No';
  if (type === 'DATE' && typeof v === 'string') return fmtDate(v);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** [label, formatted value] pairs: defined fields in their configured order, then unknown keys shown raw. */
function customEntries(values: Record<string, unknown> | null | undefined, defs: CustomField[]): [string, string][] {
  if (!values) return [];
  const known = [...defs].sort((a, b) => a.sort_order - b.sort_order).filter((d) => d.key in values);
  const unknown = Object.keys(values).filter((k) => !defs.some((d) => d.key === k));
  return [
    ...known.map((d): [string, string] => [d.label + (d.active ? '' : ' (inactive)'), formatValue(values[d.key], d.field_type)]),
    ...unknown.map((k): [string, string] => [k, formatValue(values[k])]),
  ];
}

function CustomValues({ values, defs, empty }: { values: Record<string, unknown> | null | undefined; defs: CustomField[]; empty: string }) {
  const entries = customEntries(values, defs);
  if (entries.length === 0) return empty ? <p className="muted" style={{ margin: 0 }}>{empty}</p> : null;
  return (
    <dl className="kv" style={{ marginTop: 6 }}>
      {entries.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CorrectSerial({ tree, onClose }: { tree: any; onClose: () => void }) {
  const [serial, setSerial] = useState(tree.serial_number);
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => api.post(`/trees/${tree.id}/physical-id-corrections`, { serial_input: serial, reason }), onSuccess: onClose });
  const prefix = tree.physical_tree_id.slice(0, tree.physical_tree_id.length - tree.serial_number.length);
  return (
    <Modal title="Correct the serial number" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <p className="muted" style={{ margin: 0 }}>Use when the serial does not match the physical label. The old ID is kept in the history.</p>
        <ErrorNotice error={save.error} />
        <div className="id-preview">{prefix}<span className="serial">{serial.padStart(tree.serial_number.length, '0')}</span></div>
        <Field label="Serial"><input required inputMode="numeric" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Reason"><textarea required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save correction</button>
        </div>
      </form>
    </Modal>
  );
}

/** Client-generated record IDs (the API is idempotent on them, like the Android app). */
const newId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));

/** Hand-set tree IDs: letters, digits, - _ / . (starting with a letter or digit), up to 64 characters. */
const CUSTOM_ID = /^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/;

/** Administrator back-entry of a replacement tree (POST /trees/:id/replacements, a CreateTree payload). */
function ReplacementForm({ tree, onClose }: { tree: any; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pid: string = tree.project_id;
  const project = useQuery({ queryKey: ['project', pid], queryFn: () => api.get(`/projects/${pid}`) });
  const areas = useQuery({ queryKey: ['areas', pid], queryFn: () => api.get<any[]>(`/projects/${pid}/areas`) });
  const species = useQuery({ queryKey: ['tree-species'], queryFn: () => api.get<any[]>('/tree-species') });
  const statuses = useQuery({ queryKey: ['tree-statuses'], queryFn: () => api.get<any[]>('/tree-statuses') });
  // Generated once, so a retry after a network failure cannot register the tree twice.
  const [ids] = useState(() => ({ tree: newId(), observation: newId() }));
  const [v, setV] = useState({
    planting_year_id: '',
    sector_id: tree.sector_id as string,
    sub_sector_id: tree.sub_sector_id as string,
    species_id: tree.species_id as string,
    vendor_id: (tree.vendor_id ?? '') as string,
    status_id: '',
    serial: '',
    custom: false,
    custom_id: '',
    remarks: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const set = (k: keyof typeof v, value: string | boolean) => setV((x) => ({ ...x, [k]: value }));

  const p = project.data;
  const years: any[] = p?.planting_years ?? [];
  // Default: the latest open planting year (replanting usually happens in a later season).
  const defaultYear = [...years].reverse().find((y) => y.active) ?? years[years.length - 1];
  const yearId: string = years.some((y) => y.id === v.planting_year_id) ? v.planting_year_id : defaultYear?.id ?? '';
  const year = years.find((y) => y.id === yearId);
  // The year's survey, plus older areas not tied to a year; choices invalid for the year fall back to empty.
  const sectors = (areas.data ?? []).filter((s) => s.active && (s.planting_year_id === yearId || s.planting_year_id == null));
  const sectorId = sectors.some((s) => s.id === v.sector_id) ? v.sector_id : '';
  const sector = sectors.find((s) => s.id === sectorId);
  const subSectors: any[] = (sector?.sub_sectors ?? []).filter((ss: any) => ss.active);
  const subSectorId = subSectors.some((ss) => ss.id === v.sub_sector_id) ? v.sub_sector_id : '';
  const subSector = subSectors.find((ss) => ss.id === subSectorId);
  const vendorLinks: any[] = (p?.planting_year_vendors ?? []).filter((l: any) => l.planting_year_id === yearId && l.active);
  const vendorId = vendorLinks.some((l) => l.vendor_id === v.vendor_id) ? v.vendor_id : '';
  const speciesOptions = (species.data ?? []).filter((s) => s.active !== false);
  const speciesId = speciesOptions.some((s) => s.id === v.species_id) ? v.species_id : '';
  const statusOptions = (statuses.data ?? []).filter((s) => s.active !== false && !s.is_terminal);
  const statusId = statusOptions.some((s) => s.id === v.status_id) ? v.status_id : (statusOptions.find((s) => s.code === 'PLANTED') ?? statusOptions[0])?.id ?? '';
  // One format per project, whatever the vendor or year; the vendor is attribution only.
  const scheme: Scheme | undefined = p ? currentScheme(p.tree_id_schemes ?? []) : undefined;
  const preview = scheme
    ? previewId(
        scheme.component_definition,
        scheme.separator,
        scheme.serial_width,
        { PROJECT_CODE: p.short_code, PLANTING_YEAR: year?.year_label, SECTOR_CODE: sector?.short_code, SUB_SECTOR_CODE: subSector?.short_code },
        v.serial || '0',
      )
    : null;

  const save = useMutation({
    mutationFn: () =>
      api.post<{ status: string; entity?: any }>(`/trees/${tree.id}/replacements`, {
        id: ids.tree,
        project_id: pid,
        planting_year_id: yearId,
        sector_id: sectorId,
        sub_sector_id: subSectorId,
        species_id: speciesId,
        vendor_id: vendorId || null,
        id_scheme_id: scheme!.id,
        serial_input: v.custom ? '' : v.serial.trim(),
        ...(v.custom ? { custom_physical_id: v.custom_id.trim() } : {}),
        initial_observation: {
          id: ids.observation,
          status_id: statusId,
          observed_at: new Date().toISOString(),
          remarks: v.remarks.trim() || null,
          visit_type: 'PLANTING',
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tree', tree.id] });
      onClose();
      if (res?.entity?.id) navigate(`/trees/${res.entity.id}`);
    },
  });

  const submit = () => {
    const customId = v.custom_id.trim();
    let problem: string | null = null;
    if (!scheme) problem = 'This project has no tree ID format yet. Define one under Projects → ID format.';
    else if (!yearId || !sectorId || !subSectorId) problem = 'Choose the planting year, sector and sub-sector.';
    else if (!speciesId) problem = 'Choose the species.';
    else if (!statusId) problem = 'Choose the observed status.';
    else if (v.custom && (!customId || customId.length > 64 || !CUSTOM_ID.test(customId))) problem = 'The tree ID may use letters, digits and - _ / . (starting with a letter or digit), up to 64 characters.';
    else if (!v.custom && !/^\d{1,32}$/.test(v.serial.trim())) problem = 'Enter the serial (tree number) from the label, digits only.';
    setLocalError(problem);
    if (!problem) save.mutate();
  };

  const loading = !p || !areas.data || !species.data || !statuses.data;
  const select = (label: string, value: string, onChange: (value: string) => void, options: [string, string][], placeholder: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0}>
        <option value="">{options.length === 0 ? 'None available' : placeholder}</option>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </Field>
  );

  return (
    <Modal title="Plant a replacement tree" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
        <p className="subtle" style={{ margin: 0 }}>
          Registers a new tree that replaces <strong className="mono">{tree.physical_tree_id}</strong>. The original keeps its history and the two are linked in the lineage.
        </p>
        {localError && <div className="notice error" role="alert">{localError}</div>}
        <ErrorNotice error={project.error ?? areas.error ?? save.error} />
        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <div className="form-grid">
              {select('Planting year', yearId, (x) => set('planting_year_id', x), years.map((y) => [y.id, `${y.year_label}${y.active ? '' : ' (closed)'}`]), 'Choose a year')}
              {select('Sector', sectorId, (x) => set('sector_id', x), sectors.map((s) => [s.id, `${s.short_code} · ${s.name}`]), 'Choose a sector')}
              {select('Sub-sector', subSectorId, (x) => set('sub_sector_id', x), subSectors.map((s) => [s.id, `${s.short_code} · ${s.name}`]), sectorId ? 'Choose a sub-sector' : 'Choose a sector first')}
              {select('Species', speciesId, (x) => set('species_id', x), speciesOptions.map((s) => [s.id, s.common_name ? `${s.common_name} (${s.scientific_name})` : s.scientific_name]), 'Choose a species')}
              {select('Vendor', vendorId, (x) => set('vendor_id', x), vendorLinks.map((l) => [l.vendor_id, l.vendor_short_code ? `${l.vendor_name} (${l.vendor_short_code})` : l.vendor_name]), 'No vendor', 'optional; who planted it')}
              {select('Observed status', statusId, (x) => set('status_id', x), statusOptions.map((s) => [s.id, s.name]), 'Choose a status')}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <label className="check">
                <input type="checkbox" checked={v.custom} onChange={(e) => set('custom', e.target.checked)} /> Set the new tree’s ID by hand
              </label>
              {v.custom ? (
                <Field label="New tree ID" hint="letters, digits, - _ / . up to 64 characters">
                  <input className="mono" required maxLength={64} autoCapitalize="none" spellCheck={false} value={v.custom_id} onChange={(e) => set('custom_id', e.target.value)} />
                </Field>
              ) : (
                <>
                  <Field label="Serial" hint={scheme ? `tree number, ${scheme.serial_width} digits` : undefined}>
                    <input required inputMode="numeric" maxLength={32} value={v.serial} onChange={(e) => set('serial', e.target.value)} />
                  </Field>
                  {preview ? (
                    <div className="id-preview small">{preview.prefix}<span className="serial">{preview.serial}</span></div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>This project has no tree ID format yet.</p>
                  )}
                </>
              )}
            </div>
            <Field label="Remarks" hint="optional">
              <textarea maxLength={4000} value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />
            </Field>
          </>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending || loading}>{save.isPending ? 'Saving…' : 'Register replacement'}</button>
        </div>
      </form>
    </Modal>
  );
}
