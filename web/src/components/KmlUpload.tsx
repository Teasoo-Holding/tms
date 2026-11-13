import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { ErrorNotice, fmtNum, Modal, SimpleTable } from './ui';

interface KmlResult {
  applied: boolean;
  summary: { planting_year: string; sectors_created: number; sectors_updated: number; sub_sectors_created: number; sub_sectors_updated: number; rally_points: number };
  areas: { kind: string; code: string; name: string; hectares: number; action: 'create' | 'update'; repaired: boolean }[];
  rally_points: { name: string; latitude: number; longitude: number }[];
  skipped: { name: string; reason: string }[];
}

/**
 * Upload a KML file of a planting year's sectors and sub-sectors (Google Earth, QGIS). Shows what will change first;
 * nothing is saved until "Apply". Existing areas are updated in place, so trees keep their areas; nothing is deleted.
 */
export function KmlUpload({ year, onClose }: { year: { id: string; year_label: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [kml, setKml] = useState<string | null>(null);
  const [file, setFile] = useState('');
  const preview = useMutation({ mutationFn: (text: string) => api.post<KmlResult>(`/planting-years/${year.id}/areas/kml`, { kml: text }) });
  const apply = useMutation({
    mutationFn: () => api.post<KmlResult>(`/planting-years/${year.id}/areas/kml`, { kml, apply: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['areas'] });
      qc.invalidateQueries({ queryKey: ['project'] });
    },
  });
  const read = async (f: File | undefined) => {
    if (!f) return;
    setFile(f.name);
    const text = await f.text();
    setKml(text);
    apply.reset();
    preview.mutate(text);
  };
  const r = apply.data ?? preview.data;
  const s = r?.summary;
  return (
    <Modal title={`Upload KML for ${year.year_label}`} onClose={onClose} wide>
      <div className="stack">
        <p style={{ margin: 0 }}>
          Name each outline “Sector 1”, “Sector 1 Subsector 1” and so on (or S1, S1/SS1). Points named as rally points (for example “Rally point – camp”) are added
          to the project’s rally points for the field map. You see what will change before anything is saved.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          From Google Earth: right-click the folder → Save place as… → KML. A file of map layers only (no places) has no outlines to read.
        </p>
        <label className="field">
          KML file
          <input type="file" accept=".kml,application/vnd.google-earth.kml+xml" onChange={(e) => read(e.target.files?.[0])} />
        </label>
        <ErrorNotice error={preview.error ?? apply.error} />
        {preview.isPending && <p className="muted">Reading {file}…</p>}
        {s && (
          <>
            <div className={`notice ${r!.applied ? '' : 'warning'}`} role="status">
              {r!.applied ? <strong>Saved. </strong> : <strong>Not saved yet. </strong>}
              {r!.applied ? '' : 'Uploading will '}
              {[
                s.sectors_created && `${r!.applied ? 'created' : 'create'} ${fmtNum(s.sectors_created)} sectors`,
                s.sectors_updated && `${r!.applied ? 'updated' : 'update'} ${fmtNum(s.sectors_updated)} sectors`,
                s.sub_sectors_created && `${r!.applied ? 'created' : 'create'} ${fmtNum(s.sub_sectors_created)} sub-sectors`,
                s.sub_sectors_updated && `${r!.applied ? 'updated' : 'update'} ${fmtNum(s.sub_sectors_updated)} sub-sectors`,
                s.rally_points && `${r!.applied ? 'added' : 'add'} ${fmtNum(s.rally_points)} rally points`,
              ].filter(Boolean).join(', ')}
              {r!.applied ? ` in ${s.planting_year}.` : ` in ${s.planting_year}. Trees keep their sectors and sub-sectors; nothing is deleted.`}
            </div>
            {r!.skipped.length > 0 && (
              <details>
                <summary>{fmtNum(r!.skipped.length)} places were not used</summary>
                <SimpleTable head={['Name', 'Why']} rows={r!.skipped.map((x) => [x.name, x.reason])} />
              </details>
            )}
            <details>
              <summary>Areas in the file ({fmtNum(r!.areas.length)})</summary>
              <SimpleTable
                head={['Area', 'Hectares', 'Change']}
                numeric={[1]}
                rows={r!.areas.map((a) => [a.code, a.hectares.toFixed(2), `${a.action === 'create' ? 'New' : 'Update outline'}${a.repaired ? ' (outline repaired)' : ''}`])}
              />
            </details>
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>{r?.applied ? 'Close' : 'Cancel'}</button>
          {!r?.applied && (
            <button className="primary" disabled={!kml || !preview.data || apply.isPending} onClick={() => apply.mutate()}>
              {apply.isPending ? 'Saving…' : 'Apply'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
