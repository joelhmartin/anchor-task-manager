# Feature: BoardTable Virtualization (TM-013)

## Problem

BoardTable.jsx renders every item row with 6 heavy MUI components (TextField, Select with 10+ MenuItems, Avatar group, DateInput, 2 Buttons). With 100+ items, this causes:

- **Slow initial render**: 600+ component instances mounted simultaneously
- **Scroll jank**: Every re-render touches all rows
- **Memory bloat**: Each Select pre-renders all MenuItem children
- **No lazy loading**: Heavy components (Select dropdowns, date pickers) mount even when off-screen

### Current Rendering

```
BoardTable.jsx (867 lines)
├── CSS Grid layout: gridTemplateColumns = '2fr 150px 120px 100px 80px 80px'
├── Per group:
│   ├── Group header (collapsible)
│   └── items.map() → Per row:
│       ├── TextField (name) — inline editable
│       ├── Select + MenuItems × N (status) — full dropdown rendered
│       ├── Avatar group (assignees) — network requests for images
│       ├── TextField type=date (due date)
│       ├── Button (updates count badge)
│       └── Button (time total)
└── No virtualization, no React.memo, no lazy mounting
```

## Solution

Replace the direct `.map()` rendering with virtualized rows using `@tanstack/react-virtual`. Only render rows visible in the viewport plus a small overscan buffer. Lazy-mount heavy components (Select, DateInput) only when the row is visible.

### Why @tanstack/react-virtual (not react-virtuoso)

| Factor | @tanstack/react-virtual | react-virtuoso |
|--------|------------------------|----------------|
| Bundle size | ~5KB | ~30KB |
| API style | Headless (hooks) | Component-based |
| CSS Grid compat | Full (you control rendering) | Requires custom renderer |
| Variable row heights | Supported | Supported |
| Grouped sections | Manual but flexible | Built-in but opinionated |

Since BoardTable uses CSS Grid (not MUI Table), a headless approach gives full control over the grid layout.

## Prerequisites

- **TM-009**: TaskManager decomposition (BoardTable receives cleaner props from hooks)

---

## Data Model

No database changes. Frontend-only.

---

## Implementation

### 1. Install dependency

```bash
yarn add @tanstack/react-virtual
```

### 2. Virtualized Row Rendering

Replace the current `.map()` pattern with a virtualizer:

```jsx
import { useVirtualizer } from '@tanstack/react-virtual';

function BoardTable({ items, groups, statusLabels, onItemClick, ... }) {
  const parentRef = useRef(null);

  // Flatten groups + items into a single list for virtualization
  // Each entry is either { type: 'group-header', group } or { type: 'item', item }
  const flatList = useMemo(() => {
    const list = [];
    for (const group of groups) {
      list.push({ type: 'group-header', group, key: `gh-${group.id}` });
      if (!collapsedGroups[group.id]) {
        const groupItems = items.filter(i => i.group_id === group.id);
        for (const item of groupItems) {
          list.push({ type: 'item', item, key: item.id });
        }
      }
    }
    return list;
  }, [groups, items, collapsedGroups]);

  const virtualizer = useVirtualizer({
    count: flatList.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => flatList[index].type === 'group-header' ? 48 : 44,
    overscan: 10,  // render 10 rows above/below viewport
  });

  return (
    <Box ref={parentRef} sx={{ height: '100%', overflow: 'auto' }}>
      <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const entry = flatList[virtualRow.index];
          return (
            <Box
              key={entry.key}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {entry.type === 'group-header'
                ? <GroupHeader group={entry.group} />
                : <ItemRow item={entry.item} statusLabels={statusLabels} />
              }
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
```

### 3. Memoized ItemRow

Wrap each row in `React.memo` to prevent re-renders when other rows change:

```jsx
const ItemRow = React.memo(function ItemRow({ item, statusLabels, onItemClick, onStatusChange, ... }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns, alignItems: 'center', px: 1 }}>
      <ItemNameCell item={item} />
      <StatusCell item={item} statusLabels={statusLabels} onChange={onStatusChange} />
      <AssigneeCell item={item} />
      <DueDateCell item={item} />
      <UpdatesCountCell item={item} onClick={() => onItemClick(item)} />
      <TimeCell item={item} />
    </Box>
  );
}, (prev, next) => {
  // Custom comparison: only re-render if item data actually changed
  return prev.item === next.item && prev.statusLabels === next.statusLabels;
});
```

### 4. Lazy-Mount Heavy Components

The Select dropdown (status picker) renders all MenuItems eagerly. Defer rendering until interaction:

```jsx
function StatusCell({ item, statusLabels, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <Box onClick={() => setOpen(true)} sx={{ cursor: 'pointer' }}>
      {/* Always show: lightweight chip with status color */}
      <StatusChip status={item.status} />

      {/* Only mount Select when user clicks to open */}
      {open && (
        <Select
          open
          value={item.status}
          onClose={() => setOpen(false)}
          onChange={(e) => { onChange(item.id, e.target.value); setOpen(false); }}
          sx={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          MenuProps={{ anchorOrigin: { vertical: 'bottom', horizontal: 'left' } }}
        >
          {statusLabels.map(s => (
            <MenuItem key={s.label} value={s.label}>{s.label}</MenuItem>
          ))}
        </Select>
      )}
    </Box>
  );
}
```

This saves mounting `N × M` MenuItem components (N items × M status labels) upfront.

### 5. Assignee Avatar Optimization

Use `loading="lazy"` on Avatar images and limit visible avatars:

```jsx
function AssigneeCell({ item }) {
  const assignees = item.assignees || [];
  const visible = assignees.slice(0, 3);
  const overflow = assignees.length - 3;

  return (
    <AvatarGroup max={3} sx={{ '& .MuiAvatar-root': { width: 24, height: 24 } }}>
      {visible.map(a => (
        <Avatar key={a.user_id} alt={a.name} src={a.avatar} imgProps={{ loading: 'lazy' }} />
      ))}
      {overflow > 0 && <Avatar>+{overflow}</Avatar>}
    </AvatarGroup>
  );
}
```

---

## Performance Targets

| Metric | Before | After |
|--------|--------|-------|
| Initial render (100 items) | ~800ms | ~50ms |
| Initial render (500 items) | ~4000ms | ~50ms |
| Scroll FPS | <30fps at 100+ items | 60fps |
| Memory (100 items) | All 600 components | ~60 components (viewport + overscan) |
| DOM nodes (100 items) | ~3000 | ~300 |

---

## Scroll Container

The virtualizer needs a fixed-height scroll container. Currently BoardTable is inside the pane content area which has `overflow: auto`. The parent container must provide a measurable height:

```jsx
// In the pane content area that wraps BoardTable
<Box sx={{ flex: 1, overflow: 'hidden' }}>
  <BoardTable {...props} />
</Box>
```

BoardTable internally sets `height: '100%', overflow: 'auto'` on its scroll container ref.

---

## Group Collapse Behavior

When a group is collapsed, its items are excluded from `flatList`. The virtualizer automatically adjusts. No special handling needed.

When a group is expanded, items are added to `flatList` and the virtualizer recalculates positions.

---

## Sticky Group Headers

Group headers should stick to the top of the scroll container as the user scrolls past them. With the virtualizer:

```jsx
{entry.type === 'group-header' && (
  <Box sx={{
    position: 'sticky',
    top: 0,
    zIndex: 1,
    bgcolor: 'background.paper',
  }}>
    <GroupHeader group={entry.group} />
  </Box>
)}
```

Note: Sticky headers within a virtualized list require `position: 'sticky'` to override the absolute positioning. Test carefully — may need to adjust the virtualizer's `measureElement` callback.

---

## Validation

1. `yarn build` — passes
2. Board with 10 items → renders correctly, all interactions work
3. Board with 200+ items → verify smooth scrolling (60fps target)
4. Board with 500 items → verify initial render under 100ms
5. Click status → verify Select dropdown opens correctly
6. Collapse/expand groups → verify rows update correctly
7. Drag-drop between groups → verify works with virtual rows (if drag-drop exists)
8. Keyboard navigation → verify arrow keys scroll and focus correctly
9. Search/filter items → verify virtual list updates
10. Browser DevTools Performance tab → verify no layout thrashing during scroll

## Files Affected

### New Dependencies
- `@tanstack/react-virtual` (~5KB)

### Modified Files
- `src/views/tasks/components/BoardTable.jsx` — major refactor to virtualized rendering
- `package.json` — add `@tanstack/react-virtual`
- `yarn.lock` — updated
