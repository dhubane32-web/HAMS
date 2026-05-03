'use client';

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

type Row = Record<string, unknown>;

type TabId =
  | 'countries'
  | 'cities'
  | 'currencies'
  | 'airports'
  | 'routes'
  | 'aircraft-types'
  | 'seat-maps'
  | 'aircraft-records'
  | 'fare-classes'
  | 'route-fares'
  | 'tax-settings'
  | 'fee-settings'
  | 'payment-methods'
  | 'baggage-rules'
  | 'departments'
  | 'role-definitions'
  | 'system-preferences';

const TABS: { id: TabId; label: string }[] = [
  { id: 'countries', label: 'Countries' },
  { id: 'cities', label: 'Cities' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'airports', label: 'Airports' },
  { id: 'routes', label: 'Routes' },
  { id: 'aircraft-types', label: 'Aircraft types' },
  { id: 'seat-maps', label: 'Seat maps' },
  { id: 'aircraft-records', label: 'Aircraft' },
  { id: 'fare-classes', label: 'Fare classes' },
  { id: 'route-fares', label: 'Route fares' },
  { id: 'tax-settings', label: 'Taxes' },
  { id: 'fee-settings', label: 'Fees' },
  { id: 'payment-methods', label: 'Payments' },
  { id: 'baggage-rules', label: 'Baggage' },
  { id: 'departments', label: 'Departments' },
  { id: 'role-definitions', label: 'Roles' },
  { id: 'system-preferences', label: 'Preferences' }
];

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('hams_token') : null;
}

async function mdFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}/api/master-data${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  });
  return res;
}

function cell(v: unknown) {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function MasterDataAdmin() {
  const [tab, setTab] = useState<TabId>('airports');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [refs, setRefs] = useState<{
    countries: Row[];
    airports: Row[];
    routes: Row[];
    fareClasses: Row[];
    currencies: Row[];
    aircraftTypes: Row[];
    seatMaps: Row[];
  }>({ countries: [], airports: [], routes: [], fareClasses: [], currencies: [], aircraftTypes: [], seatMaps: [] });

  const loadRefs = useCallback(async () => {
    const paths = [
      ['countries', '/countries'],
      ['airports', '/airports'],
      ['routes', '/routes'],
      ['fareClasses', '/fare-classes'],
      ['currencies', '/currencies'],
      ['aircraftTypes', '/aircraft-types'],
      ['seatMaps', '/seat-maps']
    ] as const;
    const next: {
      countries: Row[];
      airports: Row[];
      routes: Row[];
      fareClasses: Row[];
      currencies: Row[];
      aircraftTypes: Row[];
      seatMaps: Row[];
    } = { countries: [], airports: [], routes: [], fareClasses: [], currencies: [], aircraftTypes: [], seatMaps: [] };
    await Promise.all(
      paths.map(async ([key, p]) => {
        const r = await mdFetch(p);
        if (!r.ok) return;
        const j = (await r.json()) as { rows?: Row[] };
        next[key] = j.rows || [];
      })
    );
    setRefs(next);
  }, []);

  const loadTab = useCallback(async (t: TabId) => {
    setLoading(true);
    try {
      if (t === 'role-definitions' || t === 'system-preferences') {
        const r = await mdFetch(t === 'role-definitions' ? '/role-definitions' : '/system-preferences');
        const j = (await r.json()) as { rows?: Row[] };
        if (!r.ok) throw new Error((j as { message?: string }).message || r.statusText);
        setRows(j.rows || []);
        return;
      }
      const r = await mdFetch(`/${t}`);
      const j = (await r.json()) as { rows?: Row[] };
      if (!r.ok) throw new Error((j as { message?: string }).message || r.statusText);
      setRows(j.rows || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Load failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadTab(tab);
  }, [tab, loadTab]);

  async function del(resource: string, id: string) {
    if (!confirm('Delete this row?')) return;
    const r = await mdFetch(`/${resource}/${id}`, { method: 'DELETE' });
    if (r.status === 204) {
      toast.success('Deleted');
      void loadTab(tab);
      void loadRefs();
      return;
    }
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    toast.error(j.message || 'Delete failed');
  }

  return (
    <div className="module-page" style={{ gap: '0.85rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            className={tab === x.id ? undefined : 'secondary'}
            style={{ fontSize: '0.78rem', padding: '0.4rem 0.55rem' }}
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <section className="module-card">
        {loading && <p style={{ margin: 0, color: '#64748b' }}>Loading…</p>}

        {!loading && tab === 'countries' && (
          <CountriesPanel rows={rows} onRefresh={() => loadTab('countries')} onDelete={(id) => del('countries', id)} />
        )}
        {!loading && tab === 'cities' && (
          <CitiesPanel
            rows={rows}
            countries={refs.countries}
            onRefresh={() => loadTab('cities')}
            onDelete={(id) => del('cities', id)}
          />
        )}
        {!loading && tab === 'currencies' && (
          <CurrenciesPanel rows={rows} onRefresh={() => loadTab('currencies')} onDelete={(id) => del('currencies', id)} />
        )}
        {!loading && tab === 'airports' && (
          <AirportsPanel
            rows={rows}
            countries={refs.countries}
            onRefresh={() => {
              void loadTab('airports');
              void loadRefs();
            }}
            onDelete={(id) => del('airports', id)}
          />
        )}
        {!loading && tab === 'routes' && (
          <RoutesPanel
            rows={rows}
            airports={refs.airports}
            onRefresh={() => {
              void loadTab('routes');
              void loadRefs();
            }}
            onDelete={(id) => del('routes', id)}
          />
        )}
        {!loading && tab === 'aircraft-types' && (
          <AircraftTypesPanel rows={rows} onRefresh={() => loadTab('aircraft-types')} onDelete={(id) => del('aircraft-types', id)} />
        )}
        {!loading && tab === 'seat-maps' && (
          <SeatMapsPanel
            rows={rows}
            aircraftTypes={refs.aircraftTypes}
            onRefresh={() => {
              void loadTab('seat-maps');
              void loadRefs();
            }}
            onDelete={(id) => del('seat-maps', id)}
          />
        )}
        {!loading && tab === 'aircraft-records' && (
          <AircraftRecordsPanel
            rows={rows}
            aircraftTypes={refs.aircraftTypes}
            seatMaps={refs.seatMaps}
            onRefresh={() => {
              void loadTab('aircraft-records');
              void loadRefs();
            }}
            onDelete={(id) => del('aircraft-records', id)}
          />
        )}
        {!loading && tab === 'fare-classes' && (
          <FareClassesPanel rows={rows} onRefresh={() => loadTab('fare-classes')} onDelete={(id) => del('fare-classes', id)} />
        )}
        {!loading && tab === 'route-fares' && (
          <RouteFaresPanel
            rows={rows}
            routes={refs.routes}
            fareClasses={refs.fareClasses}
            currencies={refs.currencies}
            onRefresh={() => {
              void loadTab('route-fares');
              void loadRefs();
            }}
            onDelete={(id) => del('route-fares', id)}
          />
        )}
        {!loading && tab === 'tax-settings' && (
          <TaxSettingsPanel rows={rows} onRefresh={() => loadTab('tax-settings')} onDelete={(id) => del('tax-settings', id)} />
        )}
        {!loading && tab === 'fee-settings' && (
          <FeeSettingsPanel rows={rows} onRefresh={() => loadTab('fee-settings')} onDelete={(id) => del('fee-settings', id)} />
        )}
        {!loading && tab === 'payment-methods' && (
          <PaymentMethodsPanel rows={rows} onRefresh={() => loadTab('payment-methods')} onDelete={(id) => del('payment-methods', id)} />
        )}
        {!loading && tab === 'baggage-rules' && (
          <BaggageRulesPanel
            rows={rows}
            routes={refs.routes}
            fareClasses={refs.fareClasses}
            onRefresh={() => loadTab('baggage-rules')}
            onDelete={(id) => del('baggage-rules', id)}
          />
        )}
        {!loading && tab === 'departments' && (
          <DepartmentsPanel rows={rows} onRefresh={() => loadTab('departments')} onDelete={(id) => del('departments', id)} />
        )}
        {!loading && tab === 'role-definitions' && <RoleDefsPanel rows={rows} onRefresh={() => loadTab('role-definitions')} />}
        {!loading && tab === 'system-preferences' && (
          <SysPrefsPanel rows={rows} onRefresh={() => loadTab('system-preferences')} />
        )}
      </section>
    </div>
  );
}

function formGrid(onSubmit: (e: FormEvent) => void, children: ReactNode) {
  return (
    <form className="module-form-grid" onSubmit={onSubmit} style={{ marginTop: '0.75rem' }}>
      {children}
      <button type="submit">Save / create</button>
    </form>
  );
}

function CountriesPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [iso2, setIso2] = useState('');
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/countries', { method: 'POST', body: JSON.stringify({ iso2, name }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Country created');
    setIso2('');
    setName('');
    onRefresh();
  }
  return (
    <div>
      <h2>Countries</h2>
      <p style={{ margin: 0, color: '#64748b', fontSize: '0.88rem' }}>{rows.length} rows · Admin-only writes</p>
      {formGrid(
        submit,
        <>
          <input value={iso2} onChange={(e) => setIso2(e.target.value.toUpperCase())} placeholder="ISO2" maxLength={2} required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.iso2)} — {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CitiesPanel({
  rows,
  countries,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  countries: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [country_id, setCountry] = useState('');
  const [name, setName] = useState('');
  const [iata_code, setIata] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/cities', { method: 'POST', body: JSON.stringify({ country_id, name, iata_code: iata_code || null }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('City created');
    setName('');
    setIata('');
    onRefresh();
  }
  return (
    <div>
      <h2>Cities</h2>
      {formGrid(
        submit,
        <>
          <select value={country_id} onChange={(e) => setCountry(e.target.value)} required>
            <option value="">Country</option>
            {countries.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.iso2)} {String(c.name)}
              </option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="City name" required />
          <input value={iata_code} onChange={(e) => setIata(e.target.value)} placeholder="IATA (optional)" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.name)} ({String(r.country_iso2 || '')})
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CurrenciesPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/currencies', { method: 'POST', body: JSON.stringify({ code, name, decimal_places: 2 }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('OK');
    setCode('');
    setName('');
    onRefresh();
  }
  return (
    <div>
      <h2>Currencies</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code" maxLength={3} required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} — {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AirportsPanel({
  rows,
  countries,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  countries: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [iata_code, setIata] = useState('');
  const [name, setName] = useState('');
  const [country_id, setC] = useState('');
  const [timezone, setTz] = useState('UTC');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/airports', {
      method: 'POST',
      body: JSON.stringify({ iata_code, name, country_id: country_id || null, city_id: null, timezone })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Airport created');
    setIata('');
    setName('');
    onRefresh();
  }
  return (
    <div>
      <h2>Airports</h2>
      {formGrid(
        submit,
        <>
          <input value={iata_code} onChange={(e) => setIata(e.target.value)} placeholder="IATA" maxLength={3} required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <select value={country_id} onChange={(e) => setC(e.target.value)}>
            <option value="">Country (optional)</option>
            {countries.map((c) => (
              <option key={String(c.id)} value={String(c.id)}>
                {String(c.iso2)}
              </option>
            ))}
          </select>
          <input value={timezone} onChange={(e) => setTz(e.target.value)} placeholder="Timezone" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.iata_code)} {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutesPanel({
  rows,
  airports,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  airports: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [origin_airport_id, setO] = useState('');
  const [dest_airport_id, setD] = useState('');
  const [distance_nm, setDist] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/routes', {
      method: 'POST',
      body: JSON.stringify({
        origin_airport_id,
        dest_airport_id,
        distance_nm: distance_nm ? Number(distance_nm) : null
      })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Route created');
    onRefresh();
  }
  return (
    <div>
      <h2>Routes (origin → destination airports)</h2>
      {formGrid(
        submit,
        <>
          <select value={origin_airport_id} onChange={(e) => setO(e.target.value)} required>
            <option value="">Origin airport</option>
            {airports.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {String(a.iata_code)}
              </option>
            ))}
          </select>
          <select value={dest_airport_id} onChange={(e) => setD(e.target.value)} required>
            <option value="">Destination airport</option>
            {airports.map((a) => (
              <option key={String(a.id)} value={String(a.id)}>
                {String(a.iata_code)}
              </option>
            ))}
          </select>
          <input value={distance_nm} onChange={(e) => setDist(e.target.value)} placeholder="Distance nm" type="number" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.origin_iata)} → {String(r.dest_iata)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AircraftTypesPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [default_seat_capacity, setCap] = useState('162');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/aircraft-types', {
      method: 'POST',
      body: JSON.stringify({ code, name, default_seat_capacity: Number(default_seat_capacity) })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('OK');
    onRefresh();
  }
  return (
    <div>
      <h2>Aircraft types</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <input value={default_seat_capacity} onChange={(e) => setCap(e.target.value)} type="number" placeholder="Default seats" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} — {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeatMapsPanel({
  rows,
  aircraftTypes,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  aircraftTypes: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [aircraft_type_id, setT] = useState('');
  const [layout, setLayout] = useState('{"rows":28,"economy":"3-3"}');
  async function submit(e: FormEvent) {
    e.preventDefault();
    let layout_json = {};
    try {
      layout_json = JSON.parse(layout) as object;
    } catch {
      return toast.error('Invalid JSON for layout');
    }
    const r = await mdFetch('/seat-maps', { method: 'POST', body: JSON.stringify({ name, aircraft_type_id, layout_json }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Seat map created');
    onRefresh();
  }
  return (
    <div>
      <h2>Seat maps</h2>
      {formGrid(
        submit,
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <select value={aircraft_type_id} onChange={(e) => setT(e.target.value)} required>
            <option value="">Aircraft type</option>
            {aircraftTypes.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {String(t.code)}
              </option>
            ))}
          </select>
          <textarea value={layout} onChange={(e) => setLayout(e.target.value)} placeholder="layout JSON" rows={3} style={{ gridColumn: '1 / -1' }} />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.name)} ({String(r.aircraft_type_code)})
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AircraftRecordsPanel({
  rows,
  aircraftTypes,
  seatMaps,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  aircraftTypes: Row[];
  seatMaps: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [tail_number, setTail] = useState('');
  const [model, setModel] = useState('');
  const [seat_capacity, setCap] = useState('162');
  const [aircraft_type_id, setT] = useState('');
  const [seat_map_id, setS] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/aircraft-records', {
      method: 'POST',
      body: JSON.stringify({
        tail_number,
        model,
        seat_capacity: Number(seat_capacity),
        aircraft_type_id: aircraft_type_id || null,
        seat_map_id: seat_map_id || null
      })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Aircraft record created');
    onRefresh();
  }
  return (
    <div>
      <h2>Aircraft records</h2>
      {formGrid(
        submit,
        <>
          <input value={tail_number} onChange={(e) => setTail(e.target.value)} placeholder="Tail" required />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" required />
          <input value={seat_capacity} onChange={(e) => setCap(e.target.value)} type="number" />
          <select value={aircraft_type_id} onChange={(e) => setT(e.target.value)}>
            <option value="">Aircraft type</option>
            {aircraftTypes.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {String(t.code)}
              </option>
            ))}
          </select>
          <select value={seat_map_id} onChange={(e) => setS(e.target.value)}>
            <option value="">Seat map</option>
            {seatMaps.map((s) => (
              <option key={String(s.id)} value={String(s.id)}>
                {String(s.name)}
              </option>
            ))}
          </select>
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.tail_number)} — {String(r.model)} · map: {String(r.seat_map_name || '—')}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FareClassesPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [booking_class, setBc] = useState('ECONOMY');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/fare-classes', { method: 'POST', body: JSON.stringify({ code, name, booking_class }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Fare class created');
    onRefresh();
  }
  return (
    <div>
      <h2>Fare classes</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <input value={booking_class} onChange={(e) => setBc(e.target.value)} placeholder="Booking / cabin class" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} — {String(r.name)} ({String(r.booking_class)})
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteFaresPanel({
  rows,
  routes,
  fareClasses,
  currencies,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  routes: Row[];
  fareClasses: Row[];
  currencies: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [route_id, setR] = useState('');
  const [fare_class_id, setF] = useState('');
  const [amount, setAmt] = useState('');
  const [cur, setCur] = useState('USD');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/route-fares', {
      method: 'POST',
      body: JSON.stringify({ route_id, fare_class_id, amount: Number(amount), currency: cur })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Route fare created');
    onRefresh();
  }
  return (
    <div>
      <h2>Route fares</h2>
      {formGrid(
        submit,
        <>
          <select value={route_id} onChange={(e) => setR(e.target.value)} required>
            <option value="">Route</option>
            {routes.map((x) => (
              <option key={String(x.id)} value={String(x.id)}>
                {String(x.origin_iata)}→{String(x.dest_iata)}
              </option>
            ))}
          </select>
          <select value={fare_class_id} onChange={(e) => setF(e.target.value)} required>
            <option value="">Fare class</option>
            {fareClasses.map((x) => (
              <option key={String(x.id)} value={String(x.id)}>
                {String(x.code)}
              </option>
            ))}
          </select>
          <input value={amount} onChange={(e) => setAmt(e.target.value)} type="number" step="0.01" placeholder="Amount" required />
          <select value={cur} onChange={(e) => setCur(e.target.value)}>
            {currencies.map((c) => (
              <option key={String(c.id)} value={String(c.code)}>
                {String(c.code)}
              </option>
            ))}
            {!currencies.length && <option value="USD">USD</option>}
          </select>
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.route_label)} {String(r.fare_class_code)} {String(r.amount)} {String(r.currency)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TaxSettingsPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rate_percent, setRate] = useState('0');
  const [applies_to, setApplies] = useState('SUBTOTAL');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/tax-settings', {
      method: 'POST',
      body: JSON.stringify({ code, name, rate_percent: Number(rate_percent), applies_to })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Tax added');
    onRefresh();
  }
  return (
    <div>
      <h2>Tax settings</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <input value={rate_percent} onChange={(e) => setRate(e.target.value)} type="number" step="0.01" />
          <select value={applies_to} onChange={(e) => setApplies(e.target.value)}>
            <option value="SUBTOTAL">SUBTOTAL</option>
            <option value="TOTAL">TOTAL</option>
          </select>
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} {String(r.rate_percent)}% ({String(r.applies_to)})
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeeSettingsPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [amount_fixed, setFix] = useState('0');
  const [rate_percent, setRate] = useState('0');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/fee-settings', {
      method: 'POST',
      body: JSON.stringify({ code, name, amount_fixed: Number(amount_fixed), rate_percent: Number(rate_percent) })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Fee added');
    onRefresh();
  }
  return (
    <div>
      <h2>Fee settings</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
          <input value={amount_fixed} onChange={(e) => setFix(e.target.value)} type="number" step="0.01" placeholder="Fixed" />
          <input value={rate_percent} onChange={(e) => setRate(e.target.value)} type="number" step="0.01" placeholder="% of subtotal" />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} fixed {String(r.amount_fixed)} + {String(r.rate_percent)}%
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentMethodsPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/payment-methods', { method: 'POST', body: JSON.stringify({ code, name }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('OK');
    onRefresh();
  }
  return (
    <div>
      <h2>Payment methods</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} — {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BaggageRulesPanel({
  rows,
  routes,
  fareClasses,
  onRefresh,
  onDelete
}: {
  rows: Row[];
  routes: Row[];
  fareClasses: Row[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
}) {
  const [route_id, setR] = useState('');
  const [fare_class_id, setF] = useState('');
  const [free_pieces, setFp] = useState('1');
  const [free_weight_kg, setFw] = useState('23');
  const [max_weight_per_piece_kg, setMx] = useState('32');
  const [charge_per_kg_over, setCh] = useState('15');
  const [currency, setCur] = useState('USD');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/baggage-rules', {
      method: 'POST',
      body: JSON.stringify({
        route_id: route_id || null,
        fare_class_id: fare_class_id || null,
        free_pieces: Number(free_pieces),
        free_weight_kg: Number(free_weight_kg),
        max_weight_per_piece_kg: Number(max_weight_per_piece_kg),
        charge_per_kg_over: Number(charge_per_kg_over),
        currency
      })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Rule created');
    onRefresh();
  }
  return (
    <div>
      <h2>Baggage rules</h2>
      {formGrid(
        submit,
        <>
          <select value={route_id} onChange={(e) => setR(e.target.value)}>
            <option value="">All routes (global)</option>
            {routes.map((x) => (
              <option key={String(x.id)} value={String(x.id)}>
                {String(x.origin_iata)}→{String(x.dest_iata)}
              </option>
            ))}
          </select>
          <select value={fare_class_id} onChange={(e) => setF(e.target.value)}>
            <option value="">Any fare class</option>
            {fareClasses.map((x) => (
              <option key={String(x.id)} value={String(x.id)}>
                {String(x.code)}
              </option>
            ))}
          </select>
          <input value={free_pieces} onChange={(e) => setFp(e.target.value)} type="number" />
          <input value={free_weight_kg} onChange={(e) => setFw(e.target.value)} type="number" />
          <input value={max_weight_per_piece_kg} onChange={(e) => setMx(e.target.value)} type="number" />
          <input value={charge_per_kg_over} onChange={(e) => setCh(e.target.value)} type="number" />
          <input value={currency} onChange={(e) => setCur(e.target.value)} placeholder="Currency" maxLength={3} />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.route_label || 'GLOBAL')} · free {String(r.free_pieces)}pc / {String(r.free_weight_kg)}kg
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepartmentsPanel({ rows, onRefresh, onDelete }: { rows: Row[]; onRefresh: () => void; onDelete: (id: string) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch('/departments', { method: 'POST', body: JSON.stringify({ code, name }) });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('OK');
    onRefresh();
  }
  return (
    <div>
      <h2>Departments</h2>
      {formGrid(
        submit,
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" required />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.id)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.code)} — {String(r.name)}
            </span>
            <button type="button" className="secondary" onClick={() => onDelete(String(r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleDefsPanel({ rows, onRefresh }: { rows: Row[]; onRefresh: () => void }) {
  const [roleKey, setRoleKey] = useState('agent');
  const [display_name, setDn] = useState('');
  const [description, setDesc] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch(`/role-definitions/${encodeURIComponent(roleKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ display_name, description })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Role definition saved');
    onRefresh();
  }
  return (
    <div>
      <h2>User roles (metadata)</h2>
      <p style={{ margin: 0, color: '#64748b', fontSize: '0.88rem' }}>Upsert by role key (must match application enum).</p>
      {formGrid(
        submit,
        <>
          <input value={roleKey} onChange={(e) => setRoleKey(e.target.value)} placeholder="role_key e.g. admin" />
          <input value={display_name} onChange={(e) => setDn(e.target.value)} placeholder="Display name" required />
          <input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="Description" style={{ gridColumn: '1 / -1' }} />
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.role_key)} style={{ padding: '4px 0' }}>
            <strong>{String(r.role_key)}</strong> — {String(r.display_name || '')}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SysPrefsPanel({ rows, onRefresh }: { rows: Row[]; onRefresh: () => void }) {
  const [pref_key, setK] = useState('');
  const [pref_value, setV] = useState('');
  const [value_type, setVt] = useState('STRING');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await mdFetch(`/system-preferences/${encodeURIComponent(pref_key)}`, {
      method: 'PUT',
      body: JSON.stringify({ pref_value, value_type })
    });
    const j = await r.json();
    if (!r.ok) return toast.error(j.message || 'Failed');
    toast.success('Preference saved');
    setK('');
    setV('');
    onRefresh();
  }
  async function removeKey(key: string) {
    if (!confirm('Remove preference?')) return;
    const r = await mdFetch(`/system-preferences/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (r.status === 204) {
      toast.success('Removed');
      onRefresh();
    } else {
      const j = await r.json();
      toast.error(j.message || 'Failed');
    }
  }
  return (
    <div>
      <h2>System preferences</h2>
      {formGrid(
        submit,
        <>
          <input value={pref_key} onChange={(e) => setK(e.target.value)} placeholder="pref_key" required />
          <input value={pref_value} onChange={(e) => setV(e.target.value)} placeholder="pref_value" required />
          <select value={value_type} onChange={(e) => setVt(e.target.value)}>
            <option value="STRING">STRING</option>
            <option value="NUMBER">NUMBER</option>
            <option value="BOOLEAN">BOOLEAN</option>
          </select>
        </>
      )}
      <ul style={{ margin: '0.75rem 0 0', padding: 0, listStyle: 'none', fontSize: '0.85rem' }}>
        {rows.map((r) => (
          <li key={String(r.pref_key)} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <span>
              {String(r.pref_key)} = {String(r.pref_value)} ({String(r.value_type)})
            </span>
            <button type="button" className="secondary" onClick={() => removeKey(String(r.pref_key))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
