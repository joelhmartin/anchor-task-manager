/**
 * TM-015v2b: Condition Evaluator
 *
 * Pure logic module for evaluating AND/OR condition groups against a context object.
 * No database dependencies — used by the rule engine for if/else step branching
 * and trigger config matching.
 */

/**
 * Get a nested value from an object using dot-path notation.
 * e.g. getNestedValue({item: {status: 'Done'}}, 'item.status') → 'Done'
 */
export function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Evaluate a single operator comparison.
 * Type coercion: gt/gte/lt/lte try Number() first, then Date(), then string comparison.
 */
export function evaluateOperator(operator, fieldValue, conditionValue) {
  switch (operator) {
    case 'equals':
      return String(fieldValue) === String(conditionValue);

    case 'not_equals':
      return String(fieldValue) !== String(conditionValue);

    case 'contains':
      return String(fieldValue ?? '').toLowerCase().includes(String(conditionValue ?? '').toLowerCase());

    case 'not_contains':
      return !String(fieldValue ?? '').toLowerCase().includes(String(conditionValue ?? '').toLowerCase());

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareValues(fieldValue, conditionValue);
      if (cmp === null) return false;
      if (operator === 'gt') return cmp > 0;
      if (operator === 'gte') return cmp >= 0;
      if (operator === 'lt') return cmp < 0;
      return cmp <= 0; // lte
    }

    case 'in': {
      const list = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(s => s.trim());
      return list.some(v => String(v) === String(fieldValue));
    }

    case 'not_in': {
      const list = Array.isArray(conditionValue) ? conditionValue : String(conditionValue).split(',').map(s => s.trim());
      return !list.some(v => String(v) === String(fieldValue));
    }

    case 'is_empty':
      return fieldValue == null || String(fieldValue).trim() === '';

    case 'is_not_empty':
      return fieldValue != null && String(fieldValue).trim() !== '';

    default:
      return false;
  }
}

/**
 * Compare two values for ordering. Returns negative, 0, positive, or null if incomparable.
 * Tries Number, then Date, then string.
 */
function compareValues(a, b) {
  // Try numeric
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  // Try date
  const dateA = new Date(a);
  const dateB = new Date(b);
  if (!isNaN(dateA.getTime()) && !isNaN(dateB.getTime())) {
    return dateA.getTime() - dateB.getTime();
  }
  // String comparison
  if (a != null && b != null) {
    return String(a).localeCompare(String(b));
  }
  return null;
}

/**
 * Normalize a condition into a condition group.
 * Wraps a legacy single condition {field, operator, value} into {logic: 'and', conditions: [...]}.
 * Already-wrapped groups pass through unchanged.
 */
export function normalizeConditionGroup(condition) {
  if (!condition) return null;
  // Already a group
  if (condition.logic && Array.isArray(condition.conditions)) return condition;
  // Single condition object
  if (condition.field && condition.operator) {
    return { logic: 'and', conditions: [condition] };
  }
  return null;
}

/**
 * Evaluate a condition group against a context object.
 * AND = all conditions true. OR = at least one true.
 * Null/empty group = always true (no conditions = unconditional).
 */
export function evaluateConditionGroup(group, context) {
  const normalized = normalizeConditionGroup(group);
  if (!normalized) return true; // no conditions = always match

  const { logic = 'and', conditions = [] } = normalized;
  if (conditions.length === 0) return true;

  const results = conditions.map(cond => {
    // Nested group
    if (cond.logic && Array.isArray(cond.conditions)) {
      return evaluateConditionGroup(cond, context);
    }
    // Single condition
    const fieldValue = getNestedValue(context, cond.field);
    return evaluateOperator(cond.operator, fieldValue, cond.value);
  });

  return logic === 'or' ? results.some(Boolean) : results.every(Boolean);
}
