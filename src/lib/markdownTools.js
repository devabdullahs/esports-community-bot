function clampSelection(value, start, end) {
  const min = Math.max(0, Math.min(start, end, value.length));
  const max = Math.max(0, Math.min(Math.max(start, end), value.length));
  return [min, max];
}

function lineBounds(value, start, end) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  return [lineStart, lineEnd];
}

function nearestWrappedRange(value, start, end, marker) {
  const open = value.lastIndexOf(marker, start);
  if (open === -1) return null;
  const contentStart = open + marker.length;
  const close = value.indexOf(marker, Math.max(end, contentStart));
  if (close === -1) return null;
  const segment = value.slice(open, close + marker.length);
  if (segment.includes('\n')) return null;
  if (start < contentStart || end > close) return null;
  return { open, contentStart, close, contentEnd: close };
}

export function toggleWrap(value, start, end, marker) {
  [start, end] = clampSelection(value, start, end);
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, -marker.length);
    return {
      text: before + inner + after,
      selStart: start,
      selEnd: start + inner.length,
    };
  }

  if (before.endsWith(marker) && after.startsWith(marker)) {
    return {
      text:
        before.slice(0, -marker.length) +
        selected +
        after.slice(marker.length),
      selStart: start - marker.length,
      selEnd: end - marker.length,
    };
  }

  const wrappedRange = nearestWrappedRange(value, start, end, marker);
  if (wrappedRange) {
    const inner = value.slice(wrappedRange.contentStart, wrappedRange.contentEnd);
    return {
      text:
        value.slice(0, wrappedRange.open) +
        inner +
        value.slice(wrappedRange.close + marker.length),
      selStart: wrappedRange.contentStart - marker.length,
      selEnd: wrappedRange.contentStart - marker.length + inner.length,
    };
  }

  if (selected) {
    return {
      text: before + marker + selected + marker + after,
      selStart: start + marker.length,
      selEnd: end + marker.length,
    };
  }

  const caret = start + marker.length;
  return {
    text: before + marker + marker + after,
    selStart: caret,
    selEnd: caret,
  };
}

export function toggleLinePrefix(value, start, end, options) {
  [start, end] = clampSelection(value, start, end);
  const [lineStart, lineEnd] = lineBounds(value, start, end);
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const numbered = options.numbered === true;
  const prefix = options.prefix || '';
  const matcher = numbered
    ? /^\d+\.\s+/
    : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const allPrefixed = lines.every((line) => line === '' || matcher.test(line));

  const transformed = lines
    .map((line, index) => {
      if (allPrefixed) return line.replace(matcher, '');
      if (line === '' || matcher.test(line)) return line;
      return (numbered ? `${index + 1}. ` : prefix) + line;
    })
    .join('\n');

  return {
    text: value.slice(0, lineStart) + transformed + value.slice(lineEnd),
    selStart: lineStart,
    selEnd: lineStart + transformed.length,
  };
}

export function insertLink(value, start, end) {
  [start, end] = clampSelection(value, start, end);
  const selected = value.slice(start, end) || 'link text';
  const existing = selected.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (existing) {
    const urlStart = start + existing[1].length + 3;
    return { text: value, selStart: urlStart, selEnd: urlStart + existing[2].length };
  }
  const before = value.slice(0, start);
  const after = value.slice(end);
  const snippet = `[${selected}](url)`;
  const urlStart = before.length + selected.length + 3;
  return {
    text: before + snippet + after,
    selStart: urlStart,
    selEnd: urlStart + 3,
  };
}

export function imageTransform(url, selectUrl, alt = 'image') {
  return (value, _start, end) => {
    [, end] = clampSelection(value, end, end);
    let lineEnd = value.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = value.length;
    const before = value.slice(0, lineEnd);
    const after = value.slice(lineEnd);
    const lead = before.length ? '\n\n' : '';
    const snippet = `${lead}![${alt}](${url})`;
    const text = before + snippet + (after.startsWith('\n') ? after : `\n${after}`);
    if (selectUrl) {
      const urlStart = before.length + lead.length + `![${alt}](`.length;
      return { text, selStart: urlStart, selEnd: urlStart + url.length };
    }
    const caret = before.length + snippet.length;
    return { text, selStart: caret, selEnd: caret };
  };
}

export function insertCodeBlock(value, _start, end) {
  [, end] = clampSelection(value, end, end);
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const before = value.slice(0, lineEnd);
  const after = value.slice(lineEnd);
  const lead = before.length ? '\n\n' : '';
  const open = `${lead}\`\`\`\n`;
  const snippet = `${open}code\n\`\`\``;
  const text = before + snippet + (after.startsWith('\n') ? after : `\n${after}`);
  const selStart = before.length + open.length;
  return { text, selStart, selEnd: selStart + 'code'.length };
}

export function insertTable(value, _start, end) {
  [, end] = clampSelection(value, end, end);
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const before = value.slice(0, lineEnd);
  const after = value.slice(lineEnd);
  const lead = before.length ? '\n\n' : '';
  const table = '| Column A | Column B |\n| --- | --- |\n| Cell | Cell |';
  const text = before + lead + table + (after.startsWith('\n') ? after : `\n${after}`);
  const selStart = before.length + lead.length + 2;
  return { text, selStart, selEnd: selStart + 'Column A'.length };
}

export function insertText(str) {
  return (value, start, end) => {
    [start, end] = clampSelection(value, start, end);
    const caret = start + str.length;
    return {
      text: value.slice(0, start) + str + value.slice(end),
      selStart: caret,
      selEnd: caret,
    };
  };
}

function hasWrap(value, start, end, marker) {
  [start, end] = clampSelection(value, start, end);
  if (value.slice(start, end).startsWith(marker) && value.slice(start, end).endsWith(marker)) {
    return true;
  }
  if (value.slice(0, start).endsWith(marker) && value.slice(end).startsWith(marker)) {
    return true;
  }
  return nearestWrappedRange(value, start, end, marker) !== null;
}

function selectedLinesHavePrefix(value, start, end, options) {
  [start, end] = clampSelection(value, start, end);
  const [lineStart, lineEnd] = lineBounds(value, start, end);
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const numbered = options.numbered === true;
  const prefix = options.prefix || '';
  const matcher = numbered
    ? /^\d+\.\s+/
    : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  return lines.every((line) => line === '' || matcher.test(line));
}

export function getMarkdownActiveState(value, start, end) {
  return {
    bold: hasWrap(value, start, end, '**'),
    italic: hasWrap(value, start, end, '*') && !hasWrap(value, start, end, '**'),
    strike: hasWrap(value, start, end, '~~'),
    code: hasWrap(value, start, end, '`'),
    heading: selectedLinesHavePrefix(value, start, end, { prefix: '## ' }),
    bulletList: selectedLinesHavePrefix(value, start, end, { prefix: '- ' }),
    numberedList: selectedLinesHavePrefix(value, start, end, { numbered: true }),
    taskList: selectedLinesHavePrefix(value, start, end, { prefix: '- [ ] ' }),
    quote: selectedLinesHavePrefix(value, start, end, { prefix: '> ' }),
  };
}
