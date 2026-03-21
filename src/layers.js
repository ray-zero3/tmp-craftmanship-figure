/**
 * Layers Visualization Module - Flowing layout
 *
 * Three cell types flow left→right, wrapping into rows:
 *   1. Prompt (injection) → white gap
 *   2. AI implementation  → black background + white stipple
 *   3. Human implementation → white background + black stipple
 * Cell width proportional to activity (log scale).
 */

class StippleRng {
  constructor(seed = 42) {
    this.seed = seed;
  }
  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
}

/**
 * Build cells from prompt boundaries.
 * Three cell types: 'prompt' (white gap), 'ai' (black bg + white dots), 'human' (white bg + black dots).
 * Order within each cycle: prompt → ai → human.
 */
export function buildCycles(events) {
  const sorted = [...events].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const prompts = sorted.filter(e => e.event === 'ai_prompt');
  const edits = sorted.filter(e => e.event === 'edit');

  if (sorted.length === 0) {
    return { cycles: [], maxAiChars: 0, maxHumanChars: 0, maxPromptLen: 0 };
  }

  const startTs = sorted[0].ts;
  const endTs = sorted[sorted.length - 1].ts + 1;
  const boundaries = [startTs, ...prompts.map(p => p.ts), endTs];

  const cells = [];
  let maxAiChars = 0;
  let maxHumanChars = 0;
  let maxPromptLen = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];

    // Prompt cell (white gap) — from the ai_prompt event that starts this cycle
    let promptLen = 0;
    if (i > 0 && i - 1 < prompts.length) {
      promptLen = prompts[i - 1].raw?.prompt?.length || 0;
    }
    if (promptLen > 0) {
      maxPromptLen = Math.max(maxPromptLen, promptLen);
      cells.push({ type: 'prompt', chars: promptLen, totalChars: promptLen });
    }

    let aiChars = 0;
    let humanChars = 0;
    for (const e of edits) {
      if (e.ts >= start && e.ts < end) {
        const chars = (e.delta?.added_chars || 0) + (e.delta?.deleted_chars || 0);
        if (e.origin_mode === 'ai') aiChars += chars;
        else humanChars += chars;
      }
    }

    maxAiChars = Math.max(maxAiChars, aiChars);
    maxHumanChars = Math.max(maxHumanChars, humanChars);

    if (aiChars > 0) {
      cells.push({ type: 'ai', chars: aiChars, totalChars: aiChars });
    }
    if (humanChars > 0) {
      cells.push({ type: 'human', chars: humanChars, totalChars: humanChars });
    }
  }

  return { cycles: cells, maxAiChars, maxHumanChars, maxPromptLen };
}

/**
 * Compute flowing layout: pack cycles into rows.
 *
 * Each cycle has a weight = log1p(totalChars) + minWeight.
 * Rows are filled greedily: accumulate weight until exceeding target per row.
 * Within each row, cell width proportional to weight.
 * Row height proportional to total row weight.
 *
 * Returns array of rows, each with cells and geometry.
 */
function computeFlowLayout(cycles, drawX, drawY, drawW, drawH, targetRows = 7) {
  const MIN_WEIGHT = 1.0;
  // Prompt gaps: very thin with subtle variation
  const PROMPT_SCALE = 0.04;

  // Compute weights
  const weights = cycles.map(c => {
    if (c.type === 'prompt') {
      return MIN_WEIGHT * PROMPT_SCALE + Math.log1p(c.totalChars) * PROMPT_SCALE;
    }
    return Math.log1p(c.totalChars) + MIN_WEIGHT;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const targetWeightPerRow = totalWeight / targetRows;

  // Pack into rows greedily
  const rows = [];
  let currentRow = [];
  let currentRowWeight = 0;

  for (let i = 0; i < cycles.length; i++) {
    currentRow.push({ cycle: cycles[i], weight: weights[i], index: i });
    currentRowWeight += weights[i];

    // Start new row if we've accumulated enough weight
    // (but always allow at least one cell per row)
    if (currentRowWeight >= targetWeightPerRow && i < cycles.length - 1) {
      rows.push({ cells: currentRow, totalWeight: currentRowWeight });
      currentRow = [];
      currentRowWeight = 0;
    }
  }
  if (currentRow.length > 0) {
    rows.push({ cells: currentRow, totalWeight: currentRowWeight });
  }

  // Compute geometry: uniform row height, variable cell width
  const rowH = drawH / rows.length;
  let y = drawY;

  for (const row of rows) {
    let x = drawX;

    for (const cell of row.cells) {
      const cellW = (cell.weight / row.totalWeight) * drawW;
      cell.x = x;
      cell.y = y;
      cell.w = cellW;
      cell.h = rowH;
      x += cellW;
    }

    row.y = y;
    row.h = rowH;
    y += rowH;
  }

  return rows;
}

/**
 * Draw a single cell motif.
 *   prompt → white gap (nothing drawn, white background shows)
 *   ai     → black fill + white stipple dots
 *   human  → white fill + black stipple dots
 */
function drawCellMotif(g, cell, maxAiChars, maxHumanChars, canvasSize, rng) {
  const { cycle, x: cellX, y: cellY, w: cellW, h: cellH } = cell;

  const scaleFactor = canvasSize / 800;
  const padding = Math.min(cellW, cellH) * 0.02;
  const innerX = cellX + padding;
  const innerY = cellY + padding;
  const innerW = cellW - padding * 2;
  const innerH = cellH - padding * 2;

  if (innerW <= 0 || innerH <= 0) return;

  // Prompt cells: white gap — nothing drawn
  if (cycle.type === 'prompt') return;

  if (cycle.type === 'ai' && cycle.chars > 0) {
    // Black background
    g.noStroke();
    g.fill(0);
    g.rect(innerX, innerY, innerW, innerH);

    // White stipple dots
    const logMax = Math.log1p(maxAiChars);
    const raw = Math.log1p(cycle.chars) / logMax;
    const intensity = Math.pow(raw, 3.0);

    if (intensity > 0.002) {
      const cellArea = innerW * innerH;
      const refArea = (canvasSize * 0.15) * (canvasSize * 0.15);
      const areaDensity = cellArea / refArea;
      const maxDots = Math.round(2500 * areaDensity * scaleFactor);
      const dotCount = Math.round(maxDots * intensity);
      const dotSize = Math.max(1, 1.3 * scaleFactor);

      g.noStroke();
      g.fill(128);

      for (let d = 0; d < dotCount; d++) {
        const dx = rng.range(innerX, innerX + innerW);
        const dy = rng.range(innerY, innerY + innerH);
        g.rect(dx, dy, dotSize, dotSize);
      }
    }
  }

  if (cycle.type === 'human' && cycle.chars > 0) {
    // White background (explicit, in case canvas bg differs)
    g.noStroke();
    g.fill(255);
    g.rect(innerX, innerY, innerW, innerH);

    // Gray stipple dots
    const logMax = Math.log1p(maxHumanChars);
    const raw = Math.log1p(cycle.chars) / logMax;
    const intensity = Math.pow(raw, 3.0);

    if (intensity > 0.002) {
      const cellArea = innerW * innerH;
      const refArea = (canvasSize * 0.15) * (canvasSize * 0.15);
      const areaDensity = cellArea / refArea;
      const maxDots = Math.round(2500 * areaDensity * scaleFactor);
      const dotCount = Math.round(maxDots * intensity);
      const dotSize = Math.max(1, 1.3 * scaleFactor);

      g.noStroke();
      g.fill(128);

      for (let d = 0; d < dotCount; d++) {
        const dx = rng.range(innerX, innerX + innerW);
        const dy = rng.range(innerY, innerY + innerH);
        g.rect(dx, dy, dotSize, dotSize);
      }
    }
  }
}

/**
 * Draw the full flowing grid
 */
export function drawCycleGrid(g, cycleData, canvasSize, config = {}) {
  const { marginRatio = 0.04 } = config;
  const { cycles, maxAiChars, maxHumanChars } = cycleData;

  const margin = canvasSize * marginRatio;
  const drawW = canvasSize - 2 * margin;
  const drawH = canvasSize - 2 * margin;

  const rows = computeFlowLayout(cycles, margin, margin, drawW, drawH);
  const rng = new StippleRng(777);

  g.background(255);

  for (const row of rows) {
    for (const cell of row.cells) {
      drawCellMotif(g, cell, maxAiChars, maxHumanChars, canvasSize, rng);
    }
  }
}

/**
 * Draw separated layers view — Prompt | AI | Human
 */
export function drawCycleGridSeparated(g, cycleData, panelSize, config = {}) {
  const gap = panelSize * 0.02;
  g.background(245);

  const layers = ['prompt', 'ai', 'human'];
  const labels = ['Prompt', 'AI', 'Human'];

  for (let li = 0; li < 3; li++) {
    const offsetX = li * panelSize;

    g.fill(255);
    g.noStroke();
    g.rect(offsetX + gap, gap, panelSize - gap * 2, panelSize - gap * 2);

    g.push();
    g.translate(offsetX, 0);
    drawCycleGridLayer(g, cycleData, panelSize, layers[li], config);
    g.pop();

    g.fill(0);
    g.noStroke();
    g.textSize(Math.max(12, panelSize * 0.025));
    g.textAlign(g.CENTER, g.TOP);
    g.text(labels[li], offsetX + panelSize / 2, panelSize * 0.02);
  }
}

/**
 * Draw a single layer of the flowing grid.
 * Shows all cells but only renders content for the matching type.
 */
function drawCycleGridLayer(g, cycleData, canvasSize, layer, config = {}) {
  const { marginRatio = 0.04 } = config;
  const { cycles, maxAiChars, maxHumanChars } = cycleData;

  const margin = canvasSize * marginRatio;
  const drawW = canvasSize - 2 * margin;
  const drawH = canvasSize - 2 * margin;

  const rows = computeFlowLayout(cycles, margin, margin, drawW, drawH);
  const rng = new StippleRng(777);
  const scaleFactor = canvasSize / 800;

  for (const row of rows) {
    for (const cell of row.cells) {
      const { cycle, x: cellX, y: cellY, w: cellW, h: cellH } = cell;
      const padding = Math.min(cellW, cellH) * 0.02;
      const innerX = cellX + padding;
      const innerY = cellY + padding;
      const innerW = cellW - padding * 2;
      const innerH = cellH - padding * 2;

      if (innerW <= 0 || innerH <= 0) continue;

      if (layer === 'prompt' && cycle.type === 'prompt') {
        // Show prompt gaps as light gray outline
        g.noFill();
        g.stroke(220);
        g.strokeWeight(0.5);
        g.rect(innerX, innerY, innerW, innerH);
      }

      if (layer === 'ai' && cycle.type === 'ai' && cycle.chars > 0) {
        g.noStroke();
        g.fill(0);
        g.rect(innerX, innerY, innerW, innerH);

        const logMax = Math.log1p(maxAiChars);
        const raw = Math.log1p(cycle.chars) / logMax;
        const intensity = Math.pow(raw, 1.5);
        if (intensity > 0.005) {
          const cellArea = innerW * innerH;
          const refArea = (canvasSize * 0.15) * (canvasSize * 0.15);
          const areaDensity = cellArea / refArea;
          const maxDots = Math.round(1200 * areaDensity * scaleFactor);
          const dotCount = Math.round(maxDots * intensity);
          const dotSize = Math.max(1, 1.3 * scaleFactor);
          g.noStroke();
          g.fill(128);
          for (let d = 0; d < dotCount; d++) {
            const dx = rng.range(innerX, innerX + innerW);
            const dy = rng.range(innerY, innerY + innerH);
            g.rect(dx, dy, dotSize, dotSize);
          }
        }
      }

      if (layer === 'human' && cycle.type === 'human' && cycle.chars > 0) {
        g.noStroke();
        g.fill(255);
        g.rect(innerX, innerY, innerW, innerH);

        const logMax = Math.log1p(maxHumanChars);
        const raw = Math.log1p(cycle.chars) / logMax;
        const intensity = Math.pow(raw, 1.5);
        if (intensity > 0.005) {
          const cellArea = innerW * innerH;
          const refArea = (canvasSize * 0.15) * (canvasSize * 0.15);
          const areaDensity = cellArea / refArea;
          const maxDots = Math.round(1200 * areaDensity * scaleFactor);
          const dotCount = Math.round(maxDots * intensity);
          const dotSize = Math.max(1, 1.3 * scaleFactor);
          g.noStroke();
          g.fill(128);
          for (let d = 0; d < dotCount; d++) {
            const dx = rng.range(innerX, innerX + innerW);
            const dy = rng.range(innerY, innerY + innerH);
            g.rect(dx, dy, dotSize, dotSize);
          }
        }
      }
    }
  }
}
