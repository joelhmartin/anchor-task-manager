import { useEffect, useMemo, useState } from 'react';
import client from 'api/client';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import SelectField from 'ui-component/extended/SelectField';

/**
 * AiAudiencePicker — selects the audience for a report run.
 *
 * Props:
 *   value    – { mode: 'all'|'package'|'manual', client_package?, client_ids?, include_inactive? }
 *   onChange – fn(newValue)
 */
export default function AiAudiencePicker({ value = { mode: 'all' }, onChange }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .get('/hub/clients', { params: { role: 'client' } })
      .then((res) => {
        const list = res.data.clients || res.data || [];
        if (!cancelled) setClients(Array.isArray(list) ? list.filter((c) => c.role === 'client') : []);
      })
      .catch(() => {
        if (!cancelled) setClients([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const packageOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const c of clients) {
      if (c.client_package && !seen.has(c.client_package)) {
        seen.add(c.client_package);
        opts.push({ value: c.client_package, label: c.client_package });
      }
    }
    return opts;
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c) =>
        (c.client_label || '').toLowerCase().includes(q) ||
        (c.client_identifier_value || '').toLowerCase().includes(q) ||
        (c.business_name || '').toLowerCase().includes(q) ||
        (c.first_name || '').toLowerCase().includes(q) ||
        (c.last_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const handleMode = (e) => {
    const mode = e.target.value;
    onChange({ ...value, mode, client_ids: [], client_package: undefined });
  };

  const handlePackage = (e) => {
    onChange({ ...value, client_package: e.target.value });
  };

  const handleToggleClient = (clientId) => {
    const ids = value.client_ids || [];
    const next = ids.includes(clientId)
      ? ids.filter((id) => id !== clientId)
      : [...ids, clientId];
    onChange({ ...value, client_ids: next });
  };

  const handleSelectFiltered = () => {
    const ids = new Set(value.client_ids || []);
    for (const c of filteredClients) ids.add(c.id);
    onChange({ ...value, client_ids: Array.from(ids) });
  };

  const handleClearFiltered = () => {
    const filteredIds = new Set(filteredClients.map((c) => c.id));
    onChange({ ...value, client_ids: (value.client_ids || []).filter((id) => !filteredIds.has(id)) });
  };

  const selectedIds = value.client_ids || [];

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Audience
      </Typography>

      <RadioGroup value={value.mode || 'all'} onChange={handleMode}>
        <FormControlLabel value="all" control={<Radio size="small" />} label="All active clients" />
        <FormControlLabel value="package" control={<Radio size="small" />} label="By package" />
        <FormControlLabel value="manual" control={<Radio size="small" />} label="Select clients manually" />
      </RadioGroup>

      {value.mode === 'package' && (
        <Box sx={{ mt: 1 }}>
          {loading ? (
            <CircularProgress size={20} />
          ) : (
            <SelectField
              label="Package"
              value={value.client_package || ''}
              onChange={handlePackage}
              options={packageOptions}
              size="small"
            />
          )}
        </Box>
      )}

      {value.mode === 'manual' && (
        <Box sx={{ mt: 1 }}>
          <TextField
            size="small"
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            sx={{ mb: 1 }}
          />
          {loading ? (
            <CircularProgress size={20} />
          ) : (
            <>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Button size="small" variant="outlined" onClick={handleSelectFiltered} disabled={!filteredClients.length}>
                  Select filtered
                </Button>
                <Button size="small" variant="text" onClick={handleClearFiltered} disabled={!selectedIds.length}>
                  Clear filtered
                </Button>
              </Stack>
              <List
                dense
                sx={{
                  maxHeight: 260,
                  overflowY: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1
                }}
              >
                {filteredClients.map((c) => {
                  const checked = selectedIds.includes(c.id);
                  const label =
                    c.client_label ||
                    c.client_identifier_value ||
                    c.business_name ||
                    [c.first_name, c.last_name].filter(Boolean).join(' ') ||
                    c.email ||
                    c.id;
                  return (
                    <ListItem key={c.id} disablePadding>
                      <ListItemButton dense onClick={() => handleToggleClient(c.id)}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox
                            edge="start"
                            checked={checked}
                            tabIndex={-1}
                            disableRipple
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={label}
                          secondary={
                            c.client_package ? (
                              <Chip label={c.client_package} size="small" sx={{ height: 18, fontSize: 11 }} />
                            ) : null
                          }
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
                {filteredClients.length === 0 && (
                  <ListItem>
                    <ListItemText primary="No clients found" />
                  </ListItem>
                )}
              </List>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Selected: {selectedIds.length}
              </Typography>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
