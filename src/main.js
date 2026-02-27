import p5 from 'p5';
import { createVisualization, loadData, renderB1Tiles, downloadInstructions, downloadSummary } from './visualization.js';
import { TILE_CONFIG } from './config.js';

let p5Instance = null;

// Load data first, then create p5.js instance in container
loadData().then(() => {
  const container = document.getElementById('canvas-container');
  p5Instance = new p5(createVisualization, container);

  // Setup buttons
  setupB1RenderButton();
  setupDownloadButtons();
});

/**
 * Setup the B1 tile rendering button
 */
function setupB1RenderButton() {
  const button = document.getElementById('render-b1-btn');
  const progressDiv = document.getElementById('render-progress');

  if (!button) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Rendering...';
    progressDiv.style.display = 'block';
    progressDiv.textContent = 'Preparing tiles...';

    try {
      // Render tiles with progress callback
      const finalCanvas = await renderB1Tiles(p5Instance, (current, total) => {
        progressDiv.textContent = `Rendering tile ${current} / ${total}...`;
      });

      progressDiv.textContent = 'Combining tiles...';

      // Convert to blob and download
      finalCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `craftlog_B1_${TILE_CONFIG.cols}x${TILE_CONFIG.rows}_tiles.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        progressDiv.textContent = 'Done! Image saved.';
        setTimeout(() => {
          progressDiv.style.display = 'none';
          button.disabled = false;
          button.textContent = 'Render B1 (8 tiles)';
        }, 2000);
      }, 'image/png');

    } catch (error) {
      console.error('Error rendering tiles:', error);
      progressDiv.textContent = 'Error: ' + error.message;
      button.disabled = false;
      button.textContent = 'Render B1 (8 tiles)';
    }
  });
}

/**
 * Setup download buttons for instructions and summary
 */
function setupDownloadButtons() {
  const instructionsBtn = document.getElementById('download-instructions-btn');
  const summaryBtn = document.getElementById('download-summary-btn');
  const saveBtn = document.getElementById('save-png-btn');

  if (instructionsBtn) {
    instructionsBtn.addEventListener('click', () => {
      downloadInstructions();
    });
  }

  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      downloadSummary();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (p5Instance) {
        p5Instance.saveCanvas('craftlog_lewitt_visualization', 'png');
      }
    });
  }
}
