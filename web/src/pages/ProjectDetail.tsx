import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { AreaMap, MapArea } from '../components/AreaMap';
import { areaHectares, AreaSketch, boundaryCorners, LonLat, orderCorners } from '../components/AreaSketch';
import { ActivePill, CardHeader, clean, EmptyState, ErrorNotice, Field, fmtDate, fmtDateTime, Modal, PageHeader, Tabs, useForm } from '../components/ui';
import {
  COMPONENTS,
  componentLabel,
  effectiveScheme,
  isFixedPart,
  LEVEL_LABEL,
  levelOf,
  previewId,
  RECOMMENDED_SCOPE,
  Scheme,
  SchemeComponent,
  SCOPES,
  scopeLabel,
  TEXT_VALUE,
} from '../idscheme';
import { ProjectForm } from './Projects';

type Tab = 'areas' | 'vendors' | 'schemes' | 'years' | 'fields' | 'assignments' | 'serials';
const TABS: Tab[] = ['areas', 'vendors', 'schemes', 'years', 'fields', 'assignments', 'serials'];

interface PlantingYear {
  id: string;
  year_label: string;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
}
interface VendorLink {
  id: string;
  planting_year_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_short_code: string | null;
  active: boolean;
}

/** The latest open year, else the latest year: what an administrator most likely works on. */
const defaultYear = (years: PlantingYear[]) => [...years].reverse().find((y) => y.active) ?? years[years.length - 1];
const yearLinks = (project: any, yearId?: string): VendorLink[] => (project.planting_year_vendors ?? []).filter((l: VendorLink) => l.planting_year_id === yearId);

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isAdmin = useIsAdmin();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'areas';
  const setParam = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => next.set(k, v));
    setParams(next, { replace: true, state: location.state });
  };
  const setTab = (t: Tab) => setParam({ tab: t });
  const [editing, setEditing] = useState(false);
  const [addingYear, setAddingYear] = useState(false);
  const project = useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/projects/${id}`) });
  const p = project.data;
  if (project.error) return <ErrorNotice error={project.error} />;
  if (!p) return null;
  const years: PlantingYear[] = p.planting_years;
  const year = years.find((y) => y.id === params.get('year')) ?? defaultYear(years);
  const setYear = (yearId: string) => setParam({ year: yearId });
  const tabs: [Tab, string][] = [
    ['areas', 'Areas'],
    ['vendors', 'Vendors'],
    ['schemes', 'Tree ID format'],
    ['years', 'Planting years'],
    ['fields', 'Custom fields'],
  ];
  if (isAdmin) tabs.push(['assignments', 'Officers & assignments'], ['serials', 'Serial ranges']);
  const addYear = () => setAddingYear(true);
  return (
    <div className="stack" style={{ gap: 0 }}>
      <PageHeader
        crumbs={<><Link to="/projects">Projects</Link> /</>}
        title={p.name}
        subtitle={
          <>
            <span className="mono">{p.short_code}</span> · <span className="pill">{p.status.toLowerCase()}</span> · {p.location ?? 'no location'} · IDs unique{' '}
            {p.physical_id_uniqueness === 'GLOBAL' ? 'across all projects' : 'within project'}
          </>
        }
        actions={isAdmin && <button onClick={() => setEditing(true)}>Edit project</button>}
      />
      <YearBar years={years} selected={year} onSelect={setYear} onAdd={isAdmin ? addYear : undefined} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'areas' && <AreasTab project={p} year={year} onAddYear={addYear} />}
      {tab === 'vendors' && <VendorsTab project={p} year={year} onAddYear={addYear} onTab={setTab} />}
      {tab === 'schemes' && <SchemesTab project={p} year={year} />}
      {tab === 'years' && <YearsTab project={p} selected={year} onSelect={setYear} onAdd={addYear} />}
      {tab === 'fields' && <CustomFieldsTab projectId={p.id} />}
      {tab === 'assignments' && <AssignmentsTab projectId={p.id} year={year} />}
      {tab === 'serials' && <SerialsTab project={p} year={year} />}
      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} />}
      {addingYear && <YearForm projectId={p.id} onClose={() => setAddingYear(false)} onCreated={(y) => setParam({ year: y.id })} />}
    </div>
  );
}

// ------------------------------------------------------------------ planting-year selector
function YearBar({ years, selected, onSelect, onAdd }: { years: PlantingYear[]; selected?: PlantingYear; onSelect: (id: string) => void; onAdd?: () => void }) {
  return (
    <div className="year-bar" role="group" aria-label="Planting year">
      <strong>Planting year</strong>
      {years.map((y) => (
        <button key={y.id} type="button" className="chip" aria-pressed={y.id === selected?.id} onClick={() => onSelect(y.id)} title={y.active ? undefined : 'Closed for new registrations'}>
          {y.year_label}
          {!y.active && ' (closed)'}
        </button>
      ))}
      {onAdd && <button type="button" className="chip add" onClick={onAdd}>+ Add planting year</button>}
      <span className="muted">
        {years.length === 0
          ? onAdd
            ? 'Start by adding the year being planted, e.g. 2026.'
            : 'No planting years yet.'
          : 'The selected year drives the Areas, Vendors and Tree ID format tabs.'}
      </span>
    </div>
  );
}

function YearForm({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated?: (year: PlantingYear) => void }) {
  const f = useForm({ year_label: String(new Date().getFullYear()), start_date: '', end_date: '' });
  const create = useMutation({
    mutationFn: () => api.post<PlantingYear>(`/projects/${projectId}/planting-years`, clean({ ...f.values, year_label: f.values.year_label.trim() })),
    onSuccess: (y) => {
      onCreated?.(y);
      onClose();
    },
  });
  const apiError = create.error as ApiError | null;
  return (
    <Modal title="Add planting year" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        {apiError?.code === 'YEAR_EXISTS' ? <div className="notice error" role="alert">This planting year already exists for the project.</div> : <ErrorNotice error={create.error} />}
        <p className="muted" style={{ margin: 0 }}>
          Each planting year has its own land survey (sectors and sub-sectors), its own vendors and, if needed, its own tree ID format. The label becomes part of tree IDs and cannot change later.
        </p>
        <div className="form-grid">
          <Field label="Label" hint="e.g. 2026 or WET26"><input required maxLength={16} {...f.bind('year_label')} /></Field>
          <Field label="Start date" hint="optional"><input type="date" {...f.bind('start_date')} /></Field>
          <Field label="End date" hint="optional"><input type="date" {...f.bind('end_date')} /></Field>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={create.isPending}>Add planting year</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ custom fields
export interface CustomField {
  id: string;
  project_id: string;
  applies_to: 'TREE' | 'OBSERVATION';
  key: string;
  label: string;
  field_type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN';
  options: string[];
  required: boolean;
  sticky: boolean;
  help_text: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export const FIELD_TYPE_LABEL: Record<CustomField['field_type'], string> = { TEXT: 'Text', NUMBER: 'Number', DATE: 'Date', SELECT: 'Choice list', BOOLEAN: 'Yes / no' };
const APPLIES_TO: [CustomField['applies_to'], string, string][] = [
  ['TREE', 'Recorded once per tree (at registration)', 'e.g. Nursery batch number, Seedling source, Spacing (m)'],
  ['OBSERVATION', 'Recorded at every visit/observation', 'e.g. Stem diameter (mm), Weeded, Pest signs'],
];

function CustomFieldsTab({ projectId }: { projectId: string }) {
  const isAdmin = useIsAdmin();
  const fields = useQuery({ queryKey: ['custom-fields', projectId], queryFn: () => api.get<CustomField[]>(`/projects/${projectId}/custom-fields`) });
  const [form, setForm] = useState<{ field?: CustomField; appliesTo: CustomField['applies_to'] } | null>(null);
  return (
    <div className="stack">
      <p className="subtle" style={{ margin: 0 }}>
        Extra questions the Android app asks for this project, beyond species, status and height. Fields can be deactivated but not deleted, so values already recorded are kept.
      </p>
      <ErrorNotice error={fields.error} />
      {APPLIES_TO.map(([appliesTo, title, example]) => {
        const rows = (fields.data ?? []).filter((f) => f.applies_to === appliesTo);
        return (
          <section className="card flush" key={appliesTo}>
            <CardHeader
              title={title}
              description={example}
              actions={isAdmin && <button onClick={() => setForm({ appliesTo })}>Add field</button>}
            />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr><th>Field</th><th>Type</th><th>Required</th><th>Remembered</th><th className="num">Order</th><th>State</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.label} <span className="muted mono" style={{ fontSize: 11 }}>{f.key}</span>
                        {f.help_text && <div className="muted">{f.help_text}</div>}
                      </td>
                      <td>
                        {FIELD_TYPE_LABEL[f.field_type]}
                        {f.field_type === 'SELECT' && <div className="muted">{f.options.join(', ')}</div>}
                      </td>
                      <td>{f.required ? 'Required' : 'Optional'}</td>
                      <td>{f.sticky ? 'During session' : '—'}</td>
                      <td className="num">{f.sort_order}</td>
                      <td><ActivePill active={f.active} /></td>
                      <td>{isAdmin && <button className="link" onClick={() => setForm({ field: f, appliesTo })}>Edit</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fields.data && rows.length === 0 && (
                <EmptyState title="No fields yet">{isAdmin ? `Add one to collect extra data, ${example}.` : 'None defined for this project.'}</EmptyState>
              )}
            </div>
          </section>
        );
      })}
      {form && <CustomFieldForm projectId={projectId} field={form.field} appliesTo={form.appliesTo} nextOrder={(fields.data ?? []).filter((f) => f.applies_to === form.appliesTo).reduce((m, f) => Math.max(m, f.sort_order), 0) + 10} onClose={() => setForm(null)} />}
    </div>
  );
}

function CustomFieldForm({ projectId, field, appliesTo, nextOrder, onClose }: { projectId: string; field?: CustomField; appliesTo: CustomField['applies_to']; nextOrder: number; onClose: () => void }) {
  const f = useForm({
    applies_to: field?.applies_to ?? appliesTo,
    label: field?.label ?? '',
    field_type: field?.field_type ?? ('TEXT' as CustomField['field_type']),
    options: (field?.options ?? []).join('\n'),
    required: field?.required ?? false,
    sticky: field?.sticky ?? false,
    help_text: field?.help_text ?? '',
    sort_order: String(field?.sort_order ?? nextOrder),
    active: field?.active ?? true,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const v = f.values;
      const options = v.options.split('\n').map((o) => o.trim()).filter(Boolean);
      const common = {
        label: v.label.trim(),
        options: v.field_type === 'SELECT' ? options : [],
        required: v.required,
        sticky: v.sticky,
        help_text: v.help_text.trim() || null,
        sort_order: Number(v.sort_order) || 0,
        active: v.active,
      };
      if (field) return api.patch(`/custom-fields/${field.id}`, common);
      return api.post(`/projects/${projectId}/custom-fields`, { ...common, applies_to: v.applies_to, field_type: v.field_type });
    },
    onSuccess: onClose,
  });
  const submit = () => {
    if (f.values.field_type === 'SELECT' && f.values.options.split('\n').filter((o) => o.trim()).length < 2) {
      setLocalError('A choice list needs at least two options, one per line.');
      return;
    }
    setLocalError(null);
    save.mutate();
  };
  const apiError = save.error as ApiError | null;
  const example = APPLIES_TO.find(([k]) => k === f.values.applies_to)![2];
  return (
    <Modal title={field ? `Edit “${field.label}”` : 'New custom field'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
        {localError ? (
          <div className="notice error">{localError}</div>
        ) : apiError?.code === 'FIELD_EXISTS' ? (
          <div className="notice error" role="alert">A field with this name already exists in this project. Choose a different label, or edit (or reactivate) the existing field.</div>
        ) : (
          <ErrorNotice error={save.error} />
        )}
        <Field label="Recorded">
          <select disabled={!!field} {...f.bind('applies_to')}>
            {APPLIES_TO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Label" hint={example}>
            <input required maxLength={80} placeholder="Nursery batch number" {...f.bind('label')} />
          </Field>
          <Field label="Type" hint={field ? 'fixed once created' : undefined}>
            <select disabled={!!field} {...f.bind('field_type')}>
              {(Object.keys(FIELD_TYPE_LABEL) as CustomField['field_type'][]).map((k) => <option key={k} value={k}>{FIELD_TYPE_LABEL[k]}</option>)}
            </select>
          </Field>
        </div>
        {field && <p className="muted" style={{ margin: '-6px 0 0' }}>Stored as <span className="mono">{field.key}</span>; the key and type cannot change, so existing values stay valid.</p>}
        {f.values.field_type === 'SELECT' && (
          <Field label="Options" hint="one per line">
            <textarea required placeholder={'Nursery A\nNursery B\nWildling'} {...f.bind('options')} />
          </Field>
        )}
        <Field label="Help text" hint="shown under the field on the phone">
          <input maxLength={200} {...f.bind('help_text')} />
        </Field>
        <div className="form-grid">
          <Field label="Order" hint="lower comes first"><input type="number" step={1} {...f.bind('sort_order')} /></Field>
        </div>
        <label className="check"><input type="checkbox" {...f.bindCheck('required')} /> Required</label>
        <div>
          <label className="check"><input type="checkbox" {...f.bindCheck('sticky')} /> Remember during a field session</label>
          <p className="muted" style={{ margin: '2px 0 0 22px' }}>The phone pre-fills the last value entered, for values that repeat across many trees, e.g. a nursery batch number.</p>
        </div>
        <div>
          <label className="check"><input type="checkbox" {...f.bindCheck('active')} /> Active</label>
          <p className="muted" style={{ margin: '2px 0 0 22px' }}>Inactive fields are no longer asked on devices; values already recorded are kept.</p>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>{field ? 'Save' : 'Add field'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ shared helpers
/** Real codes for live example IDs: the year's first sector and sub-sector (placeholders when none exist yet). */
function useExampleCodes(projectId: string, year?: PlantingYear) {
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const all = areas.data ?? [];
  const sector = all.find((s) => year && s.planting_year_id === year.id && s.active) ?? all.find((s) => s.planting_year_id == null && s.active) ?? all[0];
  const sub = sector?.sub_sectors?.find((ss: any) => ss.active) ?? sector?.sub_sectors?.[0];
  return { sector: (sector?.short_code as string | undefined) ?? 'S01', subSector: (sub?.short_code as string | undefined) ?? 'A1' };
}

function exampleId(scheme: { component_definition: SchemeComponent[]; separator: string; serial_width: number }, values: Record<string, string | null | undefined>) {
  const id = previewId(scheme.component_definition, scheme.separator, scheme.serial_width, values);
  return (
    <span className="id-preview small">
      {id.prefix}
      <span className="serial">{id.serial}</span>
    </span>
  );
}

// ------------------------------------------------------------------ areas
const AREA_ERRORS: Record<string, string> = {
  GEOMETRY_OUTSIDE_PARENT: 'This sub-sector is not inside its sector (15 m is allowed for GPS error). Check the corner points, or widen the sector first.',
  SHORT_CODE_TAKEN: 'Another area in this planting year already uses this short code. Choose a different one.',
  LOCATION_REQUIRED: 'Enter the corner points of the area (or, under “Advanced”, a reference point).',
  GEOMETRY_INVALID: 'The corner points do not form an area. Check that they are not all on one line and that no point was mistyped.',
};

function AreasTab({ project, year, onAddYear }: { project: any; year?: PlantingYear; onAddYear: () => void }) {
  const isAdmin = useIsAdmin();
  const projectId = project.id;
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const [form, setForm] = useState<{ kind: 'sector' | 'sub_sector'; area?: any; sector?: any } | null>(null);
  const [importing, setImporting] = useState(false);
  const [highlight, setHighlight] = useState<string>();
  const all = areas.data ?? [];
  const yearSectors = year ? all.filter((s) => s.planting_year_id === year.id) : [];
  const legacy = all.filter((s) => s.planting_year_id == null);
  const mapAreas: MapArea[] = useMemo(
    () => [...yearSectors, ...legacy].flatMap((s) => [{ ...s, kind: 'sector' as const }, ...s.sub_sectors.map((ss: any) => ({ ...ss, kind: 'sub_sector' as const }))]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas.data, year?.id],
  );
  const exportGeoJson = async () => {
    const data = await api.get(`/projects/${projectId}/areas.geojson`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/geo+json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'areas.geojson' }).click();
    URL.revokeObjectURL(url);
  };
  const sectorCard = (s: any) => {
    const corners = boundaryCorners(s.boundary).length;
    return (
      <section className="card" key={s.id}>
        <div className="page-header" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>
            Sector <span className="mono">{s.short_code}</span> · {s.name}
          </h2>
          <ActivePill active={s.active} />
          <span className="muted">{corners ? `${corners} corners${s.boundary ? ` · about ${areaHectares(orderCorners(boundaryCorners(s.boundary))).toFixed(1)} ha` : ''}` : `no outline · ref. ${s.reference_latitude}, ${s.reference_longitude}`}</span>
          <span className="spacer" />
          {isAdmin && <button onClick={() => setForm({ kind: 'sector', area: s })}>Edit</button>}
          {isAdmin && <button onClick={() => setForm({ kind: 'sub_sector', sector: s })}>+ Add sub-sector</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Sub-sector</th><th>Outline</th><th>Reference point</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {s.sub_sectors.map((ss: any) => {
                const n = boundaryCorners(ss.boundary).length;
                return (
                  <tr key={ss.id} onMouseEnter={() => setHighlight(ss.id)} onMouseLeave={() => setHighlight(undefined)}>
                    <td><span className="mono">{ss.short_code}</span> · {ss.name}</td>
                    <td>{n ? `${n} corners · ${areaHectares(orderCorners(boundaryCorners(ss.boundary))).toFixed(2)} ha` : <span className="muted">—</span>}</td>
                    <td className="mono">{ss.reference_latitude}, {ss.reference_longitude}</td>
                    <td><ActivePill active={ss.active} /></td>
                    <td>{isAdmin && <button className="link" onClick={() => setForm({ kind: 'sub_sector', area: ss, sector: s })}>Edit</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {s.sub_sectors.length === 0 && (
            <EmptyState title="No sub-sectors yet" action={isAdmin && <button onClick={() => setForm({ kind: 'sub_sector', sector: s })}>+ Add sub-sector</button>}>
              Trees are located by sub-sector, so each sector needs at least one.
            </EmptyState>
          )}
        </div>
      </section>
    );
  };
  return (
    <div className="stack">
      <div className="notice">
        Each planting year starts with a land survey: the year’s planting area is split into <strong>sectors</strong>, and sectors into <strong>sub-sectors</strong>, each recorded by its corner
        points. Trees have no GPS position of their own; a tree is located by its sector and sub-sector.
      </div>
      <ErrorNotice error={areas.error} />
      {!year ? (
        <EmptyState title="Add a planting year first" action={isAdmin && <button className="primary" onClick={onAddYear}>+ Add planting year</button>}>
          Areas are surveyed for a planting year.
        </EmptyState>
      ) : (
        <>
          <CardHeader
            title={`Survey for ${year.year_label}`}
            description={`${yearSectors.length} sector${yearSectors.length === 1 ? '' : 's'}, ${yearSectors.reduce((n, s) => n + s.sub_sectors.length, 0)} sub-sectors.`}
            actions={
              <>
                {isAdmin && <button className="primary" onClick={() => setForm({ kind: 'sector' })}>+ Add sector</button>}
                {isAdmin && <button onClick={() => setImporting(true)}>Import GeoJSON</button>}
                <button onClick={exportGeoJson}>Export GeoJSON</button>
              </>
            }
          />
          {mapAreas.length > 0 && <AreaMap areas={mapAreas} highlightId={highlight} />}
          {yearSectors.map(sectorCard)}
          {areas.data && yearSectors.length === 0 && (
            <div className="card">
              <EmptyState
                title={`No areas surveyed for ${year.year_label} yet`}
                action={isAdmin && (
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="primary" onClick={() => setForm({ kind: 'sector' })}>+ Add sector</button>
                    <button onClick={() => setImporting(true)}>Import GeoJSON</button>
                  </div>
                )}
              >
                Walk to each corner of a sector with a GPS phone and enter the points here, or import the surveyor’s GeoJSON file.
              </EmptyState>
            </div>
          )}
        </>
      )}
      {legacy.length > 0 && (
        <>
          <CardHeader
            title="Not tied to a year (older setup)"
            description="Areas created before surveys were recorded per planting year. The phone still offers them in every year."
          />
          {legacy.map(sectorCard)}
        </>
      )}
      {form && <AreaForm projectId={projectId} year={year} {...form} onClose={() => setForm(null)} />}
      {importing && year && <ImportForm projectId={projectId} year={year} onClose={() => setImporting(false)} />}
    </div>
  );
}

type Corner = { lat: string; lon: string };
const blankCorners = (): Corner[] => Array.from({ length: 4 }, () => ({ lat: '', lon: '' }));
const MAX_CORNERS = 12;
const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/;
const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

function AreaForm({ projectId, year, kind, area, sector, onClose }: { projectId: string; year?: PlantingYear; kind: 'sector' | 'sub_sector'; area?: any; sector?: any; onClose: () => void }) {
  const existing = boundaryCorners(area?.boundary);
  // Imported outlines can have more points than the form edits; those keep their outline unless corners are entered.
  const editable = existing.length > 0 && existing.length <= MAX_CORNERS;
  const f = useForm({
    name: area?.name ?? '',
    short_code: area?.short_code ?? '',
    description: area?.description ?? '',
    reference_latitude: '',
    reference_longitude: '',
    boundary: '',
    active: area?.active ?? true,
  });
  const [corners, setCorners] = useState<Corner[]>(() => (editable ? existing.map(([lon, lat]) => ({ lat: String(lat), lon: String(lon) })) : blankCorners()));
  const [touched, setTouched] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const setCorner = (i: number, key: keyof Corner, value: string) => {
    setTouched(true);
    const pair = value.match(PAIR);
    // Pasting "7.4012, 3.9001" into either box fills both.
    setCorners((cs) => cs.map((c, j) => (j !== i ? c : pair ? { lat: pair[1], lon: pair[2] } : { ...c, [key]: value })));
  };
  const filled = corners.filter((c) => c.lat.trim() || c.lon.trim());
  const valid = filled.filter((c) => Math.abs(num(c.lat)) <= 90 && Math.abs(num(c.lon)) <= 180);
  const points: LonLat[] = valid.map((c) => [num(c.lon), num(c.lat)]);
  const labelled = corners
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => Math.abs(num(c.lat)) <= 90 && Math.abs(num(c.lon)) <= 180)
    .map(({ c, i }) => ({ p: [num(c.lon), num(c.lat)] as LonLat, label: String(i + 1) }));
  const ordered = orderCorners(labelled.map((l) => l.p));
  const orderedLabels = ordered.map((p) => labelled.find((l) => l.p === p)!.label);
  const shape: LonLat[] = points.length ? ordered : !touched ? orderCorners(existing) : [];
  const parent = kind === 'sub_sector' && sector?.boundary ? boundaryCorners(sector.boundary) : undefined;
  const others = (kind === 'sub_sector' ? sector?.sub_sectors ?? [] : area?.sub_sectors ?? [])
    .filter((ss: any) => ss.id !== area?.id && ss.boundary)
    .map((ss: any) => boundaryCorners(ss.boundary));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (area) return api.patch(`/${kind === 'sector' ? 'sectors' : 'sub-sectors'}/${area.id}`, body);
      return kind === 'sector' ? api.post(`/projects/${projectId}/sectors`, body) : api.post(`/sectors/${sector.id}/sub-sectors`, body);
    },
    onSuccess: onClose,
  });
  const submit = () => {
    const fail = (m: string) => setLocalError(m);
    if (filled.some((c) => !c.lat.trim() || !c.lon.trim())) return fail('Each corner needs both a latitude and a longitude.');
    if (valid.length !== filled.length) return fail('Latitude must be between -90 and 90, and longitude between -180 and 180 (decimal degrees, e.g. 7.401234).');
    if (filled.length > 0 && filled.length < 3) return fail('Enter at least 3 corners to outline the area.');
    const v = f.values;
    let boundary: unknown;
    if (v.boundary.trim()) {
      try {
        const parsed = JSON.parse(v.boundary);
        boundary = parsed.type === 'Feature' ? parsed.geometry : parsed;
      } catch {
        return fail('The pasted outline is not valid JSON. Paste a GeoJSON Polygon, or use the corner boxes.');
      }
    }
    const refGiven = [v.reference_latitude, v.reference_longitude].filter((x) => x.trim()).length;
    if (refGiven === 1) return fail('Give both the reference latitude and longitude, or leave both blank.');
    const body: Record<string, unknown> = {
      ...clean({ name: v.name.trim(), short_code: v.short_code.trim(), description: v.description.trim() }),
      active: v.active,
    };
    if (filled.length >= 3 && (!area || touched || !editable)) body.corners = valid.map((c) => ({ latitude: num(c.lat), longitude: num(c.lon) }));
    else if (boundary) body.boundary = boundary;
    else if (area && touched && filled.length === 0 && existing.length) body.boundary = null;
    if (refGiven === 2) {
      body.reference_latitude = num(v.reference_latitude);
      body.reference_longitude = num(v.reference_longitude);
    }
    if (!area && !body.corners && !body.boundary && refGiven !== 2) return fail('Enter at least 3 corners (or, under “Advanced”, a reference point).');
    if (area && body.boundary === null && refGiven !== 2 && !area.reference_latitude) return fail('Without corners, give a reference point under “Advanced”.');
    if (kind === 'sector' && !area) body.planting_year_id = year?.id;
    setLocalError(null);
    save.mutate(body);
  };
  const apiError = save.error as ApiError | null;
  const label = kind === 'sector' ? 'sector' : 'sub-sector';
  const where = kind === 'sub_sector' ? ` in sector ${sector?.short_code}` : area ? '' : year ? ` for ${year.year_label}` : '';
  return (
    <Modal title={`${area ? 'Edit' : 'New'} ${label}${where}`} onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
        {localError ? (
          <div className="notice error" role="alert">{localError}</div>
        ) : apiError && AREA_ERRORS[apiError.code] ? (
          <div className="notice error" role="alert">{AREA_ERRORS[apiError.code]}</div>
        ) : (
          <ErrorNotice error={save.error} />
        )}
        <div className="form-grid">
          <Field label="Name"><input required maxLength={200} placeholder={kind === 'sector' ? 'North block' : 'Plot A'} {...f.bind('name')} /></Field>
          <Field label="Short code" hint={kind === 'sector' ? 'e.g. S01; may appear in tree IDs' : 'e.g. A1; may appear in tree IDs'}>
            <input required maxLength={16} pattern="[A-Za-z0-9]{1,16}" title="1–16 letters or digits" {...f.bind('short_code')} />
          </Field>
        </div>
        <Field label="Description" hint="optional"><input {...f.bind('description')} /></Field>
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Corner points</h3>
            <p className="muted" style={{ margin: 0 }}>
              Walk to each corner of the surveyed area and record its GPS position. The order doesn’t matter. Decimal degrees, e.g. 7.401234 and 3.917345; pasting
              “latitude, longitude” into one box fills both.
            </p>
            {existing.length > MAX_CORNERS && !touched && (
              <div className="notice">This outline has {existing.length} points (imported). Leave the corners blank to keep it, or enter new corners to replace it.</div>
            )}
            {corners.map((c, i) => (
              <div className="corner-row" key={i}>
                <span className="muted">Corner {i + 1}</span>
                <input aria-label={`Corner ${i + 1} latitude`} inputMode="decimal" placeholder="Latitude" value={c.lat} onChange={(e) => setCorner(i, 'lat', e.target.value)} />
                <input aria-label={`Corner ${i + 1} longitude`} inputMode="decimal" placeholder="Longitude" value={c.lon} onChange={(e) => setCorner(i, 'lon', e.target.value)} />
                <button type="button" className="link" disabled={corners.length <= 3} onClick={() => (setTouched(true), setCorners(corners.filter((_, j) => j !== i)))} aria-label={`Remove corner ${i + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            <div className="row">
              <button type="button" disabled={corners.length >= MAX_CORNERS} onClick={() => setCorners([...corners, { lat: '', lon: '' }])}>+ Add corner</button>
              <span className="muted">{corners.length} of up to {MAX_CORNERS}</span>
            </div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0 }}>Outline preview</h3>
            {shape.length >= 3 || parent ? (
              <>
                <AreaSketch
                  shape={shape}
                  labels={points.length ? orderedLabels : undefined}
                  parent={parent}
                  others={others}
                  label={`Outline of the ${label}${parent ? ' inside its sector' : ''}`}
                />
                <div className="legend">
                  <span><i style={{ background: 'var(--series-3)' }} />This {label}{shape.length >= 3 ? `, about ${areaHectares(shape).toFixed(2)} ha` : ''}</span>
                  {parent && <span><i style={{ background: 'var(--series-1)' }} />Sector {sector.short_code} (dashed)</span>}
                  {others.length > 0 && <span><i style={{ background: 'var(--border-strong)' }} />Other sub-sectors</span>}
                </div>
                {shape.length < 3 && <p className="muted" style={{ margin: 0 }}>Enter at least 3 corners to see this {label}’s outline.</p>}
              </>
            ) : (
              <div className="chart-empty">Enter at least 3 corners to see the outline.</div>
            )}
            {kind === 'sub_sector' && (
              <p className="muted" style={{ margin: 0 }}>
                A sub-sector must lie inside its sector; 15 m is allowed for GPS error.{!parent && ' This sector has no outline, so any position is accepted.'}
              </p>
            )}
          </div>
        </div>
        <details>
          <summary className="muted">Advanced: reference point or pasted outline</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <p className="muted" style={{ margin: 0 }}>
              With corners, the reference point is placed inside the area automatically. Set one only to override it, or for an area with no corners.
              {area && ` Current: ${area.reference_latitude}, ${area.reference_longitude}.`}
            </p>
            <div className="form-grid">
              <Field label="Reference latitude" hint="optional"><input inputMode="decimal" {...f.bind('reference_latitude')} /></Field>
              <Field label="Reference longitude" hint="optional"><input inputMode="decimal" {...f.bind('reference_longitude')} /></Field>
            </div>
            <Field label="Outline as GeoJSON Polygon" hint={area ? 'optional; blank keeps the current outline; corners win' : 'optional; corners win'}>
              <textarea className="mono" placeholder='{"type":"Polygon","coordinates":[[[3.90,7.40],[3.91,7.40],[3.91,7.41],[3.90,7.41],[3.90,7.40]]]}' {...f.bind('boundary')} />
            </Field>
          </div>
        </details>
        <label className="check"><input type="checkbox" {...f.bindCheck('active')} /> Active (selectable for new registrations)</label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ImportForm({ projectId, year, onClose }: { projectId: string; year: PlantingYear; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: (body: unknown) => api.post(`/projects/${projectId}/areas/import`, body), onSuccess: onClose });
  const submit = () => {
    try {
      setError(null);
      save.mutate({ ...JSON.parse(text), planting_year_id: year.id });
    } catch {
      setError('The file is not valid JSON.');
    }
  };
  return (
    <Modal title={`Import sectors and sub-sectors for ${year.year_label}`} onClose={onClose} wide>
      <div className="stack">
        <p className="subtle" style={{ margin: 0 }}>
          A GeoJSON FeatureCollection of Polygon features, imported into planting year <strong>{year.year_label}</strong>. Each feature needs <code>properties.kind</code> (
          <code>sector</code> or <code>sub_sector</code>), <code>short_code</code> and <code>name</code>; sub-sectors also need <code>sector_code</code>. The reference point
          defaults to a point inside the polygon. The import is all-or-nothing.
        </p>
        <input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={async (e) => setText((await e.target.files?.[0]?.text()) ?? '')} />
        <textarea className="mono" style={{ minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste GeoJSON here" />
        {error ? <div className="notice error">{error}</div> : <ErrorNotice error={save.error} />}
        {save.data && <div className="notice">Imported {save.data.created} areas.</div>}
        <div className="form-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!text || save.isPending}>Import</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ vendors per planting year
function VendorsTab({ project, year, onAddYear, onTab }: { project: any; year?: PlantingYear; onAddYear: () => void; onTab: (t: Tab) => void }) {
  const isAdmin = useIsAdmin();
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api.get<any[]>('/vendors') });
  const codes = useExampleCodes(project.id, year);
  const [vendorId, setVendorId] = useState('');
  const [creating, setCreating] = useState(false);
  const link = useMutation({ mutationFn: (vid: string) => api.post(`/planting-years/${year!.id}/vendors`, { vendor_id: vid }), onSuccess: () => setVendorId('') });
  const unlink = useMutation({ mutationFn: (id: string) => api.post(`/planting-year-vendors/${id}/unlink`) });
  if (!year) {
    return (
      <EmptyState title="Add a planting year first" action={isAdmin && <button className="primary" onClick={onAddYear}>+ Add planting year</button>}>
        Vendors are linked to a planting year.
      </EmptyState>
    );
  }
  const links = yearLinks(project, year.id);
  const active = links.filter((l) => l.active);
  const previous = links.filter((l) => !l.active);
  const available = (vendors.data ?? []).filter((v) => v.active !== false && !active.some((l) => l.vendor_id === v.id));
  const schemes: Scheme[] = project.tree_id_schemes;
  return (
    <div className="stack">
      <div className="notice">
        Vendors plant across this year’s whole area. The phone offers only these vendors for {year.year_label}. Each vendor can have its own tree ID format; otherwise the year’s or
        the project’s format applies.
      </div>
      <ErrorNotice error={vendors.error ?? link.error ?? unlink.error} />
      <section className="card flush">
        <CardHeader title={`Vendors planting in ${year.year_label}`} description="The ID format each vendor’s officers use, with an example for the year’s first sector and sub-sector." />
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Vendor</th><th>Code</th><th>ID format used</th><th>Example ID</th><th /></tr></thead>
            <tbody>
              {active.map((l) => {
                const scheme = effectiveScheme(schemes, l.vendor_id, year.id);
                const needsCode = scheme?.component_definition.some((c) => c.type === 'VENDOR_CODE') && !l.vendor_short_code;
                return (
                  <tr key={l.id}>
                    <td>{l.vendor_name}</td>
                    <td className="mono">{l.vendor_short_code ?? <span className="muted">—</span>}</td>
                    <td>
                      {scheme ? (
                        <>
                          {LEVEL_LABEL[levelOf(scheme)]} <span className="muted">· version {scheme.version}</span>
                        </>
                      ) : (
                        <span className="pill warning">No format yet</span>
                      )}
                      {needsCode && (
                        <div className="muted" style={{ color: 'var(--warning-ink)' }}>
                          The format uses the vendor code but this vendor has none. Add one under <Link to="/reference">Species, statuses &amp; vendors</Link>.
                        </div>
                      )}
                    </td>
                    <td>
                      {scheme
                        ? exampleId(scheme, { PROJECT_CODE: project.short_code, PLANTING_YEAR: year.year_label, VENDOR_CODE: l.vendor_short_code, SECTOR_CODE: codes.sector, SUB_SECTOR_CODE: codes.subSector })
                        : <button className="link" onClick={() => onTab('schemes')}>Define a format</button>}
                    </td>
                    <td>
                      {isAdmin && (
                        <button
                          className="link danger"
                          onClick={() =>
                            confirm(`Unlink ${l.vendor_name} from ${year.year_label}? The phone stops offering this vendor for new trees in this year. Trees already registered keep their vendor.`) &&
                            unlink.mutate(l.id)
                          }
                        >
                          Unlink
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {active.length === 0 && (
            <EmptyState title={`No vendors linked to ${year.year_label} yet`}>
              {isAdmin ? 'Link the vendors planting this year below, or create a new vendor.' : 'An administrator links the vendors planting this year.'}
            </EmptyState>
          )}
        </div>
      </section>
      {isAdmin && (
        <form className="card" onSubmit={(e) => (e.preventDefault(), vendorId && link.mutate(vendorId))}>
          <h3>Link a vendor to {year.year_label}</h3>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Vendor">
              <select required value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Choose…</option>
                {available.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.short_code ? ` (${v.short_code})` : ''}</option>
                ))}
              </select>
            </Field>
            <button className="primary" disabled={!vendorId || link.isPending}>Link vendor</button>
            <span className="muted">or</span>
            <button type="button" onClick={() => setCreating(true)}>+ New vendor</button>
          </div>
          {vendors.data && available.length === 0 && <p className="muted" style={{ marginBottom: 0 }}>Every vendor is already linked. Create a new vendor to add another.</p>}
          {previous.length > 0 && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Previously linked:{' '}
              {previous.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ', '}
                  {l.vendor_name} <button type="button" className="link" onClick={() => link.mutate(l.vendor_id)}>link again</button>
                </span>
              ))}
            </p>
          )}
        </form>
      )}
      {creating && <NewVendorForm onClose={() => setCreating(false)} onCreated={(v) => link.mutate(v.id)} />}
    </div>
  );
}

function NewVendorForm({ onClose, onCreated }: { onClose: () => void; onCreated: (vendor: any) => void }) {
  const f = useForm({ name: '', short_code: '' });
  const save = useMutation({
    mutationFn: () => api.post('/vendors', { name: f.values.name.trim(), short_code: f.values.short_code.trim().toUpperCase() }),
    onSuccess: (v) => {
      onCreated(v);
      onClose();
    },
  });
  return (
    <Modal title="New vendor" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <ErrorNotice error={save.error} />
        <p className="muted" style={{ margin: 0 }}>The vendor is created and linked to this planting year. Contact details can be added later under Species, statuses &amp; vendors.</p>
        <div className="form-grid">
          <Field label="Name"><input required maxLength={200} placeholder="Kano Nurseries Ltd" {...f.bind('name')} /></Field>
          <Field label="Short code" hint="e.g. KNM; used in tree IDs">
            <input required maxLength={16} pattern="[A-Za-z0-9]{1,16}" title="1–16 letters or digits" {...f.bind('short_code')} />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={save.isPending}>Create and link</button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ ID formats
type ScopeChoice = { vendorId: string | null; yearId: string | null };
const scopeKey = (s: ScopeChoice) => `${s.vendorId ?? ''}|${s.yearId ?? ''}`;
const parseScope = (k: string): ScopeChoice => {
  const [v, y] = k.split('|');
  return { vendorId: v || null, yearId: y || null };
};

function SchemesTab({ project, year }: { project: any; year?: PlantingYear }) {
  const isAdmin = useIsAdmin();
  const codes = useExampleCodes(project.id, year);
  const [builder, setBuilder] = useState<ScopeChoice | null>(null);
  const retire = useMutation({ mutationFn: (id: string) => api.post(`/tree-id-schemes/${id}/retire`) });
  const schemes: Scheme[] = project.tree_id_schemes;
  const active = schemes.filter((s) => s.active);
  const links = yearLinks(project, year?.id).filter((l) => l.active);
  const firstVendorCode = links.find((l) => l.vendor_short_code)?.vendor_short_code;
  const values = (vendorCode?: string | null, yearLabel?: string | null) => ({
    PROJECT_CODE: project.short_code,
    PLANTING_YEAR: yearLabel ?? year?.year_label,
    VENDOR_CODE: vendorCode ?? firstVendorCode,
    SECTOR_CODE: codes.sector,
    SUB_SECTOR_CODE: codes.subSector,
  });
  const def = active.find((s) => !s.vendor_id && !s.planting_year_id);
  const yearFormat = year && active.find((s) => !s.vendor_id && s.planting_year_id === year.id);
  const vendorFormats = active.filter((s) => s.vendor_id && (s.planting_year_id == null || s.planting_year_id === year?.id));
  const history = schemes.filter((s) => !s.active);

  const level = (title: string, description: string, scheme: Scheme | undefined, scope: ScopeChoice, emptyText: string, vendorCode?: string | null) => (
    <div className="scheme-level" key={scopeKey(scope)}>
      <div>
        <strong>{title}</strong>
        <div className="muted">{description}</div>
      </div>
      {scheme ? (
        <div className="stack" style={{ gap: 6 }}>
          <div>{exampleId(scheme, values(vendorCode ?? scheme.vendor_short_code, scheme.year_label))}</div>
          <div className="muted">
            {scheme.component_definition.map((c) => (c.type === 'TEXT' ? `“${c.value}”` : componentLabel(c.type))).join(' → ')} · {scheme.serial_width}-digit tree number, unique per{' '}
            {scopeLabel(scheme.serial_uniqueness_scope)} · version {scheme.version} since {fmtDate(scheme.active_from)}
          </div>
        </div>
      ) : (
        <div className="muted">{emptyText}</div>
      )}
      {isAdmin && (
        <div className="row">
          <button onClick={() => setBuilder(scope)}>{scheme ? 'Change' : 'Create'}</button>
          {scheme && levelOf(scheme) !== 'default' && (
            <button
              className="link danger"
              onClick={() => confirm('Retire this format? The broader format applies again to new registrations. Trees already registered keep their IDs.') && retire.mutate(scheme.id)}
            >
              Retire
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="stack">
      <div className="notice">
        A tree ID joins <strong>fixed parts</strong>, filled in by the phone (project code, planting year, vendor code, fixed text), and <strong>changing parts</strong> that depend on
        the tree (sector, sub-sector and the tree number the officer types). The phone uses the most specific format: vendor in this year → vendor → this planting year → project
        default. Changes apply to new registrations only.
      </div>
      {!def && <div className="notice warning">No project default format yet. Field officers cannot register trees unless a format applies to their year and vendor.</div>}
      <ErrorNotice error={retire.error} />
      <section className="card">
        <CardHeader
          title={year ? `Formats that apply in ${year.year_label}` : 'Formats'}
          description="Example IDs use this project’s codes, the year’s first sector and sub-sector, and tree number 15."
          actions={isAdmin && <button className="primary" onClick={() => setBuilder({ vendorId: null, yearId: year?.id ?? null })}>+ New format</button>}
        />
        {level('Project default', 'All years and vendors, unless a more specific format exists.', def, { vendorId: null, yearId: null }, 'None yet. Create one so every vendor and year has a format.')}
        {year &&
          level(`Planting year ${year.year_label}`, 'All vendors in this year.', yearFormat, { vendorId: null, yearId: year.id }, 'None — the project default applies.')}
        {vendorFormats.map((s) =>
          level(
            s.planting_year_id ? `Vendor ${s.vendor_name} in ${s.year_label}` : `Vendor ${s.vendor_name}`,
            s.planting_year_id ? 'This vendor, this year only.' : 'This vendor, every year.',
            s,
            { vendorId: s.vendor_id, yearId: s.planting_year_id },
            '',
          ),
        )}
        {year && vendorFormats.length === 0 && (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            No vendor-specific formats. {links.length ? 'Create one if a vendor tags its trees its own way.' : 'Link vendors in the Vendors tab first.'}
          </p>
        )}
      </section>
      {history.length > 0 && (
        <details className="card">
          <summary><strong>Earlier versions ({history.length})</strong> <span className="muted">— trees registered with them keep their IDs</span></summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Version</th><th>Applied to</th><th>Example</th><th>Since</th></tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td>{s.version}</td>
                    <td>{LEVEL_LABEL[levelOf(s)]}{s.vendor_name ? ` · ${s.vendor_name}` : ''}{s.year_label ? ` · ${s.year_label}` : ''}</td>
                    <td>{exampleId(s, values(s.vendor_short_code, s.year_label))}</td>
                    <td>{fmtDateTime(s.active_from)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {builder && <SchemeBuilder project={project} year={year} initial={builder} codes={codes} onClose={() => setBuilder(null)} />}
    </div>
  );
}

type Part = SchemeComponent & { key: number };
const DEFAULT_PARTS: SchemeComponent[] = [
  { type: 'PROJECT_CODE', required: true },
  { type: 'PLANTING_YEAR', required: true },
  { type: 'VENDOR_CODE', required: true },
  { type: 'SECTOR_CODE', required: true },
];

function SchemeBuilder({ project, year, initial, codes, onClose }: { project: any; year?: PlantingYear; initial: ScopeChoice; codes: { sector: string; subSector: string }; onClose: () => void }) {
  const schemes: Scheme[] = project.tree_id_schemes;
  const links = yearLinks(project, year?.id).filter((l) => l.active);
  // Vendors offered as scopes: this year's vendors, plus any vendor that already has its own format.
  const vendors = new Map<string, { name: string; code: string | null }>();
  links.forEach((l) => vendors.set(l.vendor_id, { name: l.vendor_name, code: l.vendor_short_code }));
  schemes.forEach((s) => s.vendor_id && !vendors.has(s.vendor_id) && vendors.set(s.vendor_id, { name: s.vendor_name ?? 'Vendor', code: s.vendor_short_code }));
  const yearLabelOf = (id: string | null) => (id ? project.planting_years.find((y: PlantingYear) => y.id === id)?.year_label : undefined);
  const scopeOptions: [string, string][] = [[scopeKey({ vendorId: null, yearId: null }), 'Project default (all years and vendors)']];
  if (year) scopeOptions.push([scopeKey({ vendorId: null, yearId: year.id }), `This planting year (${year.year_label}), all vendors`]);
  vendors.forEach((v, id) => {
    scopeOptions.push([scopeKey({ vendorId: id, yearId: null }), `Vendor: ${v.name} (every year)`]);
    if (year) scopeOptions.push([scopeKey({ vendorId: id, yearId: year.id }), `Vendor ${v.name} in ${year.year_label}`]);
  });
  // A scope coming from another year (e.g. a vendor format for an older year) is kept selectable.
  if (!scopeOptions.some(([k]) => k === scopeKey(initial))) {
    scopeOptions.push([scopeKey(initial), `${initial.vendorId ? `Vendor ${vendors.get(initial.vendorId)?.name}` : 'Year'} in ${yearLabelOf(initial.yearId)}`]);
  }

  const nextKey = useRef(0);
  const withKeys = (cs: SchemeComponent[]): Part[] => cs.filter((c) => c.type !== 'SERIAL').map((c) => ({ ...c, key: nextKey.current++ }));
  /** Starts from the format that applies to the scope today, so a change is an edit, not a blank slate. */
  const startFrom = (scope: ScopeChoice) => {
    const base = effectiveScheme(schemes, scope.vendorId, scope.yearId);
    const vendorInvolved = !!scope.vendorId || links.length > 0;
    return {
      parts: withKeys(base?.component_definition ?? DEFAULT_PARTS.filter((c) => c.type !== 'VENDOR_CODE' || vendorInvolved)),
      separator: base?.separator ?? '-',
      width: base?.serial_width ?? 5,
      serialScope: base?.serial_uniqueness_scope ?? (vendorInvolved ? RECOMMENDED_SCOPE : ['PROJECT', 'PLANTING_YEAR']),
      exact: schemes.find((s) => s.active && s.vendor_id === scope.vendorId && s.planting_year_id === scope.yearId),
    };
  };
  const [scope, setScopeState] = useState<ScopeChoice>(initial);
  const [form, setForm] = useState(() => startFrom(initial));
  const { parts, separator, width, serialScope } = form;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const changeScope = (k: string) => {
    const next = parseScope(k);
    setScopeState(next);
    setForm(startFrom(next));
  };
  const [localError, setLocalError] = useState<string | null>(null);

  const components: SchemeComponent[] = [
    ...parts.map(({ type, required, value }) => (type === 'TEXT' ? { type, required: true, value: (value ?? '').trim().toUpperCase() } : { type, required })),
    { type: 'SERIAL', required: true },
  ];
  const save = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/tree-id-schemes`, {
        vendor_id: scope.vendorId,
        planting_year_id: scope.yearId,
        components,
        separator,
        serial_width: width,
        serial_uniqueness_scope: serialScope,
      }),
    onSuccess: onClose,
  });
  const submit = () => {
    if (parts.some((p) => p.type === 'TEXT' && !TEXT_VALUE.test((p.value ?? '').trim()))) {
      setLocalError('Fixed text must be 1–16 letters or digits, with no spaces or symbols.');
      return;
    }
    setLocalError(null);
    save.mutate();
  };
  const unused = COMPONENTS.filter(([k]) => k !== 'SERIAL' && k !== 'TEXT' && !parts.some((c) => c.type === k));
  const move = (i: number, d: number) => {
    const next = [...parts];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set({ parts: next });
  };
  const update = (i: number, patch: Partial<Part>) => set({ parts: parts.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const scopeVendor = scope.vendorId ? vendors.get(scope.vendorId) : undefined;
  const sampleVendor = scopeVendor ?? (links[0] ? { name: links[0].vendor_name, code: links[0].vendor_short_code } : undefined);
  const sampleYear = yearLabelOf(scope.yearId) ?? year?.year_label ?? String(new Date().getFullYear());
  const sample = previewId(components, separator, width, {
    PROJECT_CODE: project.short_code,
    PLANTING_YEAR: sampleYear,
    VENDOR_CODE: sampleVendor?.code,
    SECTOR_CODE: codes.sector,
    SUB_SECTOR_CODE: codes.subSector,
  });
  const hasVendorCode = parts.some((p) => p.type === 'VENDOR_CODE');
  const vendorInvolved = !!scope.vendorId || hasVendorCode || links.length > 1;
  const isRecommended = RECOMMENDED_SCOPE.every((d) => serialScope.includes(d)) && serialScope.length === RECOMMENDED_SCOPE.length;
  const scopeName = scopeOptions.find(([k]) => k === scopeKey(scope))?.[1] ?? '';

  return (
    <Modal title={form.exact ? `Change the ID format (now version ${form.exact.version})` : 'New ID format'} onClose={onClose} wide>
      <div className="stack">
        {localError ? <div className="notice error" role="alert">{localError}</div> : <ErrorNotice error={save.error} />}
        <Field label="Applies to" hint="the phone uses the most specific format">
          <select value={scopeKey(scope)} onChange={(e) => changeScope(e.target.value)}>
            {scopeOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <p className="muted" style={{ margin: '-8px 0 0' }}>
          {form.exact
            ? 'This replaces the current format for this scope only. Other years’ and vendors’ formats stay as they are.'
            : 'There is no format for this scope yet; the parts below start from the one that applies today.'}{' '}
          Trees already registered keep their IDs.
        </p>
        <div>
          <h3>Parts of the ID, in order</h3>
          <ol className="parts">
            {parts.map((c, i) => (
              <li key={c.key}>
                <span className="name">{componentLabel(c.type)}</span>
                {isFixedPart(c.type) ? <span className="pill fixed">Fixed</span> : <span className="pill changing">Changing</span>}
                {c.type === 'TEXT' ? (
                  <input
                    aria-label="Fixed text"
                    placeholder="e.g. TR"
                    maxLength={16}
                    style={{ width: 120, textTransform: 'uppercase' }}
                    value={c.value ?? ''}
                    onChange={(e) => update(i, { value: e.target.value.replace(/[^A-Za-z0-9]/g, '') })}
                  />
                ) : (
                  <label className="check">
                    <input type="checkbox" checked={c.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required
                  </label>
                )}
                <span className="spacer" style={{ flex: 1 }} />
                <button type="button" className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${componentLabel(c.type)} up`}>Move up</button>
                <button type="button" className="link" disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${componentLabel(c.type)} down`}>Move down</button>
                <button type="button" className="link danger" onClick={() => set({ parts: parts.filter((_, j) => j !== i) })}>Remove</button>
              </li>
            ))}
            <li>
              <span className="name">Tree number</span>
              <span className="pill changing">Changing</span>
              <span className="muted">Always last; the officer types it.</span>
            </li>
          </ol>
          <div className="row" style={{ marginTop: 8 }}>
            {unused.map(([k, label]) => (
              <button type="button" key={k} onClick={() => set({ parts: [...parts, { type: k, required: true, key: nextKey.current++ }] })}>+ {label}</button>
            ))}
            <button type="button" onClick={() => set({ parts: [...parts, { type: 'TEXT', required: true, value: '', key: nextKey.current++ }] })}>+ Fixed text</button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            <strong>Fixed</strong> parts are the same for every tree of a vendor in a year (project, year, vendor, fixed text). <strong>Changing</strong> parts depend on the tree
            (sector, sub-sector, tree number).
          </p>
        </div>
        <div className="form-grid">
          <Field label="Separator">
            <select value={separator} onChange={(e) => set({ separator: e.target.value })}>
              {[['-', 'Hyphen  -'], ['_', 'Underscore  _'], ['/', 'Slash  /'], ['.', 'Dot  .'], ['', 'None']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Tree number digits" hint="zero-padded, e.g. 5 → 00015">
            <input type="number" min={1} max={12} value={width} onChange={(e) => set({ width: Number(e.target.value) })} />
          </Field>
        </div>
        <div>
          <h3>Tree numbers must be unique within</h3>
          <div className="row">
            {SCOPES.map(([k, label]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={serialScope.includes(k)} onChange={(e) => set({ serialScope: e.target.checked ? [...serialScope, k] : serialScope.filter((s) => s !== k) })} /> {label}
              </label>
            ))}
          </div>
          <p className="muted">{serialScope.length ? `Unique per ${scopeLabel(serialScope)}.` : 'No boxes ticked: tree numbers are unique globally.'} The full ID is always unique.</p>
          {vendorInvolved && !isRecommended && (
            <div className="notice">
              Recommended when vendors are involved: unique per <strong>project + planting year + vendor</strong>, so each vendor numbers its own trees (two vendors may both have tree
              15). <button type="button" className="link" onClick={() => set({ serialScope: RECOMMENDED_SCOPE })}>Use recommended</button>
            </div>
          )}
          {serialScope.includes('VENDOR') && !hasVendorCode && (
            <div className="notice warning" style={{ marginTop: 8 }}>
              Tree numbers are counted per vendor, but the ID has no vendor code: two vendors’ tree 15 would get the same ID. Add the vendor code to the parts.
            </div>
          )}
        </div>
        <div>
          <h3>Preview</h3>
          <div className="id-preview">{sample.prefix}<span className="serial">{sample.serial}</span></div>
          <p className="muted">
            Example for {sampleVendor ? `vendor ${sampleVendor.name}` : 'a vendor'}, year {sampleYear}, sector {codes.sector}, sub-sector {codes.subSector}, tree 15. Officers see the
            prefix filled in and type only the highlighted tree number.
          </p>
          {hasVendorCode && sampleVendor && !sampleVendor.code && (
            <div className="notice warning">{sampleVendor.name} has no short code. Add one under <Link to="/reference">Species, statuses &amp; vendors</Link> before officers register trees.</div>
          )}
        </div>
        <div className="form-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={save.isPending}>Publish for: {scopeName}</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ planting years
function YearsTab({ project, selected, onSelect, onAdd }: { project: any; selected?: PlantingYear; onSelect: (id: string) => void; onAdd: () => void }) {
  const isAdmin = useIsAdmin();
  const toggle = useMutation({ mutationFn: (y: PlantingYear) => api.patch(`/planting-years/${y.id}`, { active: !y.active }) });
  const years: PlantingYear[] = project.planting_years;
  return (
    <div className="stack">
      <p className="subtle" style={{ margin: 0 }}>
        Officers pick the planting year explicitly; it is never inferred from the registration date. Closed years stay visible and can be used by administrators for back-entry.
      </p>
      <ErrorNotice error={toggle.error} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Year / cohort</th><th>Start</th><th>End</th><th className="num">Vendors</th><th>State</th><th /></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <td className="mono">{y.year_label}{y.id === selected?.id && <span className="pill" style={{ marginLeft: 8 }}>Selected</span>}</td>
                <td>{fmtDate(y.start_date)}</td>
                <td>{fmtDate(y.end_date)}</td>
                <td className="num">{yearLinks(project, y.id).filter((l) => l.active).length}</td>
                <td><ActivePill active={y.active} /></td>
                <td className="row" style={{ flexWrap: 'nowrap' }}>
                  {y.id !== selected?.id && <button className="link" onClick={() => onSelect(y.id)}>Select</button>}
                  {isAdmin && <button className="link" onClick={() => toggle.mutate(y)}>{y.active ? 'Close for new registrations' : 'Reopen'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {years.length === 0 && (
          <EmptyState title="No planting years yet" action={isAdmin && <button className="primary" onClick={onAdd}>+ Add planting year</button>}>
            Add the year being planted, e.g. 2026. Its survey, vendors and ID format are set up per year.
          </EmptyState>
        )}
      </div>
      {isAdmin && years.length > 0 && <div><button onClick={onAdd}>+ Add planting year</button></div>}
    </div>
  );
}

// ------------------------------------------------------------------ assignments
function AssignmentsTab({ projectId, year }: { projectId: string; year?: PlantingYear }) {
  const assignments = useQuery({ queryKey: ['assignments', projectId], queryFn: () => api.get<any[]>(`/assignments${qs({ project_id: projectId })}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const areas = useQuery({ queryKey: ['areas', projectId], queryFn: () => api.get<any[]>(`/projects/${projectId}/areas`) });
  const f = useForm({ user_id: '', sector_id: '', sub_sector_id: '' });
  const create = useMutation({ mutationFn: () => api.post('/assignments', { project_id: projectId, ...clean(f.values) }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/assignments/${id}/revoke`) });
  // Sector choices follow the selected planting year (plus older areas not tied to a year).
  const sectors = (areas.data ?? []).filter((s) => !year || s.planting_year_id === year.id || s.planting_year_id == null);
  const subSectors = sectors.find((s) => s.id === f.values.sector_id)?.sub_sectors ?? [];
  return (
    <div className="stack">
      <p className="subtle" style={{ margin: 0 }}>
        Field officers see only the projects (or sectors) they are assigned to. Clients and sponsors (executives without “Teasoo management”) also see only the projects assigned here.
      </p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>User</th><th>Role</th><th>Scope</th><th /></tr></thead>
          <tbody>
            {assignments.data?.map((a) => (
              <tr key={a.id}>
                <td>{a.user_name}</td>
                <td>{a.user_role.replace('_', ' ').toLowerCase()}</td>
                <td>{a.sub_sector_name ? `${a.sector_name} / ${a.sub_sector_name}` : a.sector_name ?? 'Whole project'}</td>
                <td><button className="link danger" onClick={() => confirm(`Remove ${a.user_name}'s access to this scope?`) && revoke.mutate(a.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {assignments.data?.length === 0 && <div className="empty">Nobody is assigned yet. Unassigned users cannot see this project.</div>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Assign a user</h3>
        <ErrorNotice error={create.error ?? revoke.error} />
        <div className="form-grid">
          <Field label="User">
            <select required {...f.bind('user_id')}>
              <option value="">Choose…</option>
              {users.data?.filter((u) => u.active && u.role !== 'ADMIN' && !(u.role === 'EXECUTIVE' && u.all_projects)).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name} ({u.role === 'EXECUTIVE' ? 'client / sponsor' : u.role.replace('_', ' ').toLowerCase()})</option>
              ))}
            </select>
          </Field>
          <Field label="Sector" hint={year ? `optional; ${year.year_label} survey` : 'optional'}>
            <select value={f.values.sector_id} onChange={(e) => f.setValues({ ...f.values, sector_id: e.target.value, sub_sector_id: '' })}>
              <option value="">Whole project</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.short_code} · {s.name}{s.planting_year_id == null ? ' (older setup)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Sub-sector" hint="optional">
            <select {...f.bind('sub_sector_id')} disabled={!f.values.sector_id}>
              <option value="">Whole sector</option>
              {subSectors.map((ss: any) => <option key={ss.id} value={ss.id}>{ss.short_code} · {ss.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-actions"><button className="primary" disabled={create.isPending}>Assign</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ serial ranges
const KEYABLE = ['PROJECT', 'PLANTING_YEAR', 'VENDOR'];

function SerialsTab({ project, year }: { project: any; year?: PlantingYear }) {
  const allocations = useQuery({ queryKey: ['allocations', project.id], queryFn: () => api.get<any[]>(`/serial-allocations${qs({ project_id: project.id })}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const links = yearLinks(project, year?.id).filter((l) => l.active);
  const [vendorId, setVendorId] = useState('');
  const scheme = effectiveScheme(project.tree_id_schemes, vendorId || null, year?.id);
  const dims: string[] = scheme?.serial_uniqueness_scope ?? [];
  const needsVendor = dims.includes('VENDOR');
  const f = useForm({ user_id: '', range_start: '', range_end: '', notes: '', scope_key: '' });
  // Suggest the scope key when it depends only on project, year and vendor; sector-level keys can be pasted.
  const lookup: Record<string, string | undefined> = { PROJECT: project.id, PLANTING_YEAR: year?.id, VENDOR: vendorId || undefined };
  const suggested =
    scheme && dims.every((d) => KEYABLE.includes(d)) && dims.every((d) => lookup[d])
      ? dims.length === 0
        ? 'GLOBAL'
        : [...dims].sort().map((d) => `${d}=${lookup[d]}`).join('|')
      : '';
  const create = useMutation({
    mutationFn: () =>
      api.post('/serial-allocations', {
        project_id: project.id,
        scope_key: f.values.scope_key || suggested,
        user_id: f.values.user_id || null,
        range_start: Number(f.values.range_start),
        range_end: Number(f.values.range_end),
        notes: f.values.notes || null,
      }),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/serial-allocations/${id}/revoke`) });
  return (
    <div className="stack">
      <div className="notice">
        Disconnected devices cannot detect each other’s registrations. Pre-allocating serial ranges per officer is the only way to guarantee collision-free offline issuance.
        When a scope has ranges, serials outside them are rejected at sync.
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Scope key</th><th>Officer</th><th className="num">From</th><th className="num">To</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {allocations.data?.map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ fontSize: 11, maxWidth: 320, wordBreak: 'break-all' }}>{a.scope_key}</td>
                <td>{a.user_name ?? 'Any officer'}</td>
                <td className="num">{a.range_start}</td>
                <td className="num">{a.range_end}</td>
                <td>{a.notes}</td>
                <td><button className="link danger" onClick={() => revoke.mutate(a.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {allocations.data?.length === 0 && <div className="empty">No ranges allocated: any serial is accepted and duplicates are resolved as conflicts.</div>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Allocate a range{year ? ` in ${year.year_label}` : ''}</h3>
        <ErrorNotice error={create.error ?? revoke.error} />
        <div className="form-grid">
          {links.length > 0 && (
            <Field label="Vendor" hint={needsVendor ? 'numbers are counted per vendor' : 'optional'}>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Choose…</option>
                {links.map((l) => <option key={l.vendor_id} value={l.vendor_id}>{l.vendor_name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Officer" hint="optional">
            <select {...f.bind('user_id')}>
              <option value="">Any officer in scope</option>
              {users.data?.filter((u) => u.role === 'FIELD_OFFICER' && u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="First serial"><input required type="number" min={1} {...f.bind('range_start')} /></Field>
          <Field label="Last serial"><input required type="number" min={1} {...f.bind('range_end')} /></Field>
        </div>
        <Field label="Scope key" hint={suggested ? 'filled from the planting year and vendor' : needsVendor && !vendorId ? 'choose a vendor to fill it' : 'see the format’s uniqueness scope'}>
          <input className="mono" required value={f.values.scope_key || suggested} onChange={(e) => f.setValues({ ...f.values, scope_key: e.target.value })} />
        </Field>
        <Field label="Notes"><input {...f.bind('notes')} /></Field>
        <div className="form-actions"><button className="primary" disabled={create.isPending}>Allocate</button></div>
      </form>
    </div>
  );
}
