/**
 * 全域標註工具 (js/annotation-tool.js)
 * 提供畫筆、Highlighter 螢光筆 (正片疊底)、橡皮擦、一鍵清空、文字標註與截圖匯出
 * 支援 iPad 觸控，並在繪圖時自動鎖定頁面滑動以確保筆跡對齊
 */
class AnnotationToolCore {
  constructor() {
    this.isActive = false;
    this.currentTool = 'pen'; // 'pen' | 'highlighter' | 'eraser'
    this.currentColor = '#000000';
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.textAnnotations = [];

    this.canvas = null;
    this.ctx = null;
    this.savedScrollY = 0;
  }

  // 自動注入 CSS 樣式
  injectStyles() {
    if (document.getElementById('annotation-tool-styles')) return;
    const style = document.createElement('style');
    style.id = 'annotation-tool-styles';
    style.textContent = `
      .annotation-canvas {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 9998;
        pointer-events: none;
        touch-action: none;
        mix-blend-mode: multiply;
      }
      
      /* 繪圖模式下鎖定網頁滑動 */
      body.annotation-locked {
        overflow: hidden !important;
        touch-action: none !important;
      }

      .annotation-fab {
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #2d5a27;
        color: #fff;
        border: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        cursor: pointer;
        z-index: 9999;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s ease;
      }
      .annotation-fab:hover { transform: scale(1.08); }
      
      .annotation-toolbar {
        position: fixed;
        bottom: 145px;
        right: 20px;
        background: #ffffff;
        border: 1px solid #e0e0e0;
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        display: none;
        flex-direction: column;
        gap: 8px;
        z-index: 9999;
        width: 175px;
      }
      .annotation-toolbar.active { display: flex; }
      
      .annotation-btn {
        padding: 8px 10px;
        border: none;
        border-radius: 6px;
        background: #2d5a27;
        color: white;
        font-weight: bold;
        cursor: pointer;
        font-size: 0.85rem;
        text-align: center;
        transition: all 0.2s ease;
      }
      .annotation-btn.active-mode {
        background: #c23b3b !important;
      }
      .annotation-btn.tool-active {
        outline: 2px solid #2d5a27;
        box-shadow: 0 0 6px rgba(0,0,0,0.2);
      }
      
      .color-palette {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }
      .color-option {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid #ccc;
      }
      .color-option.selected {
        border-color: #333;
        transform: scale(1.2);
      }
      
      .text-annotation {
        position: fixed;
        z-index: 9999;
        background: rgba(255, 255, 255, 0.95);
        border: 1px dashed #2d5a27;
        padding: 6px 10px;
        border-radius: 4px;
        min-width: 80px;
        outline: none;
        font-size: 1rem;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        cursor: move;
        touch-action: none;
      }
    `;
    document.head.appendChild(style);
  }

  injectUI() {
    if (document.getElementById('annotationCanvas')) return;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'annotationCanvas';
    this.canvas.className = 'annotation-canvas';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    const fab = document.createElement('button');
    fab.id = 'annotationFab';
    fab.className = 'annotation-fab';
    fab.title = '開啟標註工具';
    fab.innerHTML = '✏️';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'annotationPanel';
    panel.className = 'annotation-toolbar';
    panel.innerHTML = `
      <button id="toggleAnnotation" class="annotation-btn">開啟繪圖</button>
      <div class="color-palette">
        <div class="color-option selected" data-color="#000000" style="background: #000000"></div>
        <div class="color-option" data-color="#FFEB3B" style="background: #FFEB3B"></div>
        <div class="color-option" data-color="#FF5722" style="background: #FF5722"></div>
        <div class="color-option" data-color="#2196F3" style="background: #2196F3"></div>
        <div class="color-option" data-color="#4CAF50" style="background: #4CAF50"></div>
      </div>
      <button id="penBtn" class="annotation-btn tool-active" style="background:#e2e3e5; color:#1b1e21;">✏️ 劃線筆</button>
      <button id="highlightBtn" class="annotation-btn" style="background:#fff3cd; color:#856404;">🖍️ Highlighter</button>
      <button id="eraserBtn" class="annotation-btn" style="background:#e2e3e5; color:#383d41;">🧹 橡皮擦</button>
      <button id="clearBtn" class="annotation-btn" style="background:#f8d7da; color:#721c24;">🗑️ 清空畫布</button>
      <button id="textBtn" class="annotation-btn" style="background:#e2e3e5; color:#1b1e21;">📝 添加文字</button>
      <button id="exportBtn" class="annotation-btn" style="background:#2d5a27;">📸 導出截圖</button>
    `;
    document.body.appendChild(panel);
  }

  init() {
    this.injectStyles();
    this.injectUI();
    this.resizeCanvas();
    this.setupEventListeners();
    this.bindUIEvents();
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const width = window.innerWidth;
    const height = window.innerHeight;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      tempCanvas.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    this.canvas.width = width;
    this.canvas.height = height;

    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
      this.ctx.drawImage(tempCanvas, 0, 0);
    }
  }

  getPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.isActive) return;
      e.preventDefault();
      this.startDrawing(e);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isActive) return;
      e.preventDefault();
      this.draw(e);
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => this.stopDrawing());
  }

  bindUIEvents() {
    const fab = document.getElementById('annotationFab');
    const panel = document.getElementById('annotationPanel');
    const toggleBtn = document.getElementById('toggleAnnotation');
    const penBtn = document.getElementById('penBtn');
    const highlightBtn = document.getElementById('highlightBtn');
    const eraserBtn = document.getElementById('eraserBtn');

    if (fab && panel) {
      fab.addEventListener('click', () => panel.classList.toggle('active'));
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isActive = this.toggleMode();
        if (isActive) {
          toggleBtn.textContent = '退出標註';
          toggleBtn.classList.add('active-mode');
        } else {
          toggleBtn.textContent = '開啟繪圖';
          toggleBtn.classList.remove('active-mode');
        }
      });
    }

    const updateToolUI = (activeBtn) => {
      [penBtn, highlightBtn, eraserBtn].forEach(b => b?.classList.remove('tool-active'));
      activeBtn?.classList.add('tool-active');
    };

    document.querySelectorAll('.color-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectColor(e.target.dataset.color);
        if (this.currentTool === 'eraser') {
          this.currentTool = 'pen';
          updateToolUI(penBtn);
        }
        document.querySelectorAll('.color-option').forEach(b => 
          b.classList.toggle('selected', b === e.target)
        );
      });
    });

    penBtn?.addEventListener('click', () => {
      this.currentTool = 'pen';
      updateToolUI(penBtn);
    });

    highlightBtn?.addEventListener('click', () => {
      this.currentTool = 'highlighter';
      updateToolUI(highlightBtn);
    });

    eraserBtn?.addEventListener('click', () => {
      this.currentTool = 'eraser';
      updateToolUI(eraserBtn);
    });

    document.getElementById('clearBtn')?.addEventListener('click', () => {
      if (confirm('確定要清空所有畫筆與備註嗎？')) {
        this.clearAll();
      }
    });

    document.getElementById('textBtn')?.addEventListener('click', () => {
      if (!this.isActive) toggleBtn.click();
      this.addTextAnnotation();
    });

    document.getElementById('exportBtn')?.addEventListener('click', () => {
      this.exportScreenshot()
        .then(dataUrl => {
          this.saveToProgressReport(dataUrl);
          const link = document.createElement('a');
          link.download = '教材標註-' + new Date().toISOString().slice(0, 10) + '.png';
          link.href = dataUrl;
          link.click();
        })
        .catch(err => alert('截圖導出失敗: ' + err.message));
    });
  }

  saveToProgressReport(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const maxW = 1400, maxH = 1000;
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const compressed = canvas.toDataURL('image/jpeg', .82);
      const key = 'learning.progress.images.v1';
      try {
        const saved = JSON.parse(localStorage.getItem(key) || '[]');
        const images = Array.isArray(saved) ? saved : [];
        images.push({
          id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl: compressed,
          caption: document.title || 'Annotation',
          createdAt: new Date().toISOString(),
          source: 'annotation-tool'
        });
        localStorage.setItem(key, JSON.stringify(images.slice(-8)));
      } catch (_) { /* 空間不足時仍照常下載圖片，不影響原本功能 */ }
    };
    img.src = dataUrl;
  }

  startDrawing(e) {
    if (!this.isActive) return;
    this.isDrawing = true;
    const pos = this.getPos(e);
    this.startX = pos.x;
    this.startY = pos.y;

    this.ctx.beginPath();
    this.ctx.moveTo(this.startX, this.startY);
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;
    const pos = this.getPos(e);

    if (this.currentTool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.lineWidth = 30;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    } else if (this.currentTool === 'highlighter') {
      this.ctx.globalCompositeOperation = 'source-over';
      const color = (this.currentColor === '#000000') ? '#FFEB3B' : this.currentColor; 
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 22;
      this.ctx.lineCap = 'square';
      this.ctx.lineJoin = 'miter';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = this.currentColor;
      this.ctx.lineWidth = 3;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    }
  }

  stopDrawing() {
    this.isDrawing = false;
    if (this.ctx) {
      this.ctx.globalCompositeOperation = 'source-over';
    }
  }

  toggleMode() {
    this.isActive = !this.isActive;
    this.canvas.style.pointerEvents = this.isActive ? 'auto' : 'none';

    // 控制網頁滑動鎖定
    if (this.isActive) {
      document.body.classList.add('annotation-locked');
    } else {
      document.body.classList.remove('annotation-locked');
    }

    return this.isActive;
  }

  selectColor(color) {
    this.currentColor = color;
  }

  clearAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.textAnnotations.forEach(el => el.remove());
    this.textAnnotations = [];
  }

  addTextAnnotation() {
    const textDiv = document.createElement('div');
    textDiv.className = 'text-annotation';
    textDiv.textContent = '點擊輸入備註';
    textDiv.contentEditable = true;

    textDiv.style.left = `${window.innerWidth * 0.3 + Math.random() * 30}px`;
    textDiv.style.top = `${window.innerHeight * 0.3 + Math.random() * 30}px`;

    this.setupDraggable(textDiv);
    document.body.appendChild(textDiv);
    this.textAnnotations.push(textDiv);

    setTimeout(() => textDiv.focus(), 0);
  }

  setupDraggable(element) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const startDrag = (e) => {
      if (document.activeElement === element) return;
      isDragging = true;
      const pos = this.getPos(e);
      offsetX = pos.x - element.getBoundingClientRect().left;
      offsetY = pos.y - element.getBoundingClientRect().top;
      e.stopPropagation();
    };

    const moveDrag = (e) => {
      if (isDragging) {
        const pos = this.getPos(e);
        element.style.left = `${pos.x - offsetX}px`;
        element.style.top = `${pos.y - offsetY}px`;
      }
    };

    const stopDrag = () => { isDragging = false; };

    element.addEventListener('mousedown', startDrag);
    element.addEventListener('touchstart', startDrag, { passive: false });

    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });

    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
  }

  exportScreenshot() {
    return new Promise((resolve, reject) => {
      if (typeof html2canvas === 'undefined') {
        reject(new Error('未找到 html2canvas 套件'));
        return;
      }

      html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scale: 1,
        ignoreElements: (element) => {
          return element.id === 'annotationFab' || element.id === 'annotationPanel';
        }
      }).then(pageCanvas => {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = window.innerWidth;
        exportCanvas.height = window.innerHeight;
        const exportCtx = exportCanvas.getContext('2d');

        exportCtx.drawImage(pageCanvas, 0, 0);
        exportCtx.globalCompositeOperation = 'multiply';
        exportCtx.drawImage(this.canvas, 0, 0);

        resolve(exportCanvas.toDataURL('image/png'));
      }).catch(reject);
    });
  }
}

const AnnotationTool = {
  instance: null,
  mount() {
    if (!this.instance) {
      this.instance = new AnnotationToolCore();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.instance.init());
    } else {
      this.instance.init();
    }
  }
};

window.AnnotationTool = AnnotationTool;
