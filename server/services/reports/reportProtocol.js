import { createHash } from 'node:crypto';

export const REPORT_OUTPUT_SCHEMA_VERSION = 2;

const TYPE = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT'
};

export const REPORT_OUTPUT_SCHEMA = {
  type: TYPE.OBJECT,
  required: ['title', 'sections'],
  propertyOrdering: ['title', 'summary', 'sections'],
  properties: {
    title: {
      type: TYPE.STRING,
      description: 'Client-facing report title.'
    },
    summary: {
      type: TYPE.STRING,
      description: 'Short executive summary. Use only facts from the provided data package.'
    },
    sections: {
      type: TYPE.ARRAY,
      items: {
        type: TYPE.OBJECT,
        required: ['type'],
        propertyOrdering: [
          'type',
          'title',
          'items',
          'chart_type',
          'data_key',
          'x_key',
          'series',
          'columns',
          'max_rows',
          'markdown',
          'source_keys',
          'tone',
          'body',
          'empty_message'
        ],
        properties: {
          type: {
            type: TYPE.STRING,
            enum: ['kpi_grid', 'chart', 'narrative', 'table', 'callout']
          },
          title: { type: TYPE.STRING },
          items: {
            type: TYPE.ARRAY,
            items: {
              type: TYPE.OBJECT,
              required: ['label', 'metric_key'],
              propertyOrdering: ['label', 'metric_key', 'value_format', 'delta_key', 'delta_format', 'direction'],
              properties: {
                label: { type: TYPE.STRING },
                metric_key: {
                  type: TYPE.STRING,
                  description: 'Dot path to a scalar in the data package. Do not return the metric value.'
                },
                value_format: {
                  type: TYPE.STRING,
                  enum: ['number', 'integer', 'decimal', 'currency', 'percent', 'rating', 'text']
                },
                delta_key: {
                  type: TYPE.STRING,
                  description: 'Optional dot path to a scalar comparison or delta metric.'
                },
                delta_format: {
                  type: TYPE.STRING,
                  enum: ['number', 'integer', 'decimal', 'currency', 'percent', 'rating', 'text']
                },
                direction: {
                  type: TYPE.STRING,
                  enum: ['up', 'down', 'flat']
                }
              }
            }
          },
          chart_type: {
            type: TYPE.STRING,
            enum: ['bar', 'line', 'donut', 'area']
          },
          data_key: {
            type: TYPE.STRING,
            description: 'Dot path to an array in the data package.'
          },
          x_key: {
            type: TYPE.STRING,
            description: 'Field name inside each data row for the x-axis or donut labels.'
          },
          series: {
            type: TYPE.ARRAY,
            items: {
              type: TYPE.OBJECT,
              required: ['key', 'label'],
              propertyOrdering: ['key', 'label', 'value_format'],
              properties: {
                key: { type: TYPE.STRING },
                label: { type: TYPE.STRING },
                value_format: {
                  type: TYPE.STRING,
                  enum: ['number', 'integer', 'decimal', 'currency', 'percent', 'rating', 'text']
                }
              }
            }
          },
          columns: {
            type: TYPE.ARRAY,
            items: {
              type: TYPE.OBJECT,
              required: ['key', 'label'],
              propertyOrdering: ['key', 'label', 'format'],
              properties: {
                key: { type: TYPE.STRING },
                label: { type: TYPE.STRING },
                format: {
                  type: TYPE.STRING,
                  enum: ['number', 'integer', 'decimal', 'currency', 'percent', 'rating', 'text', 'date']
                }
              }
            }
          },
          max_rows: {
            type: TYPE.INTEGER
          },
          markdown: {
            type: TYPE.STRING,
            description: 'Markdown narrative. Every factual claim must come from source_keys.'
          },
          source_keys: {
            type: TYPE.ARRAY,
            items: { type: TYPE.STRING },
            description: 'Dot paths used to support narrative or callout claims.'
          },
          tone: {
            type: TYPE.STRING,
            enum: ['info', 'success', 'warning']
          },
          body: {
            type: TYPE.STRING
          },
          empty_message: {
            type: TYPE.STRING,
            description: 'Fallback text when the referenced data array is empty.'
          }
        }
      }
    }
  }
};

export class ReportGenerationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ReportGenerationError';
    this.details = details || null;
  }
}

const VALID_SECTION_TYPES = new Set(['kpi_grid', 'chart', 'narrative', 'table', 'callout']);
const VALID_CHART_TYPES = new Set(['bar', 'line', 'donut', 'area']);
const VALID_CALLOUT_TONES = new Set(['info', 'success', 'warning']);
const VALID_FORMATS = new Set(['number', 'integer', 'decimal', 'currency', 'percent', 'rating', 'text', 'date']);

export function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256Json(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function resolveDataKey(pkg, key) {
  if (!pkg || typeof key !== 'string' || !key.trim()) return undefined;
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), pkg);
}

function isScalar(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function pathExists(pkg, key) {
  return resolveDataKey(pkg, key) !== undefined;
}

function sampleObject(arr) {
  return Array.isArray(arr) ? arr.find((row) => row && typeof row === 'object' && !Array.isArray(row)) : null;
}

function hasField(row, key) {
  return !!row && Object.prototype.hasOwnProperty.call(row, key);
}

function pushPathError(errors, index, path, message) {
  errors.push(`sections[${index}].${path}: ${message}`);
}

export function validateReportOutput(output, dataPackage) {
  const errors = [];
  const warnings = [];

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new ReportGenerationError('Report output must be an object');
  }
  if (!output.title || typeof output.title !== 'string' || output.title.trim() === '') {
    errors.push('title is required');
  }
  if (!Array.isArray(output.sections) || output.sections.length === 0) {
    errors.push('sections must be a non-empty array');
  } else if (output.sections.length > 12) {
    errors.push('sections must contain 12 or fewer items');
  }

  const sections = Array.isArray(output.sections) ? output.sections : [];
  sections.forEach((section, index) => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      errors.push(`sections[${index}] must be an object`);
      return;
    }

    if (!VALID_SECTION_TYPES.has(section.type)) {
      pushPathError(errors, index, 'type', `must be one of ${Array.from(VALID_SECTION_TYPES).join(', ')}`);
      return;
    }

    if (section.title != null && typeof section.title !== 'string') {
      pushPathError(errors, index, 'title', 'must be a string when provided');
    }

    if (section.type === 'kpi_grid') {
      if (!Array.isArray(section.items) || section.items.length === 0) {
        pushPathError(errors, index, 'items', 'must contain at least one KPI item');
      } else {
        section.items.forEach((item, itemIndex) => {
          if (!item?.label || typeof item.label !== 'string') {
            pushPathError(errors, index, `items[${itemIndex}].label`, 'is required');
          }
          if (!item?.metric_key || typeof item.metric_key !== 'string') {
            pushPathError(errors, index, `items[${itemIndex}].metric_key`, 'is required');
          } else {
            const value = resolveDataKey(dataPackage, item.metric_key);
            if (value === undefined) {
              pushPathError(errors, index, `items[${itemIndex}].metric_key`, `data key "${item.metric_key}" was not found`);
            } else if (!isScalar(value)) {
              pushPathError(errors, index, `items[${itemIndex}].metric_key`, 'must resolve to a scalar value');
            }
          }
          if (item.delta_key && !pathExists(dataPackage, item.delta_key)) {
            warnings.push(`sections[${index}].items[${itemIndex}].delta_key "${item.delta_key}" was not found`);
          }
          if (item.value_format && !VALID_FORMATS.has(item.value_format)) {
            pushPathError(errors, index, `items[${itemIndex}].value_format`, 'is invalid');
          }
        });
      }
    }

    if (section.type === 'chart') {
      if (!VALID_CHART_TYPES.has(section.chart_type)) {
        pushPathError(errors, index, 'chart_type', `must be one of ${Array.from(VALID_CHART_TYPES).join(', ')}`);
      }
      if (!section.data_key || typeof section.data_key !== 'string') {
        pushPathError(errors, index, 'data_key', 'is required');
      } else {
        const resolved = resolveDataKey(dataPackage, section.data_key);
        if (!Array.isArray(resolved)) {
          pushPathError(errors, index, 'data_key', `must resolve to an array; "${section.data_key}" did not`);
        } else {
          const sample = sampleObject(resolved);
          if (sample) {
            if (!section.x_key || !hasField(sample, section.x_key)) {
              pushPathError(errors, index, 'x_key', `must exist on rows from "${section.data_key}"`);
            }
            const series = Array.isArray(section.series) ? section.series : [];
            series.forEach((s, seriesIndex) => {
              if (!s?.key || !hasField(sample, s.key)) {
                pushPathError(errors, index, `series[${seriesIndex}].key`, `must exist on rows from "${section.data_key}"`);
              }
            });
          }
        }
      }
      if (!Array.isArray(section.series) || section.series.length === 0) {
        pushPathError(errors, index, 'series', 'must contain at least one series');
      }
    }

    if (section.type === 'table') {
      if (!section.data_key || typeof section.data_key !== 'string') {
        pushPathError(errors, index, 'data_key', 'is required');
      } else {
        const resolved = resolveDataKey(dataPackage, section.data_key);
        if (!Array.isArray(resolved)) {
          pushPathError(errors, index, 'data_key', `must resolve to an array; "${section.data_key}" did not`);
        } else {
          const sample = sampleObject(resolved);
          if (sample) {
            (Array.isArray(section.columns) ? section.columns : []).forEach((col, colIndex) => {
              if (!col?.key || !hasField(sample, col.key)) {
                pushPathError(errors, index, `columns[${colIndex}].key`, `must exist on rows from "${section.data_key}"`);
              }
            });
          }
        }
      }
      if (!Array.isArray(section.columns) || section.columns.length === 0) {
        pushPathError(errors, index, 'columns', 'must contain at least one column');
      }
    }

    if (section.type === 'narrative') {
      if (!section.markdown || typeof section.markdown !== 'string') {
        pushPathError(errors, index, 'markdown', 'is required');
      }
      for (const key of section.source_keys || []) {
        if (!pathExists(dataPackage, key)) {
          warnings.push(`sections[${index}].source_keys "${key}" was not found`);
        }
      }
    }

    if (section.type === 'callout') {
      if (!VALID_CALLOUT_TONES.has(section.tone)) {
        pushPathError(errors, index, 'tone', `must be one of ${Array.from(VALID_CALLOUT_TONES).join(', ')}`);
      }
      if (!section.body || typeof section.body !== 'string') {
        pushPathError(errors, index, 'body', 'is required');
      }
      for (const key of section.source_keys || []) {
        if (!pathExists(dataPackage, key)) {
          warnings.push(`sections[${index}].source_keys "${key}" was not found`);
        }
      }
    }
  });

  if (errors.length) {
    throw new ReportGenerationError('AI report failed validation', {
      validationErrors: errors,
      validationWarnings: warnings
    });
  }

  return { output, warnings };
}
