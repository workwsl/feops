import * as path from 'path';
import { writeFile } from './index';

export interface ReportMeta {
  command: string;
  description: string;
  scanDirectories: string[];
  scopeLabel: string;
  fetchEnabled: boolean;
  executedAt?: Date;
}

export function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function mdTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.map(escapeMdCell).join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map(row => `| ${row.map(cell => escapeMdCell(cell)).join(' | ')} |`);
  return [headerLine, separatorLine, ...bodyLines].join('\n');
}

export function writeMarkdownReport(filePath: string, content: string): string {
  writeFile(filePath, content);
  return path.resolve(filePath);
}

function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function renderReportHeader(
  title: string,
  meta: ReportMeta,
  extraFields?: Record<string, string>
): string {
  const executedAt = meta.executedAt ?? new Date();
  const lines = [
    `# ${title}`,
    '',
    `- 执行时间: ${formatDateTime(executedAt)}`,
    `- 命令: ${meta.command}`,
    `- 说明: ${meta.description}`,
    `- 扫描目录: ${meta.scanDirectories.join(', ') || '-'}`,
    `- 检查范围: ${meta.scopeLabel}`,
    `- Git fetch: ${meta.fetchEnabled ? '启用' : '禁用'}`
  ];

  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  return lines.join('\n');
}

export function renderSummarySection(rows: Array<[string, string | number]>): string {
  return ['## 统计', '', mdTable(['指标', '数量'], rows.map(([label, count]) => [label, String(count)]))].join('\n');
}
