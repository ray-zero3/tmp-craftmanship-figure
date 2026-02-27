/**
 * LeWitt Grid Hatch Drawing Module
 * Translates craftlog events into Sol LeWitt-style hatching patterns
 */

import { colors, LEWITT_CONFIG } from './config.js';
import { clamp, lerp, hashString } from './helpers.js';

/**
 * Seeded random number generator (Mulberry32)
 */
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  // Random float in range [min, max)
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // Random integer in range [min, max]
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
}

/**
 * Calculate grid size based on event count
 */
export function calculateGridSize(eventCount, config = LEWITT_CONFIG) {
  const k = Math.min(eventCount, config.maxEvents);
  const n = Math.round(Math.sqrt(k));
  return clamp(n, config.minGridSize, config.maxGridSize);
}

/**
 * Get hatching angle for an event
 */
export function getHatchAngle(event, rng) {
  const { angles } = LEWITT_CONFIG.hatching;

  if (event.event === 'edit') {
    if (event.origin_mode === 'human') return angles.edit_human;
    if (event.origin_mode === 'ai') return angles.edit_ai;
  }
  if (event.event === 'snapshot') return angles.snapshot;
  if (event.event === 'mode_change') return angles.mode_change;
  if (event.event === 'policy_violation') return angles.policy_violation; // Array for cross-hatch

  // Default: hash-based selection
  const hash = hashString(event.event);
  return angles.default[hash % angles.default.length];
}

/**
 * Get hatching parameters based on severity
 */
export function getHatchParams(severity) {
  const { hatching } = LEWITT_CONFIG;

  return {
    spacing: clamp(
      lerp(hatching.spacingMax, hatching.spacingMin, severity),
      hatching.spacingClampMin,
      hatching.spacingClampMax
    ),
    weight: lerp(hatching.weightMin, hatching.weightMax, severity),
    alpha: Math.round(lerp(hatching.alphaMin, hatching.alphaMax, severity))
  };
}

/**
 * Clip a line segment to a rectangle using Liang-Barsky algorithm
 * Returns null if line is completely outside, or clipped [x1,y1,x2,y2]
 */
function clipLineToRect(x1, y1, x2, y2, rx, ry, rw, rh) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - rx, rx + rw - x1, y1 - ry, ry + rh - y1];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }

  return [
    x1 + t0 * dx,
    y1 + t0 * dy,
    x1 + t1 * dx,
    y1 + t1 * dy
  ];
}

/**
 * Draw hatching lines in a cell at a given angle
 * @param eraseRatio - ratio (0-1) of cell size to erase from center (for deleted_chars visualization)
 */
export function drawHatchLines(g, cellX, cellY, cellW, cellH, angleDeg, spacing, weight, alpha, scale = 1, eraseRatio = 0) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  // Scaled parameters
  const scaledSpacing = spacing * scale;
  const scaledWeight = Math.max(0.5, weight * scale);

  g.stroke(0, alpha);
  g.strokeWeight(scaledWeight);

  // Calculate the diagonal length of the cell
  const diag = Math.sqrt(cellW * cellW + cellH * cellH);
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;

  // Calculate erase rectangle (centered, proportional to cell)
  const eraseW = cellW * eraseRatio;
  const eraseH = cellH * eraseRatio;
  const eraseRect = eraseRatio > 0 ? {
    x: centerX - eraseW / 2,
    y: centerY - eraseH / 2,
    w: eraseW,
    h: eraseH
  } : null;

  // Number of lines needed
  const numLines = Math.ceil(diag / scaledSpacing) + 2;

  // Draw parallel lines
  for (let i = -numLines; i <= numLines; i++) {
    // Offset perpendicular to the line direction
    const offsetX = -sin * i * scaledSpacing;
    const offsetY = cos * i * scaledSpacing;

    // Line endpoints (long enough to cover the cell)
    const x1 = centerX + offsetX - cos * diag;
    const y1 = centerY + offsetY - sin * diag;
    const x2 = centerX + offsetX + cos * diag;
    const y2 = centerY + offsetY + sin * diag;

    // Clip to cell bounds
    const clipped = clipLineToRect(x1, y1, x2, y2, cellX, cellY, cellW, cellH);
    if (clipped) {
      if (eraseRect) {
        // Draw line segments excluding the center rectangle
        drawLineWithRectHole(g, clipped[0], clipped[1], clipped[2], clipped[3], eraseRect);
      } else {
        g.line(clipped[0], clipped[1], clipped[2], clipped[3]);
      }
    }
  }
}

/**
 * Draw a line segment with a rectangular hole in the center
 */
function drawLineWithRectHole(g, x1, y1, x2, y2, rect) {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const rx2 = rx + rw;
  const ry2 = ry + rh;

  // Check if line is completely inside the rectangle
  const p1Inside = x1 >= rx && x1 <= rx2 && y1 >= ry && y1 <= ry2;
  const p2Inside = x2 >= rx && x2 <= rx2 && y2 >= ry && y2 <= ry2;

  if (p1Inside && p2Inside) {
    // Entire line is inside the hole, don't draw
    return;
  }

  // Find intersections with rectangle edges
  const dx = x2 - x1;
  const dy = y2 - y1;
  const intersections = [];

  // Check intersection with each edge
  // Left edge (x = rx)
  if (dx !== 0) {
    const t = (rx - x1) / dx;
    if (t >= 0 && t <= 1) {
      const y = y1 + t * dy;
      if (y >= ry && y <= ry2) {
        intersections.push({ t, x: rx, y });
      }
    }
  }

  // Right edge (x = rx2)
  if (dx !== 0) {
    const t = (rx2 - x1) / dx;
    if (t >= 0 && t <= 1) {
      const y = y1 + t * dy;
      if (y >= ry && y <= ry2) {
        intersections.push({ t, x: rx2, y });
      }
    }
  }

  // Top edge (y = ry)
  if (dy !== 0) {
    const t = (ry - y1) / dx * (dx / dy);
    const tFixed = (ry - y1) / dy;
    if (tFixed >= 0 && tFixed <= 1) {
      const x = x1 + tFixed * dx;
      if (x >= rx && x <= rx2) {
        intersections.push({ t: tFixed, x, y: ry });
      }
    }
  }

  // Bottom edge (y = ry2)
  if (dy !== 0) {
    const tFixed = (ry2 - y1) / dy;
    if (tFixed >= 0 && tFixed <= 1) {
      const x = x1 + tFixed * dx;
      if (x >= rx && x <= rx2) {
        intersections.push({ t: tFixed, x, y: ry2 });
      }
    }
  }

  if (intersections.length === 0) {
    // No intersections - line is completely outside the rectangle
    g.line(x1, y1, x2, y2);
    return;
  }

  // Sort intersections by t
  intersections.sort((a, b) => a.t - b.t);

  // Remove duplicates (corner cases)
  const unique = [intersections[0]];
  for (let i = 1; i < intersections.length; i++) {
    if (Math.abs(intersections[i].t - unique[unique.length - 1].t) > 0.0001) {
      unique.push(intersections[i]);
    }
  }

  if (unique.length >= 2) {
    // Line crosses through the rectangle
    const enter = unique[0];
    const exit = unique[unique.length - 1];

    // Draw segment before entering the rectangle
    if (!p1Inside && enter.t > 0.001) {
      g.line(x1, y1, enter.x, enter.y);
    }

    // Draw segment after exiting the rectangle
    if (!p2Inside && exit.t < 0.999) {
      g.line(exit.x, exit.y, x2, y2);
    }
  } else if (unique.length === 1) {
    // Line touches the rectangle at one point
    const touch = unique[0];
    if (p1Inside) {
      g.line(touch.x, touch.y, x2, y2);
    } else {
      g.line(x1, y1, touch.x, touch.y);
    }
  }
}

/**
 * Draw radial lines from center (for added_chars visualization)
 * Original mode - draws lines from center
 */
export function drawRadialLines(g, cellX, cellY, cellW, cellH, count, rng, scale = 1) {
  const { motifs } = LEWITT_CONFIG;
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;
  const cellSize = Math.min(cellW, cellH);

  g.stroke(0, 120);
  g.strokeWeight(Math.max(0.5, 1.2 * scale));

  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const lengthRatio = rng.range(motifs.radialLinesMinLength, motifs.radialLinesMaxLength);
    const length = cellSize * lengthRatio;

    const x2 = centerX + Math.cos(angle) * length;
    const y2 = centerY + Math.sin(angle) * length;

    // Clip to cell
    const clipped = clipLineToRect(centerX, centerY, x2, y2, cellX, cellY, cellW, cellH);
    if (clipped) {
      g.line(clipped[0], clipped[1], clipped[2], clipped[3]);
    }
  }
}

/**
 * Draw AI prompt indicator (horizontal line through cell center)
 * Indicates the start of AI-generated code following a user prompt
 */
export function drawAiPromptMark(g, cellX, cellY, cellW, cellH, scale = 1) {
  const centerY = cellY + cellH / 2;

  g.stroke(0, 200);
  g.strokeWeight(Math.max(1, 2 * scale));
  g.line(cellX, centerY, cellX + cellW, centerY);
}

/**
 * Calculate intersection point of a ray from center with cell boundary
 * Returns {x, y} or null if no intersection
 */
function getRayBoundaryIntersection(centerX, centerY, angle, cellX, cellY, cellW, cellH) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Extend ray far enough to guarantee intersection
  const maxDist = Math.sqrt(cellW * cellW + cellH * cellH);
  const x2 = centerX + cos * maxDist;
  const y2 = centerY + sin * maxDist;

  // Clip to cell bounds - returns the intersection points
  const clipped = clipLineToRect(centerX, centerY, x2, y2, cellX, cellY, cellW, cellH);
  if (clipped) {
    // Return the far end (intersection with boundary)
    return { x: clipped[2], y: clipped[3] };
  }
  return null;
}

/**
 * Collect boundary intersection points for a cell (NEW mode)
 * Instead of drawing radial lines, collect the intersection points with cell edges
 */
export function collectBoundaryPoints(cellX, cellY, cellW, cellH, count, rng) {
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;
  const points = [];

  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const intersection = getRayBoundaryIntersection(centerX, centerY, angle, cellX, cellY, cellW, cellH);
    if (intersection) {
      points.push(intersection);
    }
  }

  return points;
}

/**
 * Draw point-symmetric lines through center
 * Each boundary point is connected to its point-symmetric position through the center
 */
export function drawPointSymmetricLines(g, cellX, cellY, cellW, cellH, count, rng, scale = 1) {
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;
  const points = [];

  // Collect boundary points
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const intersection = getRayBoundaryIntersection(centerX, centerY, angle, cellX, cellY, cellW, cellH);
    if (intersection) {
      points.push(intersection);
    }
  }

  g.stroke(0, 150);
  g.strokeWeight(Math.max(0.5, 1.2 * scale));

  // Draw lines from each point through center to point-symmetric position
  for (const point of points) {
    // Calculate point-symmetric position (reflection through center)
    const symX = 2 * centerX - point.x;
    const symY = 2 * centerY - point.y;

    // Clip line to cell bounds
    const clipped = clipLineToRect(point.x, point.y, symX, symY, cellX, cellY, cellW, cellH);
    if (clipped) {
      g.line(clipped[0], clipped[1], clipped[2], clipped[3]);
    }
  }

  // Draw points at boundary intersections
  g.fill(0, 200);
  g.noStroke();
  const pointSize = Math.max(2, 4 * scale);
  for (const point of points) {
    g.ellipse(point.x, point.y, pointSize, pointSize);
  }
}

/**
 * Draw undo mark (perpendicular line)
 */
export function drawUndoMark(g, cellX, cellY, cellW, cellH, hatchAngle, scale = 1) {
  const { motifs } = LEWITT_CONFIG;
  const perpAngle = hatchAngle + 90;
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;
  const length = Math.min(cellW, cellH) * 0.6;

  const angleRad = (perpAngle * Math.PI) / 180;
  const dx = Math.cos(angleRad) * length / 2;
  const dy = Math.sin(angleRad) * length / 2;

  g.stroke(0, motifs.undoLineAlpha);
  g.strokeWeight(Math.max(0.5, 1.5 * scale));

  const clipped = clipLineToRect(
    centerX - dx, centerY - dy,
    centerX + dx, centerY + dy,
    cellX, cellY, cellW, cellH
  );
  if (clipped) {
    g.line(clipped[0], clipped[1], clipped[2], clipped[3]);
  }
}

/**
 * Draw paste mark (thick line)
 */
export function drawPasteMark(g, cellX, cellY, cellW, cellH, hatchAngle, weight, scale = 1) {
  const { motifs } = LEWITT_CONFIG;
  const centerX = cellX + cellW / 2;
  const centerY = cellY + cellH / 2;
  const length = Math.min(cellW, cellH) * 0.7;

  const angleRad = (hatchAngle * Math.PI) / 180;
  const dx = Math.cos(angleRad) * length / 2;
  const dy = Math.sin(angleRad) * length / 2;

  g.stroke(0, 180);
  g.strokeWeight(Math.max(1, weight * motifs.pasteLineWeightMultiplier * scale));

  const clipped = clipLineToRect(
    centerX - dx, centerY - dy,
    centerX + dx, centerY + dy,
    cellX, cellY, cellW, cellH
  );
  if (clipped) {
    g.line(clipped[0], clipped[1], clipped[2], clipped[3]);
  }
}

/**
 * Draw policy violation cell (red fill + cross-hatch)
 */
export function drawPolicyViolationCell(g, cellX, cellY, cellW, cellH, severity, scale = 1) {
  const params = getHatchParams(severity);
  const angles = LEWITT_CONFIG.hatching.angles.policy_violation;

  // Red fill
  g.noStroke();
  g.fill(255, 0, 0, 20);
  g.rect(cellX, cellY, cellW, cellH);

  // Cross-hatch (two directions)
  const weight = params.weight + LEWITT_CONFIG.hatching.policyViolationWeightBonus;
  for (const angle of angles) {
    drawHatchLines(g, cellX, cellY, cellW, cellH, angle, params.spacing, weight, params.alpha, scale);
  }
}

/**
 * Draw a single cell with hatching based on event
 * Returns collected boundary points if collectPoints is true
 */
export function drawCell(g, event, cellX, cellY, cellW, cellH, rng, scale = 1, collectPoints = false) {
  const { hatching } = LEWITT_CONFIG;
  const collectedPoints = [];

  // Draw cell border - thicker/darker if this edit follows an ai_prompt
  let borderWeight = Math.max(0.5, hatching.cellBorderWeight * scale);
  let borderAlpha = hatching.cellBorderAlpha;

  if (event && event.aiPromptLength > 0) {
    // Scale based on prompt length (log scale, 10-1000 chars typical)
    const promptRatio = clamp(Math.log1p(event.aiPromptLength) / Math.log1p(1000), 0, 1);
    borderWeight = Math.max(2, lerp(3, 10, promptRatio) * scale);
    borderAlpha = Math.round(lerp(150, 255, promptRatio));
  }

  console.log(event.aiPromptLength);
  g.stroke(0, borderAlpha);
  g.strokeWeight(borderWeight);
  g.noFill();
  g.rect(cellX, cellY, cellW, cellH);

  if (!event) return collectedPoints; // Empty cell

  // Special handling for policy_violation
  if (event.event === 'policy_violation') {
    drawPolicyViolationCell(g, cellX, cellY, cellW, cellH, event.severity, scale);
    return collectedPoints;
  }

  // Get hatching parameters
  const angle = getHatchAngle(event, rng);
  const params = getHatchParams(event.severity);

  // Calculate erase ratio based on deleted_chars (logarithmic scale)
  let eraseRatio = 0;
  if (event.delta && event.delta.deleted_chars > 0) {
    const deleted = event.delta.deleted_chars;
    // Map log1p(deleted)/log1p(3000) to 0..0.8 ratio
    eraseRatio = clamp(Math.log1p(deleted) / Math.log1p(3000), 0, 1) * 0.8;
  }

  // Draw main hatching
  if (typeof angle === 'number') {
    drawHatchLines(g, cellX, cellY, cellW, cellH, angle, params.spacing, params.weight, params.alpha, scale, eraseRatio);
  }

  // Additional motifs for edit events
  if (event.event === 'edit') {
    // Boundary points based on total change amount (added + deleted)
    if (event.delta) {
      const totalChange = (event.delta.added_chars || 0) + (event.delta.deleted_chars || 0);
      if (totalChange > 0) {
        const count = clamp(
          Math.round(Math.log1p(totalChange) / 1.6),
          0,
          LEWITT_CONFIG.motifs.radialLinesMaxCount
        );
        if (count > 0) {
          if (collectPoints) {
            // Collect boundary intersection points for later connection
            const points = collectBoundaryPoints(cellX, cellY, cellW, cellH, count, rng);
            collectedPoints.push(...points);
          } else {
            // Draw point-symmetric lines through center
            drawPointSymmetricLines(g, cellX, cellY, cellW, cellH, count, rng, scale);
          }
        }
      }
    }
  }

  return collectedPoints;
}

/**
 * Filter and sort events based on configuration
 * Also marks events that are followed by a snapshot or preceded by ai_prompt
 */
export function prepareEvents(events, config = LEWITT_CONFIG) {
  // Sort all events by time first
  const sorted = [...events].sort((a, b) => (a.ts || 0) - (b.ts || 0));

  // Mark edit events that are followed by a snapshot
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].event === 'edit' && sorted[i + 1].event === 'snapshot') {
      sorted[i].hasSnapshotAfter = true;
    }
  }

  // Mark edit events that follow an ai_prompt, and attach prompt length
  // Track the current active ai_prompt and apply to subsequent AI edits
  let currentAiPromptLength = 0;
  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i];
    if (evt.event === 'ai_prompt' && evt.prompt) {
      // New ai_prompt - update the current prompt length
      currentAiPromptLength = evt.prompt.length || 0;
    } else if (evt.event === 'mode_change' && evt.to === 'human') {
      // Mode changed to human - reset the ai_prompt tracking
      currentAiPromptLength = 0;
    } else if (evt.event === 'edit' && evt.origin_mode === 'ai' && currentAiPromptLength > 0) {
      // AI edit following an ai_prompt - attach the prompt length
      evt.aiPromptLength = currentAiPromptLength;
    }
  }

  // Filter to edit events primarily, fall back to all if none
  let filtered = sorted.filter(e => e.event === 'edit');
  if (filtered.length === 0) {
    filtered = [...sorted];
  }

  // Sample if exceeds maxEvents
  if (filtered.length > config.maxEvents) {
    if (config.sampling === 'uniform') {
      const step = filtered.length / config.maxEvents;
      const sampled = [];
      for (let i = 0; i < config.maxEvents; i++) {
        sampled.push(filtered[Math.floor(i * step)]);
      }
      filtered = sampled;
    }
    // 'weighted' could prioritize high-severity events
  }

  // Sort based on order
  switch (config.order) {
    case 'time':
      filtered.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      break;
    case 'severity':
      filtered.sort((a, b) => (b.severity || 0) - (a.severity || 0));
      break;
    case 'type_blocks':
      const typeOrder = ['edit', 'snapshot', 'mode_change', 'policy_violation', 'session_start', 'session_pause', 'session_resume'];
      filtered.sort((a, b) => {
        const aIdx = typeOrder.indexOf(a.event);
        const bIdx = typeOrder.indexOf(b.event);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return (a.ts || 0) - (b.ts || 0);
      });
      break;
  }

  return filtered;
}

/**
 * Connect points using nearest neighbor algorithm
 */
function connectNearestNeighbor(g, points, weight, alpha, scale = 1) {
  if (points.length < 2) return;

  g.stroke(0, alpha);
  g.strokeWeight(Math.max(0.5, weight * scale));

  const drawn = new Set();

  // For each point, find its two nearest neighbors and draw lines
  for (let i = 0; i < points.length; i++) {
    const current = points[i];

    // Calculate distances to all other points
    const distances = [];
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const candidate = points[j];
      const dist = Math.sqrt(
        Math.pow(candidate.x - current.x, 2) +
        Math.pow(candidate.y - current.y, 2)
      );
      distances.push({ index: j, dist });
    }

    // Sort by distance and take the two nearest
    distances.sort((a, b) => a.dist - b.dist);
    const nearest = distances.slice(0, 2);

    for (const neighbor of nearest) {
      // Create a unique key for this edge (order independent)
      const minIdx = Math.min(i, neighbor.index);
      const maxIdx = Math.max(i, neighbor.index);
      const edgeKey = `${minIdx}-${maxIdx}`;

      // Only draw if we haven't drawn this edge yet
      if (!drawn.has(edgeKey)) {
        drawn.add(edgeKey);
        g.line(current.x, current.y, points[neighbor.index].x, points[neighbor.index].y);
      }
    }
  }
}

/**
 * Draw points as small dots
 */
function drawPoints(g, points, size, alpha, scale = 1) {
  g.fill(0, alpha);
  g.noStroke();

  const scaledSize = Math.max(2, size * scale);
  for (const point of points) {
    g.ellipse(point.x, point.y, scaledSize, scaledSize);
  }
}

/**
 * Main LeWitt drawing function
 * @param {boolean} usePointConnectionMode - If true, collect boundary points and connect them instead of drawing radial lines
 */
export function drawLeWittGrid(g, events, canvasWidth, canvasHeight, config = LEWITT_CONFIG, scale = 1, usePointConnectionMode = true) {
  const seed = config.seed || Date.now();
  const rng = new SeededRandom(seed);

  // Prepare events
  const preparedEvents = prepareEvents(events, config);

  // Calculate grid size
  const gridSize = calculateGridSize(preparedEvents.length, config);

  // Calculate drawing area (with margin)
  const margin = canvasWidth * config.marginRatio;
  const drawWidth = canvasWidth - 2 * margin;
  const drawHeight = canvasHeight - 2 * margin;

  // Cell dimensions
  const cellW = drawWidth / gridSize;
  const cellH = drawHeight / gridSize;

  // Set up graphics
  g.strokeCap(g.SQUARE);
  g.noFill();

  // Collect all boundary points for nearest neighbor connection
  const allBoundaryPoints = [];

  // Draw each cell using boustrophedon (serpentine) pattern
  // Time flows continuously but alternates direction each row
  let eventIdx = 0;
  for (let row = 0; row < gridSize; row++) {
    const isEvenRow = row % 2 === 0;
    for (let colIdx = 0; colIdx < gridSize; colIdx++) {
      // Even rows: left to right, Odd rows: right to left
      const col = isEvenRow ? colIdx : (gridSize - 1 - colIdx);
      const cellX = margin + col * cellW;
      const cellY = margin + row * cellH;

      const event = eventIdx < preparedEvents.length ? preparedEvents[eventIdx] : null;
      const cellPoints = drawCell(g, event, cellX, cellY, cellW, cellH, rng, scale, true);

      if (cellPoints.length > 0) {
        allBoundaryPoints.push(...cellPoints);
      }

      eventIdx++;
    }
  }

  // Draw points and connect them using nearest neighbor
  if (allBoundaryPoints.length > 0) {
    // Draw points
    drawPoints(g, allBoundaryPoints, 4, 200, scale);

    // Connect points using nearest neighbor
    connectNearestNeighbor(g, allBoundaryPoints, 1.2, 150, scale);
  }

  return {
    seed,
    gridSize,
    eventCount: preparedEvents.length,
    cellDimensions: { width: cellW, height: cellH },
    boundaryPointCount: allBoundaryPoints.length
  };
}

export { SeededRandom };
