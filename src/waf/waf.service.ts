import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

export type LogSource = 'module' | 'access';

export interface TailOptions {
  source: LogSource | 'auto';
  lines: number;
}

@Injectable()
export class WafService {
  constructor(private readonly config: ConfigService) {}

  getConfiguredPaths(): { moduleJsonlPath: string; accessJsonlPath: string } {
    const moduleJsonlPath =
      this.config.get<string>('WAF_JSONL_PATH') || '/var/log/nginx/waf.jsonl';
    const accessJsonlPath =
      this.config.get<string>('WAF_ACCESS_LOG_PATH') ||
      '/var/log/nginx/access_waf.json';
    return { moduleJsonlPath, accessJsonlPath };
  }

  getStatus(): Array<{
    kind: 'module' | 'access';
    path: string;
    exists: boolean;
    size?: number;
    mtimeMs?: number;
  }> {
    const { moduleJsonlPath, accessJsonlPath } = this.getConfiguredPaths();
    return [
      this.inspectFile('module', moduleJsonlPath),
      this.inspectFile('access', accessJsonlPath),
    ];
  }

  private inspectFile(kind: 'module' | 'access', filePath: string) {
    try {
      const stat = fs.statSync(filePath);
      return {
        kind,
        path: filePath,
        exists: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      return { kind, path: filePath, exists: false };
    }
  }

  tailLogs(options: TailOptions): {
    source: 'module' | 'access';
    path: string;
    lines: string[];
  } {
    const { moduleJsonlPath, accessJsonlPath } = this.getConfiguredPaths();
    const resolved = this.resolveSource(
      options.source,
      moduleJsonlPath,
      accessJsonlPath,
    );
    const lines = this.tailFile(resolved.path, options.lines);
    return { source: resolved.source, path: resolved.path, lines };
  }

  private resolveSource(
    source: TailOptions['source'],
    moduleJsonlPath: string,
    accessJsonlPath: string,
  ): { source: 'module' | 'access'; path: string } {
    if (source === 'module') return { source: 'module', path: moduleJsonlPath };
    if (source === 'access') return { source: 'access', path: accessJsonlPath };
    if (fs.existsSync(moduleJsonlPath))
      return { source: 'module', path: moduleJsonlPath };
    return { source: 'access', path: accessJsonlPath };
  }

  private tailFile(filePath: string, maxLines: number): string[] {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split(/\r?\n/).filter((l) => l.length > 0);
    return allLines.slice(-maxLines);
  }
}
