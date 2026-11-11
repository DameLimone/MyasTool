export function execute(queryable, statement, parameters = []) {
  if (typeof queryable.unsafe === 'function') return queryable.unsafe(statement, parameters);
  if (typeof queryable.query === 'function') return queryable.query(statement, parameters);
  throw new TypeError('Unsupported PostgreSQL transaction client.');
}

export function resultRows(result) {
  return Array.isArray(result) ? result : result.rows;
}
