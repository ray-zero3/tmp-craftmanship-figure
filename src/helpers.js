import { colors } from './config.js';

/**
 * Clamp value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Simple hash function for strings
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Calculate severity for an event (0..1)
 */
export function calculateSeverity(event) {
  // policy_violation -> 1.0
  if (event.event === 'policy_violation') {
    return 1.0;
  }

  // edit events with flags
  if (event.event === 'edit') {
    const flags = event.flags || {};

    if (flags.is_undo_like) return 0.15;
    if (flags.is_redo_like) return 0.25;
    if (flags.is_paste_like) return 0.85;

    // Based on change amount
    const delta = event.delta || {};
    const chars = (delta.added_chars || 0) + (delta.deleted_chars || 0);
    // sqrt(log1p) with higher reference for more gradual saturation
    // Higher REF value + sqrt = more spread in high-edit areas
    const REF = 30000;
    const normalized = Math.log1p(chars) / Math.log1p(REF);
    const severity = clamp(Math.sqrt(normalized), 0, 1);
    return Math.max(0.1, severity); // minimum 0.1 for edits
  }

  // snapshot/session_*/mode_change -> 0.2~0.4
  if (event.event === 'snapshot') return 0.2;
  if (event.event === 'session_start') return 0.4;
  if (event.event === 'session_pause') return 0.3;
  if (event.event === 'session_resume') return 0.35;
  if (event.event === 'mode_change') return 0.3;

  // default
  return 0.5;
}

/**
 * Normalize a raw event to standard structure
 */
export function normalizeEvent(raw) {
  return {
    ts: raw.ts,
    elapsed_ms: raw.elapsed_ms ?? null,
    event: raw.event,
    origin_mode: raw.origin_mode ?? null,
    kind: raw.kind ?? null,
    file_path: raw.file?.path ?? null,
    lang: raw.file?.lang ?? null,
    delta: raw.delta ? {
      added_chars: raw.delta.added_chars || 0,
      deleted_chars: raw.delta.deleted_chars || 0,
      added_lines: raw.delta.added_lines || 0,
      deleted_lines: raw.delta.deleted_lines || 0
    } : null,
    flags: raw.flags ? {
      is_paste_like: raw.flags.is_paste_like || false,
      is_undo_like: raw.flags.is_undo_like || false,
      is_redo_like: raw.flags.is_redo_like || false
    } : null,
    detail: raw.detail ?? null,
    session_id: raw.session_id ?? null,
    workspace_id: raw.workspace_id ?? null,
    raw: raw
  };
}

/**
 * Parse JSONL data with proper normalization and severity calculation
 * @returns {{ events: NormalizedEvent[], warnings: string[], sessionId: string }}
 */
export function parseJsonl(jsonlText) {
  const lines = jsonlText.trim().split('\n');
  const events = [];
  const warnings = [];
  let sessionId = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const raw = JSON.parse(line);
      const normalized = normalizeEvent(raw);
      normalized.severity = calculateSeverity(normalized);
      events.push(normalized);

      if (!sessionId && raw.session_id) {
        sessionId = raw.session_id;
      }
    } catch (e) {
      warnings.push(`Line ${i + 1}: Parse error - ${e.message}`);
    }
  }

  return { events, warnings, sessionId };
}

/**
 * Generate summary statistics from events
 */
export function generateSummary(events, sessionId) {
  const summary = {
    session_id: sessionId,
    counts: {
      by_event: {},
      by_origin_mode: {},
      by_lang: {},
      by_file_path_top10: []
    },
    edits: {
      added_chars: { total: 0, mean: 0, max: 0 },
      deleted_chars: { total: 0, mean: 0, max: 0 }
    },
    policy_violation: {
      count: 0,
      kinds: {}
    },
    time_span: {
      min_ts: null,
      max_ts: null,
      duration_ms: 0
    },
    total_events: events.length
  };

  const filePathCounts = {};
  let editCount = 0;

  for (const e of events) {
    // by_event
    summary.counts.by_event[e.event] = (summary.counts.by_event[e.event] || 0) + 1;

    // by_origin_mode
    if (e.origin_mode) {
      summary.counts.by_origin_mode[e.origin_mode] = (summary.counts.by_origin_mode[e.origin_mode] || 0) + 1;
    }

    // by_lang
    if (e.lang) {
      summary.counts.by_lang[e.lang] = (summary.counts.by_lang[e.lang] || 0) + 1;
    }

    // by_file_path
    if (e.file_path) {
      filePathCounts[e.file_path] = (filePathCounts[e.file_path] || 0) + 1;
    }

    // edits
    if (e.event === 'edit' && e.delta) {
      editCount++;
      summary.edits.added_chars.total += e.delta.added_chars;
      summary.edits.deleted_chars.total += e.delta.deleted_chars;
      summary.edits.added_chars.max = Math.max(summary.edits.added_chars.max, e.delta.added_chars);
      summary.edits.deleted_chars.max = Math.max(summary.edits.deleted_chars.max, e.delta.deleted_chars);
    }

    // policy_violation
    if (e.event === 'policy_violation') {
      summary.policy_violation.count++;
      if (e.kind) {
        summary.policy_violation.kinds[e.kind] = (summary.policy_violation.kinds[e.kind] || 0) + 1;
      }
    }

    // time_span
    if (e.ts) {
      if (summary.time_span.min_ts === null || e.ts < summary.time_span.min_ts) {
        summary.time_span.min_ts = e.ts;
      }
      if (summary.time_span.max_ts === null || e.ts > summary.time_span.max_ts) {
        summary.time_span.max_ts = e.ts;
      }
    }
  }

  // Calculate means
  if (editCount > 0) {
    summary.edits.added_chars.mean = Math.round(summary.edits.added_chars.total / editCount);
    summary.edits.deleted_chars.mean = Math.round(summary.edits.deleted_chars.total / editCount);
  }

  // Calculate duration
  if (summary.time_span.min_ts && summary.time_span.max_ts) {
    summary.time_span.duration_ms = summary.time_span.max_ts - summary.time_span.min_ts;
  }

  // Top 10 file paths
  summary.counts.by_file_path_top10 = Object.entries(filePathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return summary;
}

/**
 * Generate instructions text (LeWitt style)
 */
export function generateInstructions(config, summary, events) {
  const { sessionId, seed, preset, canvasWidth, canvasHeight, marginRatio, gridSize, order, maxEvents, sampling } = config;

  const editEvents = events.filter(e => e.event === 'edit');
  const humanEdits = editEvents.filter(e => e.origin_mode === 'human').length;
  const aiEdits = editEvents.filter(e => e.origin_mode === 'ai').length;

  return `WALL DRAWING (CRAFTLOG)
Session: ${sessionId}
Preset: ${preset}
Seed: ${seed}

CANVAS
------
Dimensions: ${canvasWidth} × ${canvasHeight} pixels
Margin ratio: ${marginRatio * 100}%
Drawing area: inner ${Math.round(canvasWidth * (1 - 2 * marginRatio))} × ${Math.round(canvasHeight * (1 - 2 * marginRatio))} pixels

GRID
----
Grid: ${gridSize} × ${gridSize} cells
Cell assignment order: ${order}
Maximum events: ${maxEvents}
Sampling method: ${sampling}

HATCHING RULES
--------------
Each cell contains parallel lines (hatching). Parameters determined by log data:

Direction (angle) by event and origin_mode:
  - edit + human     → 45°
  - edit + ai        → 135°
  - snapshot         → 0° (horizontal)
  - mode_change      → 90° (vertical)
  - policy_violation → 45° + 135° (cross-hatch)
  - other            → hash(event) % 4 × 45°

Density (spacing) by severity:
  spacing = lerp(18, 4, severity) pixels
  (higher severity = denser lines)
  Range: 3px to 24px

Stroke weight by severity:
  weight = lerp(0.6, 3.0, severity)
  policy_violation: +1.0

Stroke alpha by severity:
  alpha = lerp(40, 200, severity)

SPECIAL RULES
-------------
- policy_violation: Red fill (255,0,0,20), then cross-hatch
- undo_like flag: One perpendicular line (cancellation mark)
- paste_like flag: One thick line (block indicator)
- edit added_chars: Radial lines from center
  count = clamp(round(log1p(added_chars)/1.6), 0, 12)

STATISTICS
----------
Total events: ${summary.total_events}
Edit events: ${editEvents.length} (human: ${humanEdits}, ai: ${aiEdits})
Snapshots: ${summary.counts.by_event['snapshot'] || 0}
Policy violations: ${summary.policy_violation.count}
Session duration: ${Math.round(summary.time_span.duration_ms / 1000 / 60)} minutes
Added chars (total/mean/max): ${summary.edits.added_chars.total} / ${summary.edits.added_chars.mean} / ${summary.edits.added_chars.max}
Deleted chars (total/mean/max): ${summary.edits.deleted_chars.total} / ${summary.edits.deleted_chars.mean} / ${summary.edits.deleted_chars.max}

RANDOM SEED
-----------
Seed: ${seed}
All randomness derived from this seed for reproducibility.
Micro-jitter (≤1px) permitted per seed.

---
Generated: ${new Date().toISOString()}
`;
}

/**
 * Get color for event type (legacy support)
 */
export function getEventColor(eventType) {
  switch (eventType) {
    case 'session_start': return colors.session_start;
    case 'session_pause': return colors.session_pause;
    case 'session_resume': return colors.session_resume;
    case 'snapshot': return colors.snapshot;
    default: return colors.text;
  }
}

/**
 * Format milliseconds to readable time
 */
export function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Draw star shape (legacy)
 */
export function drawStar(p, x, y, radius1, radius2, npoints) {
  const angle = p.TWO_PI / npoints;
  const halfAngle = angle / 2.0;

  p.beginShape();
  for (let a = -p.PI / 2; a < p.TWO_PI - p.PI / 2; a += angle) {
    let sx = x + p.cos(a) * radius1;
    let sy = y + p.sin(a) * radius1;
    p.vertex(sx, sy);
    sx = x + p.cos(a + halfAngle) * radius2;
    sy = y + p.sin(a + halfAngle) * radius2;
    p.vertex(sx, sy);
  }
  p.endShape(p.CLOSE);
}

/**
 * Draw triangle shape (legacy)
 */
export function drawTriangle(p, x, y, size) {
  p.beginShape();
  p.vertex(x, y - size / 2);
  p.vertex(x + size / 2, y + size / 2);
  p.vertex(x - size / 2, y + size / 2);
  p.endShape(p.CLOSE);
}
