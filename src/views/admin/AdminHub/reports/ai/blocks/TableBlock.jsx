import { Table, TableHead, TableBody, TableRow, TableCell, Typography, Box, TableContainer } from '@mui/material';

export default function TableBlock({ title, columns = [], rows = [], empty_message }) {
  return (
    <Box sx={{ mt: 2 }}>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      {!rows.length ? (
        <Typography color="text.secondary">{empty_message || 'No rows are available for this section.'}</Typography>
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>{columns.map((c) => <TableCell key={c}>{c}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>{r.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
