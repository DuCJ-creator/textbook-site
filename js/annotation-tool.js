/**
 * 全域標註工具 (js/annotation-tool.js)
 * 提供畫筆、螢光筆、橡皮擦、一鍵清空、文字標註與截圖匯出功能
 */
class AnnotationToolCore {
  constructor() {
    this.isActive = false;
    this.currentTool = 'pen'; // 'pen' | 'eraser'
    this.currentColor = '#000000';
    this.isHighlight = false;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.textAnnotations = [];

    this.canvas = null;
    this.ctx = null;
  }

  // 自動注入所需的 CSS 樣式
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
        width: 165px;
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
        box-shadow: 0 0 0 2px #2d5a27;
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
        border: 2px solid transparent;
      }
      .color-option.selected {
        border-color: #333;
        transform: scale(1.15);
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
      }
    `;
    document.head.appendChild(style);
  }

  // 自動建立 UI HTML 結構
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
        <div class="color-option" data-color="#FF0000" style="background: #FF0000"></div>
        <div class="color-option" data-color="#0000FF" style="background: #0000FF"></div>
        <div class="color-option" data-color="#00FF00" style="background: #00FF00"></div>
      </div>
      <button id="highlightBtn" class="annotation-btn" style="background:#fff3cd; color:#856404;">螢光筆</button>
      <button id="eraserBtn" class="annotation-btn" style="background:#e2e3e5; color:#383d41;">🧹 橡皮擦</button>
      <button id="clearBtn" class="annotation-btn" style="background:#f8d7da; color:#721c24;">🗑️ 清空畫布</button>
      <button id="textBtn" class="annotation-btn" style="background:#e2e3e5; color:#1b1e21;">添加文字</button>
      <button id="exportBtn" class="annotation-btn" style="background:#2d5a27;">導出截圖</button>
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

  setupEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseleave', () => this.stopDrawing());
  }

  bindUIEvents() {
    const fab = document.getElementById('annotationFab');
    const panel = document.getElementById('annotationPanel');
    const toggleBtn = document.getElementById('toggleAnnotation');
    const eraserBtn = document.getElementById('eraserBtn');
    const highlightBtn = document.getElementById('highlightBtn');

    if (fab && panel) {
      fab.addEventListener('click', () => {
        panel.classList.toggle('active');
      });
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

    // 顏色選擇
    document.querySelectorAll('.color-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectColor(e.target.dataset.color);
        this.currentTool = 'pen';
        eraserBtn?.classList.remove('tool-active');
        document.querySelectorAll('.color-option').forEach(b => 
          b.classList.toggle('selected', b === e.target)
        );
      });
    });

    // 螢光筆
    highlightBtn?.addEventListener('click', () => {
      this.currentTool = 'pen';
      eraserBtn?.classList.remove('tool-active');
      const isHighlight = this.toggleHighlight();
      highlightBtn.style.outline = isHighlight ? '2px solid #856404' : 'none';
    });

    // 橡皮擦切換
    eraserBtn?.addEventListener('click', () => {
      if (this.currentTool === 'eraser') {
        this.currentTool = 'pen';
        eraserBtn.classList.remove('tool-active');
      } else {
        this.currentTool = 'eraser';
        eraserBtn.classList.add('tool-active');
      }
    });

    // 清空畫布
    document.getElementById('clearBtn')?.addEventListener('click', () => {
      if (confirm('確定要清空所有畫筆與備註嗎？')) {
        this.clearAll();
      }
    });

    // 添加文字
    document.getElementById('textBtn')?.addEventListener('click', () => {
      if (!this.isActive) {
        toggleBtn.click();
      }
      this.addTextAnnotation();
    });

    // 導出截圖
    document.getElementById('exportBtn')?.addEventListener('click', () => {
      this.exportScreenshot()
        .then(dataUrl => {
          const link = document.createElement('a');
          link.download = '教材標註-' + new Date().toISOString().slice(0, 10) + '.png';
          link.href = dataUrl;
          link.click();
        })
        .catch(err => {
          console.error('導出失敗:', err);
          alert('截圖導出失敗: ' + err.message);
        });
    });
  }

  startDrawing(e) {
    if (!this.isActive) return;
    this.isDrawing = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    this.ctx.beginPath();
    this.ctx.moveTo(this.startX, this.startY);
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;

    if (this.currentTool === 'eraser') {
      // 使用 destination-out 擦除畫布上已畫的內容
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.lineWidth = 28;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(e.clientX, e.clientY);
      this.ctx.stroke();
    } else {
      // 正常繪畫模式
      this.ctx.globalCompositeOperation = 'source-over';
      const strokeColor = this.isHighlight ? this.currentColor + '80' : this.currentColor;
      const lineWidth = this.isHighlight ? 16 : 3;

      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(e.clientX, e.clientY);
      this.ctx.stroke();
    }
  }

  stopDrawing() {
    this.isDrawing = false;
    // 重設回預設疊加模式
    if (this.ctx) {
      this.ctx.globalCompositeOperation = 'source-over';
    }
  }

  toggleMode() {
    this.isActive = !this.isActive;
    this.canvas.style.pointerEvents = this.isActive ? 'auto' : 'none';
    return this.isActive;
  }

  selectColor(color) {
    this.currentColor = color;
  }

  toggleHighlight() {
    this.isHighlight = !this.isHighlight;
    return this.isHighlight;
  }

  clearAll() {
    // 清空 Canvas 畫布
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // 清除所有 HTML 文字標註
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

    element.addEventListener('mousedown', (e) => {
      if (document.activeElement === element) return;
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      e.stopPropagation();
    });

    const onMouseMove = (e) => {
      if (isDragging) {
        element.style.left = `${e.clientX - offsetX}px`;
        element.style.top = `${e.clientY - offsetY}px`;
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
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
