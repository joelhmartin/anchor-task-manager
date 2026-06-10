import { useCallback, useState } from 'react';
import SelectField from 'ui-component/extended/SelectField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import FormGroup from '@mui/material/FormGroup';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

/**
 * Renders a single field based on its type
 */
function QuestionnaireField({ field, value, onChange, allValues }) {
  // Handle conditional visibility
  if (field.conditional) {
    const { field: condField, equals, includes } = field.conditional;
    const condValue = allValues[condField];

    if (equals && condValue !== equals) return null;
    if (includes) {
      const arr = Array.isArray(condValue) ? condValue : [];
      if (!arr.includes(includes)) return null;
    }
  }

  const handleChange = (newValue) => {
    onChange(field.id, newValue);
  };

  switch (field.type) {
    case 'text':
      return (
        <TextField
          fullWidth
          label={field.label}
          value={value || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.placeholder}
          size="small"
        />
      );

    case 'textarea':
      return (
        <TextField
          fullWidth
          multiline
          rows={3}
          label={field.label}
          value={value || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.placeholder}
          size="small"
        />
      );

    case 'select':
      return (
        <SelectField label={field.label} value={value || ''} onChange={(e) => handleChange(e.target.value)} size="small">
          <MenuItem value="">
            <em>Select...</em>
          </MenuItem>
          {field.options.map((opt) => (
            <MenuItem key={opt} value={opt}>
              {opt}
            </MenuItem>
          ))}
        </SelectField>
      );

    case 'multiselect':
      const selectedValues = Array.isArray(value) ? value : [];
      return (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {field.label}
          </Typography>
          <FormGroup row>
            {field.options.map((opt) => (
              <FormControlLabel
                key={opt}
                control={
                  <Checkbox
                    checked={selectedValues.includes(opt)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleChange([...selectedValues, opt]);
                      } else {
                        handleChange(selectedValues.filter((v) => v !== opt));
                      }
                    }}
                    size="small"
                  />
                }
                label={opt}
              />
            ))}
          </FormGroup>
          {selectedValues.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              {selectedValues.map((v) => (
                <Chip
                  key={v}
                  label={v}
                  size="small"
                  onDelete={() => handleChange(selectedValues.filter((x) => x !== v))}
                />
              ))}
            </Stack>
          )}
        </Box>
      );

    default:
      return (
        <TextField
          fullWidth
          label={field.label}
          value={value || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.placeholder}
          size="small"
        />
      );
  }
}

/**
 * Renders a section of the questionnaire
 */
function QuestionnaireSection({ section, values, onChange, expanded, onToggle }) {
  const completedCount = section.fields.filter((f) => {
    const val = values[f.id];
    if (Array.isArray(val)) return val.length > 0;
    return val && String(val).trim().length > 0;
  }).length;

  const totalCount = section.fields.length;
  const isComplete = completedCount === totalCount;

  return (
    <Accordion expanded={expanded} onChange={onToggle}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            {section.title}
          </Typography>
          <Chip
            label={`${completedCount}/${totalCount}`}
            size="small"
            color={isComplete ? 'success' : 'default'}
            variant={isComplete ? 'filled' : 'outlined'}
          />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2.5}>
          {section.fields.map((field) => (
            <QuestionnaireField key={field.id} field={field} value={values[field.id]} onChange={onChange} allValues={values} />
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

/**
 * Type-Specific Questionnaire Component
 *
 * Renders the additional questionnaire for a specific client type/subtype.
 * Used in the onboarding flow after the standard steps.
 */
export default function TypeSpecificQuestionnaire({ template, values, onChange }) {
  const [expandedSection, setExpandedSection] = useState(template?.sections?.[0]?.id || null);

  const handleFieldChange = useCallback(
    (fieldId, fieldValue) => {
      onChange({
        ...values,
        [fieldId]: fieldValue
      });
    },
    [values, onChange]
  );

  const handleAccordionToggle = (sectionId) => (_event, isExpanded) => {
    setExpandedSection(isExpanded ? sectionId : null);
  };

  if (!template) {
    return null;
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" gutterBottom>
          {template.title}
        </Typography>
        {template.subtitle && (
          <Typography variant="body2" color="text.secondary">
            {template.subtitle}
          </Typography>
        )}
      </Box>

      <Stack spacing={1}>
        {template.sections.map((section) => (
          <QuestionnaireSection
            key={section.id}
            section={section}
            values={values}
            onChange={handleFieldChange}
            expanded={expandedSection === section.id}
            onToggle={handleAccordionToggle(section.id)}
          />
        ))}
      </Stack>
    </Box>
  );
}
