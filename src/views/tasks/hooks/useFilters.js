import { useState, useMemo, useCallback } from 'react';

const EMPTY_FILTERS = {
  status: [],           // multi-select status labels
  labels: [],           // multi-select label IDs
  assignees: [],        // multi-select user IDs
  due_date: '',         // 'overdue' | 'today' | 'this_week' | 'next_week' | 'no_date' | ''
  needs_attention: '',  // 'yes' | 'no' | ''
  groups: [],           // multi-select group IDs
};

export default function useFilters({ items = [], itemLabelsMap = {} }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('');        // column key
  const [sortDir, setSortDir] = useState('asc');   // 'asc' | 'desc'

  const hasActiveFilters = useMemo(() => {
    return filters.status.length > 0 || filters.labels.length > 0 ||
      filters.assignees.length > 0 || filters.due_date !== '' ||
      filters.needs_attention !== '' || filters.groups.length > 0;
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.status.length > 0) count++;
    if (filters.labels.length > 0) count++;
    if (filters.assignees.length > 0) count++;
    if (filters.due_date) count++;
    if (filters.needs_attention) count++;
    if (filters.groups.length > 0) count++;
    return count;
  }, [filters]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (filters.status.length > 0) {
      result = result.filter(item => filters.status.includes(item.status));
    }

    if (filters.labels.length > 0) {
      result = result.filter(item => {
        const itemLbls = (itemLabelsMap[item.id] || []).map(l => l.id);
        return filters.labels.some(lid => itemLbls.includes(lid));
      });
    }

    if (filters.assignees.length > 0) {
      result = result.filter(item => {
        const itemAssignees = (item.assignees || []).map(a => a.user_id || a.id);
        return filters.assignees.some(uid => itemAssignees.includes(uid));
      });
    }

    if (filters.due_date) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfWeek = new Date(today);
      endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
      const endOfNextWeek = new Date(endOfWeek);
      endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

      result = result.filter(item => {
        const due = item.due_date ? new Date(item.due_date) : null;
        switch (filters.due_date) {
          case 'overdue': return due && due < today;
          case 'today': return due && due.toDateString() === today.toDateString();
          case 'this_week': return due && due >= today && due <= endOfWeek;
          case 'next_week': return due && due > endOfWeek && due <= endOfNextWeek;
          case 'no_date': return !due;
          default: return true;
        }
      });
    }

    if (filters.needs_attention === 'yes') {
      result = result.filter(item => item.needs_attention);
    } else if (filters.needs_attention === 'no') {
      result = result.filter(item => !item.needs_attention);
    }

    if (filters.groups.length > 0) {
      result = result.filter(item => filters.groups.includes(item.group_id));
    }

    return result;
  }, [items, filters, itemLabelsMap]);

  const sortedItems = useMemo(() => {
    if (!sortBy) return filteredItems;
    const sorted = [...filteredItems].sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); break;
        case 'status': va = a.status || ''; vb = b.status || ''; break;
        case 'due_date': va = a.due_date || '9999'; vb = b.due_date || '9999'; break;
        case 'assignees': va = (a.assignee_count || 0); vb = (b.assignee_count || 0); break;
        case 'updates': va = (a.update_count || 0); vb = (b.update_count || 0); break;
        case 'time': va = (a.time_total || 0); vb = (b.time_total || 0); break;
        default: return 0;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredItems, sortBy, sortDir]);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  const toggleSort = useCallback((column) => {
    if (sortBy === column) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  }, [sortBy]);

  const clearSort = useCallback(() => {
    setSortBy('');
    setSortDir('asc');
  }, []);

  return {
    filters, updateFilter, clearFilters, hasActiveFilters, activeFilterCount,
    sortBy, sortDir, toggleSort, clearSort,
    filteredItems: sortedItems
  };
}
