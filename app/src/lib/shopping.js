// The shopping list for several recipes, as plain text to paste into WhatsApp
// or Reminders: the recipe names, then one line per item, alphabetical. The
// same item in the same unit is summed; g and kg stay apart (v1). Nothing is
// stored and no AI is involved.
import { fold, formatAmount } from './recipes.js';

export function shoppingList(recipes) {
  const lines = new Map();
  for (const r of recipes) {
    for (const i of r.ingredients || []) {
      const item = (i.item || '').trim();
      if (!item) continue;
      const key = `${fold(item)}\n${i.unit || ''}`;
      const line = lines.get(key) || lines.set(key, { item, unit: i.unit, amount: null }).get(key);
      if (i.amount !== null && i.amount !== undefined) line.amount = (line.amount ?? 0) + i.amount;
    }
  }
  const items = [...lines.values()]
    .sort((a, b) => a.item.localeCompare(b.item, undefined, { sensitivity: 'base' }))
    .map((l) => [formatAmount(l), l.item].filter(Boolean).join(' '));
  return [`Shopping list: ${recipes.map((r) => r.title).join(', ')}`, '', ...items].join('\n');
}
