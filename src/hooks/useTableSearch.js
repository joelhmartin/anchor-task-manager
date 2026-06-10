import { useMemo, useState } from 'react';

// Simple, reusable search for tables (case-insensitive substring search across fields).
// fields can be:
// - array of string keys
// - or array of getter functions (row) => string
export default function useTableSearch(rows = [], fields = []) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = Array.isArray(rows) ? rows : [];
    const q = String(query || '').trim().toLowerCase();
    if (!q) return list;

    const getters = (fields || []).map((f) => {
      if (typeof f === 'function') return f;
      return (row) => row?.[f];
    });

    return list.filter((row) => {
      for (const g of getters) {
        const v = g(row);
        if (v === null || v === undefined) continue;
        const s = String(v).toLowerCase();
        if (s.includes(q)) return true;
      }
      return false;
    });
  }, [rows, fields, query]);

  return { query, setQuery, filtered };
}


