import { ElementOverlay } from './element-overlay.js';

/**
 * ElementPicker: 元素选择器模式管理器
 * 用途：用户可以通过点击页面上的任意元素来选择它进行检查
 */
export class ElementPicker {
  private active: boolean = false;
  private overlay: ElementOverlay;
  private onPick: (el: HTMLElement) => void;

  constructor(overlay: ElementOverlay, onPick: (el: HTMLElement) => void) {
    this.overlay = overlay;
    this.onPick = onPick;
  }

  /**
   * 启动元素选择器模式
   */
  start(): void {
    if (this.active) {
      console.log('[remotr] ElementPicker.start() called but already active');
      return;
    }
    console.log('[remotr] ElementPicker.start() - activating picker');
    this.active = true;

    // 添加事件监听器（捕获阶段，优先级最高）
  document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKeyDown, true);

    // 改变光标样式
    document.body.style.cursor = 'crosshair';
    console.log('[remotr] ElementPicker - events bound, cursor set to crosshair');
  }

  /**
   * 停止元素选择器模式
   */
  stop(): void {
    if (!this.active) return;
    this.active = false;

    // 移除事件监听器
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKeyDown, true);

    // 恢复光标样式
    document.body.style.cursor = '';

    // 隐藏覆盖层
    this.overlay.hide();
  }

  /**
   * 鼠标移动事件处理
   */
  private onMouseMove = (e: MouseEvent): void => {
    if (!this.active) return;

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (el && !el.hasAttribute('data-remotr-overlay')) {
    this.overlay.show(el);
    }
  };

  /**
   * 点击事件处理
   */
  private onClick = (e: MouseEvent): void => {
    if (!this.active) {
      console.log('[remotr] ElementPicker.onClick - picker not active');
      return;
    }

    console.log('[remotr] ElementPicker.onClick - element clicked');
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement;
    if (el && !el.hasAttribute('data-remotr-overlay')) {
      console.log('[remotr] ElementPicker - picked element:', el.tagName, el.className);
      this.onPick(el);
      this.stop();
    }
  };

  /**
   * 键盘事件处理（按 Escape 退出选择器模式）
   */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.stop();
    }
  };
}
