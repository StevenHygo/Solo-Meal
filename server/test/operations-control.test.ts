import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeOperationsCsv } from '../src/services/operations-control.js';

test('operations CSV has a BOM, CRLF records and formula injection protection', () => {
  const csv = serializeOperationsCsv({
    columns: ['name', 'count', 'empty'],
    rows: [['=HYPERLINK("bad")', 2, null], ['普通餐厅', 0, null]]
  });
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/);
  assert.match(csv, /\r\n/);
  assert.equal(csv.endsWith('\r\n'), true);
});
