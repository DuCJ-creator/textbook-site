/**
 * 標註工具 Core Logic (js/annotation-tool.js)
 */
class AnnotationTool {
  constructor() {
    this.isActive = false;
    this.currentTool = 'pen'; // 'pen' | 'shape'
    this.currentColor = '#000000';
    this.isHighlight = false;
    this.currentShape = null; // 'rectangle' | 'circle' | 'arrow'
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.textAnnotations = [];

    // 初始化畫布
    this.canvas = document.getElementById('annotationCanvas') || document.createElement('canvas');
    if (!this.canvas.parentNode) {
      this.canvas.id = 'annotationCanvas';
      this.canvas.className = 'annotation-canvas';
      document.body.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d');

    // 暫存畫布（用於即時預覽形狀拉伸與重繪）
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
  }

  init() {
    this.resizeCanvas();
    this.setupEventListeners();
  }

  resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // 當尺寸改變時備份繪圖內容
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    if (this.canvas.width > 0 && this.canvas.height > 0) {
      tempCanvas.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;

    // 還原繪圖內容
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

  startDrawing(e) {
    if (!this.isActive) return;
    this.isDrawing = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    // 開始新路徑或備份主畫布內容（供形狀即時重繪使用）
    if (this.currentTool === 'pen') {
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX, this.startY);
    } else if (this.currentTool === 'shape') {
      this.offscreenCtx.clearRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
      this.offscreenCtx.drawImage(this.canvas, 0, 0);
    }
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;

    const strokeColor = this.isHighlight ? this.currentColor + '4D' : this.currentColor;
    const lineWidth = this.isHighlight ? 15 : 3;
    const fillColor = this.currentColor + '33';

    if (this.currentTool === 'pen') {
      this.ctx.strokeStyle = strokeColor;
      this.ctx.lineWidth = lineWidth;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineTo(e.clientX, e.clientY);
      this.ctx.stroke();
    } else if (this.currentTool === 'shape') {
      // 繪製形狀時先還原離屏畫布，避免拉伸時軌跡重疊
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);

      this.ctx.strokeStyle = strokeColor;
      this.ctx.fillStyle = fillColor;
      this.ctx.lineWidth = lineWidth;

      this.drawShape(this.ctx, this.startX, this.startY, e.clientX, e.clientY);
    }
  }

  drawShape(ctx, fromX, fromY, toX, toY) {
    ctx.beginPath();
    switch (this.currentShape) {
      case 'rectangle':
        ctx.rect(fromX, fromY, toX - fromX, toY - fromY);
        ctx.fill();
        ctx.stroke();
        break;

      case 'circle': {
        const radius = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
        ctx.arc(fromX, fromY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'arrow':
        this.drawArrow(ctx, fromX, fromY, toX, toY);
        break;
    }
  }

  drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  stopDrawing() {
    this.isDrawing = false;
  }

  // ===== 工具列與狀態操作 =====
  toggleMode() {
    this.isActive = !this.isActive;
    this.canvas.style.pointerEvents = this.isActive ? 'auto' : 'none';
    return this.isActive ? '退出標註' : '標註模式';
  }

  selectColor(color) {
    this.currentColor = color;
  }

  toggleHighlight() {
    this.isHighlight = !this.isHighlight;
    return this.isHighlight ? '#FFC107' : '#FFEB3B';
  }

  setShape(shape) {
    if (this.currentShape === shape && this.currentTool === 'shape') {
      this.currentTool = 'pen';
      this.currentShape = null;
    } else {
      this.currentShape = shape;
      this.currentTool = 'shape';
    }
  }

  // ===== 文字標註 =====
  addTextAnnotation() {
    if (!this.isActive) return;

    const textDiv = document.createElement('div');
    textDiv.className = 'text-annotation';
    textDiv.textContent = '點擊編輯文字';
    textDiv.contentEditable = true;

    textDiv.style.left = `${window.innerWidth * 0.3 + Math.random() * window.innerWidth * 0.2}px`;
    textDiv.style.top = `${window.innerHeight * 0.3 + Math.random() * window.innerHeight * 0.2}px`;

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
      // 若點擊時處於編輯狀態，暫不觸發拖曳
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

  // ===== 導出截圖 =====
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

        // 疊加網頁底圖與 Canvas 標註繪圖
        exportCtx.drawImage(pageCanvas, 0, 0);
        exportCtx.drawImage(this.canvas, 0, 0);

        resolve(exportCanvas.toDataURL('image/png'));
      }).catch(reject);
    });
  }
}

// 實例化並導出給全域使用
const annotationTool = new AnnotationTool();

document.addEventListener('DOMContentLoaded', () => {
  annotationTool.init();
});

window.AnnotationTool = annotationTool;
