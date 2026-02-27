// Color palette
export const colors = {
  background: '#ffffff',
  session_start: '#000000',
  session_pause: '#000000',
  session_resume: '#000000',
  snapshot: '#000000',
  timeline: '#cccccc',
  text: '#000000',
  accent: '#000000',
  // LeWitt special colors
  policy_violation: '#ff0000',
  policy_violation_fill: 'rgba(255, 0, 0, 0.08)'
};

// Paper sizes at 300 DPI (in pixels)
export const PAPER_SIZES = {
  B6: { width: 1512, height: 2150 },   // 128mm × 182mm
  B5: { width: 2150, height: 3035 },   // 182mm × 257mm
  B4: { width: 3035, height: 4299 },   // 257mm × 364mm
  B3: { width: 4299, height: 6071 },   // 364mm × 514mm
  B2: { width: 6071, height: 8598 },   // 514mm × 728mm
  B1: { width: 8598, height: 12165 },  // 728mm × 1030mm
  B0: { width: 12165, height: 17197 }, // 1030mm × 1456mm
};

// Tile configuration for B1 rendering (8 B4 tiles)
export const TILE_CONFIG = {
  targetSize: 'B1',
  tileSize: 'B4',
  cols: 2,  // 2 columns
  rows: 4,  // 4 rows
  // Each tile is B4 rotated (landscape): 4299 × 3035
  tileWidth: PAPER_SIZES.B4.height,   // 4299px (364mm)
  tileHeight: PAPER_SIZES.B4.width,   // 3035px (257mm)
  // Final combined size: 8598 × 12140 (close to B1)
  get finalWidth() { return this.tileWidth * this.cols; },
  get finalHeight() { return this.tileHeight * this.rows; }
};

// Current paper size setting (change this to resize)
export const CURRENT_PAPER_SIZE = 'B6';

// Canvas dimensions (derived from paper size)
export const CANVAS_WIDTH = PAPER_SIZES[CURRENT_PAPER_SIZE].width;
export const CANVAS_HEIGHT = PAPER_SIZES[CURRENT_PAPER_SIZE].height;

// Base reference size (B1) for proportional scaling
const REFERENCE_WIDTH = PAPER_SIZES.B1.width;

// Scale factor relative to B1 size
export const SCALE_FACTOR = CANVAS_WIDTH / REFERENCE_WIDTH;

// Proportional sizes (relative to canvas)
export const sizes = {
  // Grid line weight (0.05% of canvas width)
  gridLineWeight: Math.max(1, Math.round(CANVAS_WIDTH * 0.0005)),

  // Point sizes (0.5% and 0.7% of canvas width)
  pointSize: Math.max(4, Math.round(CANVAS_WIDTH * 0.005)),
  pointSizeLarge: Math.max(6, Math.round(CANVAS_WIDTH * 0.007)),

  // Connection line weight (0.1% of canvas width)
  lineWeight: Math.max(1, Math.round(CANVAS_WIDTH * 0.001)),

  // Text sizes
  textSizeLarge: Math.max(10, Math.round(CANVAS_WIDTH * 0.005)),
  textSizeSmall: Math.max(8, Math.round(CANVAS_WIDTH * 0.004)),

  // Legend indicator sizes
  legendSmall: Math.max(4, Math.round(CANVAS_WIDTH * 0.004)),
  legendMedium: Math.max(6, Math.round(CANVAS_WIDTH * 0.005)),
  legendLarge: Math.max(8, Math.round(CANVAS_WIDTH * 0.006)),
};

// LeWitt Grid Hatch preset configuration
export const LEWITT_CONFIG = {
  // Default preset
  preset: 'lewitt_grid_hatch_p5',

  // Canvas
  marginRatio: 0.05,  // 5% margin

  // Grid
  maxEvents: 530,
  sampling: 'uniform',  // 'uniform' | 'weighted'
  order: 'time',        // 'time' | 'severity' | 'type_blocks'
  minGridSize: 5,
  maxGridSize: 27,

  // Hatching
  hatching: {
    // Angle rules (degrees)
    angles: {
      edit_human: 45,
      edit_ai: 135,
      snapshot: 0,
      mode_change: 90,
      policy_violation: [45, 135],  // cross-hatch
      default: [0, 45, 90, 135]     // hash-based selection
    },
    // Spacing range (pixels) - lerp(max, min, severity)
    spacingMin: 4,
    spacingMax: 18,
    spacingClampMin: 3,
    spacingClampMax: 24,
    // Stroke weight range - lerp(min, max, severity)
    weightMin: 0.6,
    weightMax: 3.0,
    policyViolationWeightBonus: 1.0,
    // Alpha range - lerp(min, max, severity)
    alphaMin: 40,
    alphaMax: 200,
    // Cell border
    cellBorderWeight: 0.5,
    cellBorderAlpha: 25
  },

  // Special motifs
  motifs: {
    // Radial lines for added_chars
    radialLinesMaxCount: 12,
    radialLinesMinLength: 0.05,  // fraction of cell size
    radialLinesMaxLength: 0.35,
    // Undo perpendicular line
    undoLineAlpha: 80,
    // Paste thick line
    pasteLineWeightMultiplier: 2.5
  },

  // Random seed (0 = use timestamp)
  seed: 0
};
