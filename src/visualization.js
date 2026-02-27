import { colors, CANVAS_WIDTH, CANVAS_HEIGHT, sizes, CURRENT_PAPER_SIZE, SCALE_FACTOR, TILE_CONFIG, PAPER_SIZES, LEWITT_CONFIG } from './config.js';
import { parseJsonl, generateSummary, generateInstructions } from './helpers.js';
import { drawLeWittGrid, prepareEvents, calculateGridSize } from './lewitt.js';

// State
let events = [];
let warnings = [];
let sessionId = '';
let summary = null;

// Exported events for tile rendering
export function getEvents() {
  return events;
}

export function getSummary() {
  return summary;
}

export function getSessionId() {
  return sessionId;
}

/**
 * Load JSONL data before p5 initialization
 */
export async function loadData() {
  try {
    const response = await fetch('/.craftlog/merged.jsonl');
    const jsonlText = await response.text();
    const parsed = parseJsonl(jsonlText);
    events = parsed.events;
    warnings = parsed.warnings;
    sessionId = parsed.sessionId;

    // Generate summary
    summary = generateSummary(events, sessionId);

    console.log(`Loaded ${events.length} events (${warnings.length} warnings)`);
    if (warnings.length > 0) {
      console.warn('Parse warnings:', warnings);
    }
  } catch (error) {
    console.error('Failed to load JSONL:', error);
  }
}

/**
 * Main p5.js sketch factory (instance mode) - LeWitt style
 */
export function createVisualization(p) {
  let drawResult = null;

  p.setup = function() {
    p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    p.pixelDensity(1);
    p.noLoop();

    // Set random seeds
    const seed = LEWITT_CONFIG.seed || Date.now();
    p.randomSeed(seed);
    p.noiseSeed(seed);
  };

  p.draw = function() {
    p.background(colors.background);

    // Draw LeWitt grid
    drawResult = drawLeWittGrid(p, events, CANVAS_WIDTH, CANVAS_HEIGHT, LEWITT_CONFIG);

    console.log(`Drew grid: ${drawResult.gridSize}x${drawResult.gridSize}, ${drawResult.eventCount} events, seed: ${drawResult.seed}`);
  };
}

/**
 * Render 8 B4 tiles and combine them into a B1-sized image using LeWitt style
 * Returns a promise that resolves to the combined canvas
 */
export async function renderB1Tiles(p, progressCallback) {
  const { cols, rows, tileWidth, tileHeight, finalWidth, finalHeight } = TILE_CONFIG;

  // Create the final combined canvas
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = finalWidth;
  finalCanvas.height = finalHeight;
  const finalCtx = finalCanvas.getContext('2d');

  // Enable high quality image smoothing
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';

  // Fill with background
  finalCtx.fillStyle = colors.background;
  finalCtx.fillRect(0, 0, finalWidth, finalHeight);

  // Calculate scale factor (final size vs current preview size)
  const scaleX = finalWidth / CANVAS_WIDTH;
  const scaleY = finalHeight / CANVAS_HEIGHT;
  const scale = Math.max(scaleX, scaleY);

  // Render each tile
  const totalTiles = cols * rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tileIndex = row * cols + col;

      if (progressCallback) {
        progressCallback(tileIndex + 1, totalTiles);
      }

      // Create off-screen graphics for this tile with high pixel density
      const tileGraphics = p.createGraphics(tileWidth, tileHeight);
      tileGraphics.pixelDensity(2); // High resolution rendering

      // Calculate the viewport offset for this tile
      const offsetX = col * tileWidth;
      const offsetY = row * tileHeight;

      // Render the tile with LeWitt style
      renderLeWittTile(tileGraphics, offsetX, offsetY, finalWidth, finalHeight, scale);

      // Draw tile to final canvas (scale down from 2x to 1x)
      finalCtx.drawImage(
        tileGraphics.canvas,
        0, 0, tileWidth * 2, tileHeight * 2,  // source (2x pixel density)
        offsetX, offsetY, tileWidth, tileHeight  // destination
      );

      // Clean up
      tileGraphics.remove();

      // Allow UI to update
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  return finalCanvas;
}

/**
 * Render a single tile with LeWitt style
 */
function renderLeWittTile(g, offsetX, offsetY, fullWidth, fullHeight, scale) {
  // Background
  g.background(colors.background);

  // Translate to render the correct portion of the full image
  g.push();
  g.translate(-offsetX, -offsetY);

  // Draw the LeWitt grid at full scale
  drawLeWittGrid(g, events, fullWidth, fullHeight, {
    ...LEWITT_CONFIG,
    seed: LEWITT_CONFIG.seed || 12345 // Use consistent seed
  }, scale);

  g.pop();
}

/**
 * Generate and download instructions.txt
 */
export function downloadInstructions() {
  const config = {
    sessionId,
    seed: LEWITT_CONFIG.seed || Date.now(),
    preset: LEWITT_CONFIG.preset,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    marginRatio: LEWITT_CONFIG.marginRatio,
    gridSize: calculateGridSize(prepareEvents(events, LEWITT_CONFIG).length, LEWITT_CONFIG),
    order: LEWITT_CONFIG.order,
    maxEvents: LEWITT_CONFIG.maxEvents,
    sampling: LEWITT_CONFIG.sampling
  };

  const instructions = generateInstructions(config, summary, events);

  const blob = new Blob([instructions], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `instructions_${sessionId}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate and download summary.json
 */
export function downloadSummary() {
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `summary_${sessionId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

