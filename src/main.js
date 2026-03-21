import p5 from 'p5';
import {
  loadData,
  createLayerVisualization,
  createSeparatedVisualization,
  renderFull30cm,
  renderSeparated30cm,
} from './visualization.js';

let p5Instance = null;
let currentView = 'combined'; // 'combined' | 'separated'

loadData().then(() => {
  const container = document.getElementById('canvas-container');
  p5Instance = new p5(createLayerVisualization, container);

  setupViewToggle();
  setupExportButtons();
});

function setupViewToggle() {
  const combinedBtn = document.getElementById('view-combined-btn');
  const separatedBtn = document.getElementById('view-separated-btn');

  if (combinedBtn) {
    combinedBtn.addEventListener('click', () => {
      if (currentView === 'combined') return;
      currentView = 'combined';
      switchView(createLayerVisualization);
      combinedBtn.classList.add('active');
      separatedBtn.classList.remove('active');
    });
  }

  if (separatedBtn) {
    separatedBtn.addEventListener('click', () => {
      if (currentView === 'separated') return;
      currentView = 'separated';
      switchView(createSeparatedVisualization);
      separatedBtn.classList.add('active');
      combinedBtn.classList.remove('active');
    });
  }
}

function switchView(vizFactory) {
  const container = document.getElementById('canvas-container');
  if (p5Instance) {
    p5Instance.remove();
  }
  p5Instance = new p5(vizFactory, container);
}

function setupExportButtons() {
  const saveBtn = document.getElementById('save-png-btn');
  const exportCombinedBtn = document.getElementById('export-combined-btn');
  const exportLayersBtn = document.getElementById('export-layers-btn');
  const progressDiv = document.getElementById('render-progress');

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (p5Instance) {
        p5Instance.saveCanvas('preview', 'png');
      }
    });
  }

  if (exportCombinedBtn) {
    exportCombinedBtn.addEventListener('click', async () => {
      exportCombinedBtn.disabled = true;
      progressDiv.style.display = 'block';
      progressDiv.textContent = 'Rendering 30cm combined...';

      try {
        const canvas = await renderFull30cm(p5Instance);
        downloadCanvas(canvas, 'combined_30cm_300dpi.png');
        progressDiv.textContent = 'Done!';
      } catch (err) {
        progressDiv.textContent = 'Error: ' + err.message;
        console.error(err);
      }

      setTimeout(() => {
        progressDiv.style.display = 'none';
        exportCombinedBtn.disabled = false;
      }, 2000);
    });
  }

  if (exportLayersBtn) {
    exportLayersBtn.addEventListener('click', async () => {
      exportLayersBtn.disabled = true;
      progressDiv.style.display = 'block';

      try {
        progressDiv.textContent = 'Rendering separated layers...';
        const canvas = await renderSeparated30cm(p5Instance);
        downloadCanvas(canvas, 'layers_separated_30cm_300dpi.png');
        progressDiv.textContent = 'Layers exported!';
      } catch (err) {
        progressDiv.textContent = 'Error: ' + err.message;
        console.error(err);
      }

      setTimeout(() => {
        progressDiv.style.display = 'none';
        exportLayersBtn.disabled = false;
      }, 2000);
    });
  }
}

function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png');
}
