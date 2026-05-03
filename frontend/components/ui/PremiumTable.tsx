'use client';

import { useMemo, useState } from 'react';

type Row = Record<string, string | number | null | undefined>;

type Props = {
  title: string;
  columns: string[];
  rows: Row[];
};

const PAGE_SIZE = 6;

export default function PremiumTable({ title, columns, rows }: Props) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState(columns[0]);
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return rows
      .filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const av = String(a[sortBy] ?? '');
        const bv = String(b[sortBy] ?? '');
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [rows, query, sortBy, ascending]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const exportCsv = () => {
    const csv = [columns.join(','), ...filtered.map((r) => columns.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.toLowerCase().replace(/\s+/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => window.print();

  return (
    <section className="glass-card">
      <div className="table-toolbar">
        <h3>{title}</h3>
        <div className="table-actions">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="glass-input" />
          <button className="glass-btn" onClick={exportCsv}>Export Excel</button>
          <button className="glass-btn" onClick={exportPdf}>Export PDF</button>
        </div>
      </div>

      <div className="premium-table-wrap">
        <table className="premium-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  onClick={() => {
                    if (sortBy === col) setAscending((v) => !v);
                    else setSortBy(col);
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((row, idx) => (
              <tr key={`${idx}-${String(row[columns[0]])}`}>
                {columns.map((col) => (
                  <td key={col}>{String(row[col] ?? '-')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination-row">
        <button className="glass-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span>
          Page {page} / {pages}
        </span>
        <button className="glass-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </section>
  );
}
