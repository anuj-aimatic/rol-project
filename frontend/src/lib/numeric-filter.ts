/** Comparison operators for numeric column filters. */
export type NumericOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'

export const NUMERIC_OPERATORS: { key: NumericOp; symbol: string; label: string }[] = [
  { key: 'eq', symbol: '=', label: 'Equal to' },
  { key: 'neq', symbol: '≠', label: 'Not equal to' },
  { key: 'lt', symbol: '<', label: 'Less than' },
  { key: 'lte', symbol: '≤', label: 'Less than or equal' },
  { key: 'gt', symbol: '>', label: 'Greater than' },
  { key: 'gte', symbol: '≥', label: 'Greater than or equal' },
]
