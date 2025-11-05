import chalk from 'chalk';

export interface ProgressBarOptions {
  width?: number;
  complete?: string;
  incomplete?: string;
  showPercentage?: boolean;
  showCount?: boolean;
  prefix?: string;
  suffix?: string;
}

export class ProgressBar {
  private current: number = 0;
  private total: number;
  private options: Required<ProgressBarOptions>;
  private startTime: number;

  constructor(total: number, options: ProgressBarOptions = {}) {
    this.total = total;
    this.options = {
      width: options.width || 30,
      complete: options.complete || '█',
      incomplete: options.incomplete || '░',
      showPercentage: options.showPercentage !== false,
      showCount: options.showCount !== false,
      prefix: options.prefix || '',
      suffix: options.suffix || '',
    };
    this.startTime = Date.now();
  }

  /**
   * 更新进度
   * @param current 当前进度值
   * @param message 可选的消息
   */
  update(current: number, message?: string): void {
    this.current = Math.min(current, this.total);
    this.render(message);
  }

  /**
   * 增加进度
   * @param increment 增加的数量，默认为1
   * @param message 可选的消息
   */
  tick(increment: number = 1, message?: string): void {
    this.update(this.current + increment, message);
  }

  /**
   * 渲染进度条
   * @param message 可选的消息
   */
  private render(message?: string): void {
    const percentage = this.total === 0 ? 100 : Math.round((this.current / this.total) * 100);
    const completed = Math.round((this.current / this.total) * this.options.width);
    const remaining = this.options.width - completed;

    // 构建进度条
    const progressBar = 
      chalk.green(this.options.complete.repeat(completed)) +
      chalk.gray(this.options.incomplete.repeat(remaining));

    // 构建显示文本
    let display = '';
    
    if (this.options.prefix) {
      display += this.options.prefix + ' ';
    }

    display += `[${progressBar}]`;

    if (this.options.showPercentage) {
      display += ` ${percentage.toString().padStart(3)}%`;
    }

    if (this.options.showCount) {
      display += ` (${this.current}/${this.total})`;
    }

    // 计算预估剩余时间
    if (this.current > 0 && this.current < this.total) {
      const elapsed = Date.now() - this.startTime;
      const rate = this.current / elapsed;
      const remaining = (this.total - this.current) / rate;
      const eta = Math.round(remaining / 1000);
      
      if (eta > 0) {
        display += ` ETA: ${eta}s`;
      }
    }

    if (message) {
      display += ` ${message}`;
    }

    if (this.options.suffix) {
      display += ' ' + this.options.suffix;
    }

    // 清除当前行并输出新的进度条
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
    process.stdout.write(display);

    // 如果完成，换行
    if (this.current >= this.total) {
      process.stdout.write('\n');
    }
  }

  /**
   * 完成进度条
   * @param message 完成时的消息
   */
  complete(message?: string): void {
    this.update(this.total, message);
  }

  /**
   * 获取当前进度百分比
   */
  getPercentage(): number {
    return this.total === 0 ? 100 : Math.round((this.current / this.total) * 100);
  }

  /**
   * 获取当前进度值
   */
  getCurrent(): number {
    return this.current;
  }

  /**
   * 获取总数
   */
  getTotal(): number {
    return this.total;
  }

  /**
   * 是否已完成
   */
  isComplete(): boolean {
    return this.current >= this.total;
  }
}

/**
 * 创建一个简单的进度条实例
 * @param total 总数
 * @param options 选项
 * @returns ProgressBar实例
 */
export function createProgressBar(total: number, options?: ProgressBarOptions): ProgressBar {
  return new ProgressBar(total, options);
}