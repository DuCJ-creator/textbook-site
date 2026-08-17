class AnnotationTool {
  constructor() {
    this.isActive = false;
    this.currentTool = 'pen';
    this.currentColor = '#000000';
    this.isHighlight = false;
    this.shapes = ['rectangle', 'arrow', 'circle'];
    this.currentShape = null;
    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.textAnnotations = [];
    
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'annotation-canvas';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  init() {
    this.resizeCanvas();
    this.setupEventListeners();
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupEventListeners() {
    // 視窗大小調整
    window.addEventListener('resize', () => this.resizeCanvas());

    // 畫布繪圖事件
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    this.canvas.addEventListener('mouseout', () => this.stopDrawing());

    // 初始化工具列按鈕（由mount方法注入）
  }

  // 繪圖相關方法
  startDrawing(e) {
    if (!this.isActive) return;
    this.isDrawing = true;
    [this.lastX, this.lastY] = [e.clientX, e.clientY];
  }

  draw(e) {
    if (!this.isDrawing || !this.isActive) return;
    
    this.ctx.strokeStyle = this.isHighlight ? this.currentColor + '4D' : this.currentColor;
    this.ctx.lineWidth = this.isHighlight ? 15 : 3;
    this.ctx.fillStyle = this.currentColor + '66';
    
    if (this.currentTool === 'pen') {
      this.drawFreehand(e);
    } else if (this.currentTool === 'shape') {
      this.drawShape(e);
    }
    
    [this.lastX, this.lastY] = [e.clientX, e.clientY];
  }

  drawFreehand(e) {
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(e.clientX, e.clientY);
    this.ctx.stroke();
  }

  drawShape(e) {
    // 清除臨時繪製
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // 根據形狀類型繪製
    switch(this.currentShape) {
      case 'rectangle':
        tempCtx.rect(this.lastX, this.lastY, e.clientX - this.lastX, e.clientY - this.lastY);
        break;
      case 'circle':
        const radius = Math.sqrt(Math.pow(e.clientX - this.lastX, 2) + Math.pow(e.clientY - this.lastY, 2));
        tempCtx.arc(this.lastX, this.lastY, radius, 0, Math.PI * 2);
        break;
      case 'arrow':
        this.drawArrow(tempCtx, this.lastX, this.lastY, e.clientX, e.clientY);
        break;
    }
    
    // 應用樣式並繪製
    tempCtx.strokeStyle = this.ctx.strokeStyle;
    tempCtx.lineWidth = this.ctx.lineWidth;
    tempCtx.fillStyle = this.ctx.fillStyle;
    
    if (['rectangle', 'circle'].includes(this.currentShape)) {
      tempCtx.fill();
    }
    tempCtx.stroke();
    
    // 合併到主畫布
    this.ctx.drawImage(tempCanvas, 0, 0);
  }

  drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    
    // 繪製箭線
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    
    // 繪製箭頭
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.moveTo(toX, toY);
    ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
  }

  stopDrawing() {
    this.isDrawing = false;
  }

  // 工具列操作方法
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
    this.currentShape = shape;
    this.currentTool = 'shape';
  }

  // 文字標註方法
  addTextAnnotation() {
    if (!this.isActive) return;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'text-annotation';
    textDiv.textContent = '點擊編輯文字';
    textDiv.contentEditable = true;
    
    // 設定隨機初始位置
    textDiv.style.left = `${window.innerWidth * 0.3 + Math.random() * window.innerWidth * 0.4}px`;
    textDiv.style.top = `${window.innerHeight * 0.3 + Math.random() * window.innerHeight * 0.4}px`;
    
    // 添加拖曳功能
    this.setupDraggable(textDiv);
    
    document.body.appendChild(textDiv);
    this.textAnnotations.push(textDiv);
  }

  setupDraggable(element) {
    let isDragging = false;
    let offsetX, offsetY;
    
    element.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - element.getBoundingClientRect().left;
      offsetY = e.clientY - element.getBoundingClientRect().top;
      e.stopPropagation();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        element.style.left = `${e.clientX - offsetX}px`;
        element.style.top = `${e.clientY - offsetY}px`;
      }
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  // 導出截圖
  exportScreenshot() {
    return new Promise((resolve, reject) => {
      html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scale: 1
      }).then(pageCanvas => {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = window.innerWidth;
        exportCanvas.height = window.innerHeight;
        const exportCtx = exportCanvas.getContext('2d');
        
        exportCtx.fillStyle = 'white';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        exportCtx.drawImage(pageCanvas, 0, 0);
        exportCtx.drawImage(this.canvas, 0, 0);
        
        resolve(exportCanvas.toDataURL('image/png'));
      }).catch(reject);
    });
  }
}

// 初始化並導出
const annotationTool = new AnnotationTool();

document.addEventListener('DOMContentLoaded', () => {
  annotationTool.init();
});

// 暴露給全局使用（與其他模組相同）
window.AnnotationTool = annotationTool;