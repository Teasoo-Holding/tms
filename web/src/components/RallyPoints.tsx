import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { CardHeader, EmptyState, ErrorNotice, Field } from './ui';

interface RallyPoint {
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * The project's rally points (#128): named meeting points that phones show on the offline field map, with the distance
 * and direction to each. Saved with the project and synced to phones.
 */
export function RallyPointsTab({ project, isAdmin }: { project: any; isAdmin: boolean }) {
  const qc = useQueryClient();
  const points: RallyPoint[] = project.rally_points ?? [];
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const save = useMutation({
    mutationFn: (next: RallyPoint[]) => api.patch(`/projects/${project.id}`, { rally_points: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] });
      setName('');
      setLat('');
      setLon('');
    },
  });
  const latitude = Number(lat);
  const longitude = Number(lon);
  const valid = name.trim() && lat !== '' && lon !== '' && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return (
    <div className="stack">
      <CardHeader
        title="Rally points"
        description="Meeting points shown on the phone’s offline field map, with the distance and direction from the officer’s position. Officers can also mark their own starting point on the phone."
      />
      <ErrorNotice error={save.error} />
      {points.length === 0 ? (
        <EmptyState title="No rally points yet">Add one below, or include points named “Rally point …” in a KML upload.</EmptyState>
      ) : (
        <section className="card">
          <table>
            <thead>
              <tr><th>Name</th><th className="num">Latitude</th><th className="num">Longitude</th>{isAdmin && <th className="actions" />}</tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={`${p.name}-${i}`}>
                  <td>{p.name}</td>
                  <td className="num mono">{p.latitude.toFixed(6)}</td>
                  <td className="num mono">{p.longitude.toFixed(6)}</td>
                  {isAdmin && (
                    <td className="actions">
                      <button className="danger" onClick={() => save.mutate(points.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {isAdmin && (
        <form className="card stack" onSubmit={(e) => (e.preventDefault(), valid && save.mutate([...points, { name: name.trim(), latitude, longitude }]))}>
          <h3 style={{ margin: 0 }}>Add a rally point</h3>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Camp by the access road" required /></Field>
            <Field label="Latitude"><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="6.6175" required /></Field>
            <Field label="Longitude"><input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="5.8920" required /></Field>
            <button className="primary" disabled={!valid || save.isPending}>Add</button>
          </div>
        </form>
      )}
    </div>
  );
}
