// Fast drop-in for csv-reader 1.0.0 (make.fun).
// run(input) returns exactly what csv-reader's readCsv returns for every
// {text, header}: {columns, rows, errors}.
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module.
//
// Speed approach (vs the reference, which builds every field one character
// at a time):
// - Bulk scanning with indexOf finds the next field delimiter (comma / LF /
//   CR for unquoted fields, quote / CR / LF inside quoted fields) in native
//   code and stops at the first one; no per-character loop, no regex.
// - Field contents are taken with slice() in bulk; a field is usually a
//   single slice, never a per-character concatenation.
// - String building only concatenates bulk slices, and only when a field
//   actually contains a stray CR, a doubled quote or an in-quote line break.
// - No lookup tables, no pre-processing pass: a single left-to-right pass.
const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;
  let recordLine = 1;
  let recordRow = null;

  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      const cr = text.indexOf('\r', pos);
      let m = -1, kind = -1;
      if (comma !== -1) { m = comma; kind = 0; }
      if (lf !== -1 && (m === -1 || lf < m)) { m = lf; kind = 1; }
      if (cr !== -1 && (m === -1 || cr < m)) { m = cr; kind = 2; }
      if (m === -1) {
        value += text.slice(pos);
        added += n - pos;
        pos = n;
        return { value, ended: END, added };
      }
      if (kind === 0) {
        value += text.slice(pos, m);
        added += m - pos;
        pos = m + 1;
        return { value, ended: COMMA, added };
      }
      if (kind === 1) {
        value += text.slice(pos, m);
        added += m - pos;
        pos = m + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      if (m + 1 < n && text.charCodeAt(m + 1) === 10) {
        value += text.slice(pos, m);
        added += m - pos;
        pos = m + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(pos, m);
      added += m - pos;
      pos = m + 1;
    }
    return { value, ended: END, added };
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < n) {
      const q = text.indexOf('"', pos);
      const r = text.indexOf('\r', pos);
      const l = text.indexOf('\n', pos);
      let m = -1, kind = -1;
      if (q !== -1) { m = q; kind = 0; }
      if (r !== -1 && (m === -1 || r < m)) { m = r; kind = 1; }
      if (l !== -1 && (m === -1 || l < m)) { m = l; kind = 2; }
      if (m === -1) { pos = n; break; }
      if (kind === 0) {
        if (m + 1 < n && text.charCodeAt(m + 1) === 34) {
          value += text.slice(pos, m);
          value += '"';
          pos = m + 2;
        } else {
          value += text.slice(pos, m);
          pos = m + 1;
          closed = true;
          break;
        }
      } else {
        value += text.slice(pos, m);
        value += '\n';
        line += 1;
        if (kind === 1 && m + 1 < n && text.charCodeAt(m + 1) === 10) pos = m + 2;
        else pos = m + 1;
      }
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return { value, ended: COMMA }; }
    if (c === 10) { pos += 1; line += 1; return { value, ended: LINE_BREAK }; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return { value, ended: LINE_BREAK }; }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) { columns = fields; continue; }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
