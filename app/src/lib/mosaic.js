// The library's mosaic: cards keep their own height and are dealt into
// columns left to right (card 1 to column 1, card 2 to column 2, …), so the
// newest stay along the top row.

// How many columns of at least minWidth fit in width (at least one).
export function columnCount(width, minWidth = 220, gap = 16) {
  return Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
}

export function dealColumns(list, n) {
  const cols = Array.from({ length: Math.max(1, n) }, () => []);
  list.forEach((item, i) => cols[i % cols.length].push(item));
  return cols;
}
