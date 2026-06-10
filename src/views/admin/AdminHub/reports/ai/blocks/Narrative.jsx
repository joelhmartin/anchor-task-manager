import { Typography, Box } from '@mui/material';

// Tiny markdown subset (paragraphs, **bold**, *italic*, single-line bullets).
// Enough for AI narrative blocks; no need to pull a full markdown lib.
function renderMarkdown(md) {
  const lines = (md || '').split(/\n+/);
  return lines.map((line, i) => {
    if (line.startsWith('- ')) {
      return <Typography key={i} component="li" sx={{ ml: 2 }}>{inline(line.slice(2))}</Typography>;
    }
    return <Typography key={i} paragraph>{inline(line)}</Typography>;
  });
}

function inline(s) {
  const parts = [];
  let rest = s;
  while (rest.length) {
    const m = rest.match(/\*\*(.+?)\*\*|\*(.+?)\*/);
    if (!m) { parts.push(rest); break; }
    parts.push(rest.slice(0, m.index));
    parts.push(m[1] ? <strong key={parts.length}>{m[1]}</strong> : <em key={parts.length}>{m[2]}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return parts;
}

export default function Narrative({ markdown }) {
  return <Box sx={{ mt: 2 }}>{renderMarkdown(markdown)}</Box>;
}
