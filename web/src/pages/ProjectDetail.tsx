import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../api/client';
import { useIsAdmin } from '../auth';
import { AreaMap, MapArea } from '../components/AreaMap';
import { areaHectares, AreaSketch, boundaryCorners, LonLat, orderCorners } from '../components/AreaSketch';
import { ShareLinksModal } from '../components/ShareLinks';
import { ActivePill, CardHeader, clean, EditButton, EmptyState, ErrorNotice, Field, fmtDate, fmtDateTime, Modal, PageHeader, RowMenu, Tabs, useDelete, useForm } from '../components/ui';
import {
  appliedTo,
  COMPONENTS,
  componentLabel,
  currentScheme,
  isFixedPart,
  previewId,
  RECOMMENDED_SCOPE,
  Scheme,
  SchemeComponent,
  SCOPES,
  scopeLabel,
  TEXT_VALUE,
} from '../idscheme';
import { ProjectForm } from './Projects';
import { ReferenceForm } from './Reference';

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
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [addingYear, setAddingYear] = useState(false);
  const del = useDelete();
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
    ['schemes', 'ID format'],
    ['years', 'Years'],
    ['fields', 'Fields'],
  ];
  if (isAdmin) tabs.push(['assignments', 'People'], ['serials', 'Serial ranges']);
  const addYear = () => setAddingYear(true);
  return (
    <div className="stack" style={{ gap: 0 }}>
      <PageHeader
        crumbs={<><Link to="/projects">Projects</Link> /</>}
        title={p.name}
        actions={
          <>
            <Link className="btn" to={`/density?project_id=${p.id}${year ? `&planting_year_id=${year.id}` : ''}`}>Density map</Link>
            {isAdmin && (
              <>
                <button className="primary" onClick={() => setSharing(true)}>Share</button>
                <RowMenu
                  label="Project actions"
                  items={[
                    { label: 'Edit', onClick: () => setEditing(true) },
                    {
                      label: 'Delete',
                      danger: true,
                      onClick: () =>
                        del.ask({
                          what: 'project',
                          name: p.name,
                          path: `/projects/${p.id}`,
                          note: 'Only a project without trees can be deleted. All its setup is removed.',
                          onDeleted: () => navigate('/projects', { replace: true }),
                        }),
                    },
                  ]}
                />
              </>
            )}
          </>
        }
      >
        <span className="pill mono">{p.short_code}</span>
        <span className="pill">{p.status.toLowerCase()}</span>
      </PageHeader>
      <YearBar years={years} selected={year} onSelect={setYear} onAdd={isAdmin ? addYear : undefined} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'areas' && <AreasTab project={p} year={year} onAddYear={addYear} />}
      {tab === 'vendors' && <VendorsTab project={p} year={year} onAddYear={addYear} />}
      {tab === 'schemes' && <SchemesTab project={p} year={year} />}
      {tab === 'years' && <YearsTab project={p} selected={year} onSelect={setYear} onAdd={addYear} />}
      {tab === 'fields' && <CustomFieldsTab projectId={p.id} />}
      {tab === 'assignments' && <AssignmentsTab projectId={p.id} year={year} />}
      {tab === 'serials' && <SerialsTab project={p} year={year} />}
      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} />}
      {sharing && <ShareLinksModal projectId={p.id} projectName={p.name} onClose={() => setSharing(false)} />}
      {del.dialog}
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
      {onAdd && <button type="button" className="chip add" onClick={onAdd}>+ Year</button>}
      {years.length === 0 && !onAdd && <span className="muted">No planting years yet.</span>}
    </div>
  );
}

function YearForm({ projectId, year, onClose, onCreated }: { projectId: string; year?: PlantingYear; onClose: () => void; onCreated?: (year: PlantingYear) => void }) {
  const f = useForm({ year_label: year?.year_label ?? String(new Date().getFullYear()), start_date: year?.start_date ?? '', end_date: year?.end_date ?? '' });
  const create = useMutation({
    mutationFn: () =>
      year
        ? api.patch<PlantingYear>(`/planting-years/${year.id}`, clean({ start_date: f.values.start_date, end_date: f.values.end_date }))
        : api.post<PlantingYear>(`/projects/${projectId}/planting-years`, clean({ ...f.values, year_label: f.values.year_label.trim() })),
    onSuccess: (y) => {
      onCreated?.(y);
      onClose();
    },
  });
  const apiError = create.error as ApiError | null;
  return (
    <Modal title={year ? `Edit ${year.year_label}` : 'Add planting year'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        {apiError?.code === 'YEAR_EXISTS' ? <div className="notice error" role="alert">This planting year already exists for the project.</div> : <ErrorNotice error={create.error} />}
        <div className="form-grid">
          <Field label="Label" hint={year ? 'fixed' : 'cannot change later'}><input required maxLength={16} disabled={!!year} {...f.bind('year_label')} /></Field>
          <Field label="Start date" hint="optional"><input type="date" {...f.bind('start_date')} /></Field>
          <Field label="End date" hint="optional"><input type="date" {...f.bind('end_date')} /></Field>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={create.isPending}>{year ? 'Save' : 'Add planting year'}</button>
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
  ['TREE', 'Asked once, at registration', 'e.g. Nursery batch number'],
  ['OBSERVATION', 'Asked at every visit', 'e.g. Stem diameter (mm)'],
];

function CustomFieldsTab({ projectId }: { projectId: string }) {
  const isAdmin = useIsAdmin();
  const fields = useQuery({ queryKey: ['custom-fields', projectId], queryFn: () => api.get<CustomField[]>(`/projects/${projectId}/custom-fields`) });
  const [form, setForm] = useState<{ field?: CustomField; appliesTo: CustomField['applies_to'] } | null>(null);
  const toggle = useMutation({ mutationFn: (f: CustomField) => api.patch(`/custom-fields/${f.id}`, { active: !f.active }) });
  const del = useDelete();
  return (
    <div className="stack">
      <ErrorNotice error={fields.error ?? toggle.error} />
      {APPLIES_TO.map(([appliesTo, title]) => {
        const rows = (fields.data ?? []).filter((f) => f.applies_to === appliesTo);
        return (
          <section className="card flush" key={appliesTo}>
            <CardHeader title={title} actions={isAdmin && <button onClick={() => setForm({ appliesTo })}>+ Field</button>} />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr><th>Field</th><th>Type</th><th>State</th>{isAdmin && <th className="actions" />}</tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.label}
                        {f.required && <span className="muted"> · required</span>}
                      </td>
                      <td>
                        {FIELD_TYPE_LABEL[f.field_type]}
                        {f.field_type === 'SELECT' && <div className="muted">{f.options.join(', ')}</div>}
                      </td>
                      <td><ActivePill active={f.active} /></td>
                      {isAdmin && (
                        <td className="actions">
                          <EditButton name={f.label} onClick={() => setForm({ field: f, appliesTo })} />
                          <RowMenu
                            items={[
                              { label: 'Edit', onClick: () => setForm({ field: f, appliesTo }) },
                              { label: f.active ? 'Deactivate' : 'Activate', onClick: () => toggle.mutate(f) },
                              { label: 'Delete', danger: true, onClick: () => del.ask({ what: 'field', name: f.label, path: `/custom-fields/${f.id}` }) },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {fields.data && rows.length === 0 && <EmptyState title="No fields" />}
            </div>
          </section>
        );
      })}
      {del.dialog}
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
        <label className="check"><input type="checkbox" {...f.bindCheck('sticky')} /> Pre-fill with the last value entered</label>
        <label className="check"><input type="checkbox" {...f.bindCheck('active')} /> Active</label>
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
  const toggle = useMutation({ mutationFn: ({ path, active }: { path: string; active: boolean }) => api.patch(path, { active }) });
  const del = useDelete();
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
  const areaMenu = (kind: 'sector' | 'sub_sector', area: any, sector?: any) => {
    const path = `/${kind === 'sector' ? 'sectors' : 'sub-sectors'}/${area.id}`;
    const what = kind === 'sector' ? 'sector' : 'sub-sector';
    const edit = () => setForm(kind === 'sector' ? { kind, area } : { kind, area, sector });
    return (
      <>
        <EditButton name={`${what} ${area.short_code} · ${area.name}`} onClick={edit} />
        <RowMenu
          label={`${what} actions`}
          items={[
            { label: 'Edit', onClick: edit },
            { label: area.active ? 'Deactivate' : 'Activate', onClick: () => toggle.mutate({ path, active: !area.active }) },
            {
              label: 'Delete',
              danger: true,
              onClick: () => del.ask({ what, name: `${area.short_code} · ${area.name}`, path, note: kind === 'sector' ? 'Its sub-sectors are deleted too.' : undefined }),
            },
          ]}
        />
      </>
    );
  };
  const hectares = (boundary: any) => (boundaryCorners(boundary).length ? `${areaHectares(orderCorners(boundaryCorners(boundary))).toFixed(1)} ha` : null);
  const sectorCard = (s: any) => (
    <section className="card flush" key={s.id}>
      <div className="card-header" style={{ padding: '12px 12px 0 18px', alignItems: 'center' }}>
        <h2 style={{ minWidth: 0 }}>
          <span className="mono">{s.short_code}</span> · {s.name}
          {!s.active && <span className="pill" style={{ marginLeft: 8 }}>Inactive</span>}
          {hectares(s.boundary) && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>{hectares(s.boundary)}</span>}
        </h2>
        {isAdmin && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button onClick={() => setForm({ kind: 'sub_sector', sector: s })}>+ Sub-sector</button>
            {areaMenu('sector', s)}
          </div>
        )}
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        {s.sub_sectors.length > 0 && (
          <table>
            <tbody>
              {s.sub_sectors.map((ss: any) => (
                <tr key={ss.id} onMouseEnter={() => setHighlight(ss.id)} onMouseLeave={() => setHighlight(undefined)}>
                  <td><span className="mono">{ss.short_code}</span> · {ss.name}</td>
                  <td className="muted nowrap">{hectares(ss.boundary) ?? 'no outline'}</td>
                  <td>{!ss.active && <ActivePill active={false} />}</td>
                  {isAdmin && <td className="actions">{areaMenu('sub_sector', ss, s)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {s.sub_sectors.length === 0 && <EmptyState title="No sub-sectors yet">Each sector needs at least one.</EmptyState>}
      </div>
    </section>
  );
  return (
    <div className="stack">
      <ErrorNotice error={areas.error ?? toggle.error} />
      {!year ? (
        <EmptyState title="Add a planting year first" action={isAdmin && <button className="primary" onClick={onAddYear}>+ Add planting year</button>} />
      ) : (
        <>
          <CardHeader
            title={`${year.year_label}: ${yearSectors.length} sector${yearSectors.length === 1 ? '' : 's'}`}
            actions={
              <>
                {isAdmin && <button className="primary" onClick={() => setForm({ kind: 'sector' })}>+ Sector</button>}
                <RowMenu
                  label="GeoJSON"
                  items={[isAdmin && { label: 'Import GeoJSON', onClick: () => setImporting(true) }, { label: 'Export GeoJSON', onClick: exportGeoJson }]}
                />
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
                Enter each sector’s corner points, or import a GeoJSON file.
              </EmptyState>
            </div>
          )}
        </>
      )}
      {legacy.length > 0 && (
        <>
          <CardHeader title="Older setup (all years)" />
          {legacy.map(sectorCard)}
        </>
      )}
      {del.dialog}
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
            <p className="muted" style={{ margin: 0 }}>Decimal degrees, any order. Pasting “lat, lon” fills both boxes.</p>
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
function VendorsTab({ project, year, onAddYear }: { project: any; year?: PlantingYear; onAddYear: () => void }) {
  const isAdmin = useIsAdmin();
  const vendors = useQuery({ queryKey: ['vendors'], queryFn: () => api.get<any[]>('/vendors') });
  const [vendorId, setVendorId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any | null>(null);
  const del = useDelete();
  const link = useMutation({ mutationFn: (vid: string) => api.post(`/planting-years/${year!.id}/vendors`, { vendor_id: vid }), onSuccess: () => setVendorId('') });
  const unlink = useMutation({ mutationFn: (id: string) => api.post(`/planting-year-vendors/${id}/unlink`) });
  if (!year) {
    return <EmptyState title="Add a planting year first" action={isAdmin && <button className="primary" onClick={onAddYear}>+ Add planting year</button>} />;
  }
  const links = yearLinks(project, year.id);
  const active = links.filter((l) => l.active);
  // Active links first, then earlier ones (kept so they can be linked again).
  const ordered = [...active, ...links.filter((l) => !l.active && !active.some((a) => a.vendor_id === l.vendor_id))];
  const available = (vendors.data ?? []).filter((v) => v.active !== false && !links.some((l) => l.vendor_id === v.id));
  return (
    <div className="stack">
      <ErrorNotice error={vendors.error ?? link.error ?? unlink.error} />
      <section className="card flush">
        <CardHeader
          title={`Vendors in ${year.year_label}`}
          description="Who plants this year. Tree IDs do not depend on the vendor: all vendors share one sequence of tree numbers per planting year."
        />
        <div className="table-wrap" style={{ marginTop: 12 }}>
          {ordered.length > 0 && (
            <table>
              <thead><tr><th>Vendor</th>{isAdmin && <th className="actions" />}</tr></thead>
              <tbody>
                {ordered.map((l) => {
                  const vendor = vendors.data?.find((v) => v.id === l.vendor_id);
                  return (
                    <tr key={l.id} style={l.active ? undefined : { opacity: 0.65 }}>
                      <td>
                        {l.vendor_name}
                        {l.vendor_short_code && <span className="muted mono"> · {l.vendor_short_code}</span>}
                        {!l.active && <span className="pill" style={{ marginLeft: 8 }}>Unlinked</span>}
                      </td>
                      {isAdmin && (
                        <td className="actions">
                          {vendor && <EditButton label="Edit vendor" name={l.vendor_name} onClick={() => setEditingVendor(vendor)} />}
                          <RowMenu
                            items={[
                              vendor && { label: 'Edit vendor', onClick: () => setEditingVendor(vendor) },
                              l.active
                                ? {
                                    label: 'Unlink',
                                    onClick: () => confirm(`Unlink ${l.vendor_name} from ${year.year_label}? Trees already registered keep their vendor.`) && unlink.mutate(l.id),
                                  }
                                : { label: 'Link again', onClick: () => link.mutate(l.vendor_id) },
                              {
                                label: 'Delete link',
                                danger: true,
                                onClick: () => del.ask({ what: 'vendor link', name: `${l.vendor_name} in ${year.year_label}`, path: `/planting-year-vendors/${l.id}` }),
                              },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {ordered.length === 0 && <EmptyState title={`No vendors in ${year.year_label} yet`} />}
        </div>
      </section>
      {isAdmin && (
        <form className="card" onSubmit={(e) => (e.preventDefault(), vendorId && link.mutate(vendorId))}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label={`Add a vendor to ${year.year_label}`}>
              <select required value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={available.length === 0}>
                <option value="">{available.length ? 'Choose…' : 'All vendors are linked'}</option>
                {available.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.short_code ? ` (${v.short_code})` : ''}</option>
                ))}
              </select>
            </Field>
            <button className="primary" disabled={!vendorId || link.isPending}>Link</button>
            <button type="button" onClick={() => setCreating(true)}>+ New vendor</button>
          </div>
        </form>
      )}
      {del.dialog}
      {editingVendor && <ReferenceForm kind="vendors" row={editingVendor} onClose={() => setEditingVendor(null)} />}
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
        <div className="form-grid">
          <Field label="Name"><input required maxLength={200} placeholder="Kano Nurseries Ltd" {...f.bind('name')} /></Field>
          <Field label="Short code" hint="e.g. KNM">
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

// ------------------------------------------------------------------ ID format
/** One format per project: every vendor and planting year uses it, so tree numbers run per project and year. */
function SchemesTab({ project, year }: { project: any; year?: PlantingYear }) {
  const isAdmin = useIsAdmin();
  const codes = useExampleCodes(project.id, year);
  const [building, setBuilding] = useState(false);
  const del = useDelete();
  const deleteVersion = (sc: Scheme) => del.ask({ what: 'ID format version', name: `Version ${sc.version}`, path: `/tree-id-schemes/${sc.id}`, note: 'Only a version no tree uses can be deleted.' });
  const schemes: Scheme[] = project.tree_id_schemes;
  const current = currentScheme(schemes);
  const history = schemes.filter((s) => s.id !== current?.id);
  const values = (yearLabel?: string | null, vendorCode?: string | null) => ({
    PROJECT_CODE: project.short_code,
    PLANTING_YEAR: yearLabel ?? year?.year_label,
    VENDOR_CODE: vendorCode,
    SECTOR_CODE: codes.sector,
    SUB_SECTOR_CODE: codes.subSector,
  });

  return (
    <div className="stack">
      {!current && <div className="notice warning">No ID format yet: officers cannot register trees without one.</div>}
      <section className="card">
        <CardHeader
          title="Tree ID format"
          description="One format for the whole project, used for every vendor and planting year."
          actions={isAdmin && <button className="primary" onClick={() => setBuilding(true)}>{current ? 'Change' : 'Create'}</button>}
        />
        {current ? (
          <div className="stack" style={{ gap: 6 }}>
            <div>{exampleId(current, values())}</div>
            <div className="muted">
              {current.component_definition.map((c) => (c.type === 'TEXT' ? `“${c.value}”` : componentLabel(c.type))).join(' → ')} · {current.serial_width}-digit tree number, unique per{' '}
              {scopeLabel(current.serial_uniqueness_scope)} · version {current.version} since {fmtDate(current.active_from)}
            </div>
          </div>
        ) : (
          <div className="muted">None yet.</div>
        )}
      </section>
      <details className="more">
        <summary>How tree numbers work</summary>
        <p className="muted">
          All vendors on the project share one progressive sequence of tree numbers per planting year; the vendor is recorded on each tree but is not part of its ID. Fixed
          parts (project, year, text) are filled in by the phone; the officer types only the tree number. Changes apply to new registrations only: trees already registered keep
          their IDs.
        </p>
      </details>
      {history.length > 0 && (
        <details className="card">
          <summary><strong>Earlier versions ({history.length})</strong></summary>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Version</th><th>Applied to</th><th>Example</th>{isAdmin && <th className="actions" />}</tr></thead>
              <tbody>
                {history.map((s) => (
                  <tr key={s.id}>
                    <td title={`Since ${fmtDateTime(s.active_from)}`}>{s.version}</td>
                    <td>{appliedTo(s)}</td>
                    <td>{exampleId(s, values(s.year_label, s.vendor_short_code))}</td>
                    {isAdmin && <td className="actions"><RowMenu items={[{ label: 'Delete', danger: true, onClick: () => deleteVersion(s) }]} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {del.dialog}
      {building && <SchemeBuilder project={project} year={year} current={current} codes={codes} onClose={() => setBuilding(false)} />}
    </div>
  );
}

type Part = SchemeComponent & { key: number };
const DEFAULT_PARTS: SchemeComponent[] = [
  { type: 'PROJECT_CODE', required: true },
  { type: 'PLANTING_YEAR', required: true },
];
/** Parts and numbering scopes that new formats can no longer use (formats from before IDs were per project and year). */
const RETIRED_PART = 'VENDOR_CODE';
const RETIRED_SCOPE = 'VENDOR';

function SchemeBuilder({ project, year, current, codes, onClose }: { project: any; year?: PlantingYear; current?: Scheme; codes: { sector: string; subSector: string }; onClose: () => void }) {
  const nextKey = useRef(0);
  const withKeys = (cs: SchemeComponent[]): Part[] => cs.filter((c) => c.type !== 'SERIAL' && c.type !== RETIRED_PART).map((c) => ({ ...c, key: nextKey.current++ }));
  /** Starts from the current format, so a change is an edit, not a blank slate. */
  const [form, setForm] = useState(() => ({
    parts: withKeys(current?.component_definition ?? DEFAULT_PARTS),
    separator: current?.separator ?? '-',
    width: current?.serial_width ?? 6,
    serialScope: (current?.serial_uniqueness_scope ?? RECOMMENDED_SCOPE).filter((d) => d !== RETIRED_SCOPE),
  }));
  const { parts, separator, width, serialScope } = form;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const [localError, setLocalError] = useState<string | null>(null);

  const components: SchemeComponent[] = [
    ...parts.map(({ type, required, value }) => (type === 'TEXT' ? { type, required: true, value: (value ?? '').trim().toUpperCase() } : { type, required })),
    { type: 'SERIAL', required: true },
  ];
  const save = useMutation({
    mutationFn: () =>
      api.post(`/projects/${project.id}/tree-id-schemes`, {
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

  const sampleYear = year?.year_label ?? String(new Date().getFullYear());
  const sample = previewId(components, separator, width, {
    PROJECT_CODE: project.short_code,
    PLANTING_YEAR: sampleYear,
    SECTOR_CODE: codes.sector,
    SUB_SECTOR_CODE: codes.subSector,
  });
  const isRecommended = RECOMMENDED_SCOPE.every((d) => serialScope.includes(d)) && serialScope.length === RECOMMENDED_SCOPE.length;
  const hadVendor = !!current && (current.component_definition.some((c) => c.type === RETIRED_PART) || current.serial_uniqueness_scope.includes(RETIRED_SCOPE));

  return (
    <Modal title={current ? `Change the ID format (now version ${current.version})` : 'New ID format'} onClose={onClose} wide>
      <div className="stack">
        {localError ? <div className="notice error" role="alert">{localError}</div> : <ErrorNotice error={save.error} />}
        <p className="muted" style={{ margin: 0 }}>
          The format applies to the whole project: every vendor and planting year. Trees already registered keep their IDs.
        </p>
        {hadVendor && <div className="notice">The vendor is no longer part of tree IDs, so the vendor code and per-vendor numbering have been left out.</div>}
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
            <strong>Fixed</strong> parts are the same for every tree in a year (project, year, fixed text). <strong>Changing</strong> parts depend on the tree (sector, sub-sector,
            tree number).
          </p>
        </div>
        <div className="form-grid">
          <Field label="Separator">
            <select value={separator} onChange={(e) => set({ separator: e.target.value })}>
              {[['-', 'Hyphen  -'], ['_', 'Underscore  _'], ['/', 'Slash  /'], ['.', 'Dot  .'], ['', 'None']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Tree number digits" hint="zero-padded, e.g. 6 → 000015">
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
          {!isRecommended && (
            <div className="notice">
              Recommended: unique per <strong>project + planting year</strong>, so tree numbers run in one sequence each year, shared by all vendors.{' '}
              <button type="button" className="link" onClick={() => set({ serialScope: RECOMMENDED_SCOPE })}>Use recommended</button>
            </div>
          )}
        </div>
        <div>
          <h3>Preview</h3>
          <div className="id-preview">{sample.prefix}<span className="serial">{sample.serial}</span></div>
          <p className="muted">
            Example for year {sampleYear}, sector {codes.sector}, sub-sector {codes.subSector}, tree 15. Officers see the prefix filled in and type only the highlighted tree number.
          </p>
        </div>
        <div className="form-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={save.isPending}>Publish</button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ planting years
function YearsTab({ project, selected, onSelect, onAdd }: { project: any; selected?: PlantingYear; onSelect: (id: string) => void; onAdd: () => void }) {
  const isAdmin = useIsAdmin();
  const toggle = useMutation({ mutationFn: (y: PlantingYear) => api.patch(`/planting-years/${y.id}`, { active: !y.active }) });
  const [editing, setEditing] = useState<PlantingYear | null>(null);
  const del = useDelete();
  const years: PlantingYear[] = project.planting_years;
  return (
    <div className="stack">
      <ErrorNotice error={toggle.error} />
      <div className="card table-wrap">
        {years.length > 0 && (
          <table>
            <thead><tr><th>Year</th><th>Dates</th><th className="num">Vendors</th><th>State</th>{isAdmin && <th className="actions" />}</tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="clickable" onClick={() => onSelect(y.id)} aria-selected={y.id === selected?.id}>
                  <td className="mono">{y.year_label}{y.id === selected?.id && <span className="pill" style={{ marginLeft: 8 }}>Selected</span>}</td>
                  <td className="nowrap">{y.start_date || y.end_date ? `${fmtDate(y.start_date)} – ${fmtDate(y.end_date)}` : <span className="muted">—</span>}</td>
                  <td className="num">{yearLinks(project, y.id).filter((l) => l.active).length}</td>
                  <td>{y.active ? <span className="pill good">Open</span> : <span className="pill">Closed</span>}</td>
                  {isAdmin && (
                    <td className="actions">
                      <EditButton label="Edit dates of" name={y.year_label} onClick={() => setEditing(y)} />
                      <RowMenu
                        items={[
                          { label: 'Edit dates', onClick: () => setEditing(y) },
                          { label: y.active ? 'Close for new trees' : 'Reopen', onClick: () => toggle.mutate(y) },
                          {
                            label: 'Delete',
                            danger: true,
                            onClick: () =>
                              del.ask({ what: 'planting year', name: y.year_label, path: `/planting-years/${y.id}`, note: 'Its sectors, sub-sectors, vendor links and formats are deleted too.' }),
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {years.length === 0 && <EmptyState title="No planting years yet" action={isAdmin && <button className="primary" onClick={onAdd}>+ Add planting year</button>} />}
      </div>
      {isAdmin && years.length > 0 && <div><button onClick={onAdd}>+ Year</button></div>}
      {del.dialog}
      {editing && <YearForm projectId={project.id} year={editing} onClose={() => setEditing(null)} />}
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
      <div className="card table-wrap">
        {!!assignments.data?.length && (
          <table>
            <thead><tr><th>Person</th><th>Access</th><th className="actions" /></tr></thead>
            <tbody>
              {assignments.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.user_name}<div className="muted">{a.user_role === 'EXECUTIVE' ? 'Client / sponsor' : a.user_role.replace('_', ' ').toLowerCase()}</div></td>
                  <td>{a.sub_sector_name ? `${a.sector_name} / ${a.sub_sector_name}` : a.sector_name ?? 'Whole project'}</td>
                  <td className="actions">
                    <RowMenu items={[{ label: 'Remove access', danger: true, onClick: () => confirm(`Remove ${a.user_name}'s access?`) && revoke.mutate(a.id) }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {assignments.data?.length === 0 && <EmptyState title="Nobody assigned">Unassigned officers and clients cannot see this project.</EmptyState>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Give access</h3>
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
const KEYABLE = ['PROJECT', 'PLANTING_YEAR'];

function SerialsTab({ project, year }: { project: any; year?: PlantingYear }) {
  const allocations = useQuery({ queryKey: ['allocations', project.id], queryFn: () => api.get<any[]>(`/serial-allocations${qs({ project_id: project.id })}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<any[]>('/users') });
  const scheme = currentScheme(project.tree_id_schemes);
  const dims: string[] = scheme?.serial_uniqueness_scope ?? [];
  const f = useForm({ user_id: '', range_start: '', range_end: '', notes: '', scope_key: '' });
  // Suggest the scope key when it depends only on project and year; sector-level keys can be pasted.
  const lookup: Record<string, string | undefined> = { PROJECT: project.id, PLANTING_YEAR: year?.id };
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
      <div className="notice warning">When a scope has ranges, serials outside them are rejected at sync.</div>
      <div className="card table-wrap">
        {!!allocations.data?.length && (
          <table>
            <thead><tr><th>Officer</th><th className="num">Range</th><th>Scope</th><th className="actions" /></tr></thead>
            <tbody>
              {allocations.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.user_name ?? 'Any officer'}{a.notes && <div className="muted">{a.notes}</div>}</td>
                  <td className="num nowrap">{a.range_start} – {a.range_end}</td>
                  <td className="mono muted" style={{ fontSize: 11, maxWidth: 280, wordBreak: 'break-all' }}>{a.scope_key}</td>
                  <td className="actions">
                    <RowMenu items={[{ label: 'Revoke', danger: true, onClick: () => confirm(`Revoke range ${a.range_start}–${a.range_end}?`) && revoke.mutate(a.id) }]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {allocations.data?.length === 0 && <EmptyState title="No ranges">Any serial is accepted; duplicates become conflicts.</EmptyState>}
      </div>
      <form className="card" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <h3>Allocate a range{year ? ` in ${year.year_label}` : ''}</h3>
        <ErrorNotice error={create.error ?? revoke.error} />
        <div className="form-grid">
          <Field label="Officer" hint="optional">
            <select {...f.bind('user_id')}>
              <option value="">Any officer in scope</option>
              {users.data?.filter((u) => u.role === 'FIELD_OFFICER' && u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
          <Field label="First serial"><input required type="number" min={1} {...f.bind('range_start')} /></Field>
          <Field label="Last serial"><input required type="number" min={1} {...f.bind('range_end')} /></Field>
        </div>
        <Field label="Scope key" hint={suggested ? 'filled from the planting year' : 'see the format’s uniqueness scope'}>
          <input className="mono" required value={f.values.scope_key || suggested} onChange={(e) => f.setValues({ ...f.values, scope_key: e.target.value })} />
        </Field>
        <Field label="Notes"><input {...f.bind('notes')} /></Field>
        <div className="form-actions"><button className="primary" disabled={create.isPending}>Allocate</button></div>
      </form>
    </div>
  );
}
