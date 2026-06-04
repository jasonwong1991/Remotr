/**
 * ElementOverlay: 用于高亮显示 DOM 元素的覆盖层组件。
 * 用途：在元素选择器模式下，鼠标悬停时显示元素的边界和信息。
 */
export class ElementOverlay {
  private overlayEl: HTMLDivElement | null = null;
  private labelEl: HTMLDivElement | null = null;

  /**
   * 在指定元素上显示覆盖层高亮。
   * @param element 要高亮的 DOM 元素
   */
  show(element: HTMLElement): void {
    // 延迟创建覆盖层元素（首次调用时）
    if (!this.overlayEl) {
      this.createOverlay();
    }

    if (!this.overlayEl || !this.labelEl) {
      return;
    }

    // 获取元素的位置和尺寸
    const rect = element.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    // 定位覆盖层（相对于文档，包含滚动偏移）
    this.overlayEl.style.left = `${rect.left + scrollX}px`;
    this.overlayEl.style.top = `${rect.top + scrollY}px`;
    this.overlayEl.style.width = `${rect.width}px`;
    this.overlayEl.style.height = `${rect.height}px`;
    this.overlayEl.style.display = 'block';

    // 构建标签文本：标签名#id.class WxH
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className
      ? `.${element.className.split(/\s+/).filter(Boolean).join('.')}`
      : '';
    const dimensions = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    const labelText = `${tag}${id}${classes} ${dimensions}`;

    this.labelEl.textContent = labelText;
    this.labelEl.style.display = 'block';

    // 标签位置：默认在覆盖层顶部上方
    const labelX = rect.left + scrollX;
    let labelY = rect.top + scrollY - 20; // 标签高度约 18px，留 2px 间隙

    // 如果标签超出视口顶部，则显示在覆盖层底部下方
    if (rect.top < 20) {
      labelY = rect.top + scrollY + rect.height + 2;
    }

    this.labelEl.style.left = `${labelX}px`;
    this.labelEl.style.top = `${labelY}px`;
  }

  /**
   * 隐藏覆盖层。
   */
  hide(): void {
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    if (this.labelEl) {
      this.labelEl.style.display = 'none';
    }
  }

  /**
   * 销毁覆盖层，从 DOM 中移除。
   */
  destroy(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    if (this.labelEl) {
      this.labelEl.remove();
      this.labelEl = null;
    }
  }

  /**
   * 创建覆盖层 DOM 元素（内部方法）。
   */
  private createOverlay(): void {
    // 创建覆盖层元素
    this.overlayEl = document.createElement('div');
    this.overlayEl.setAttribute('data-remotr-overlay', 'true');
    this.overlayEl.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(135, 206, 250, 0.3);
      border: 2px solid rgba(30, 144, 255, 0.8);
      box-sizing: border-box;
      display: none;
    `;

    // 创建标签元素
    this.labelEl = document.createElement('div');
    this.labelEl.setAttribute('data-remotr-overlay', 'true');
    this.labelEl.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(30, 144, 255, 0.9);
      color: white;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.4;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      display: none;
    `;

    // 添加到文档
    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.labelEl);
  }
}
