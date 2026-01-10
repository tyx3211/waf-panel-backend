import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WafConfig } from '../config/waf.config';

const execFileAsync = promisify(execFile);

interface UpdateResult {
  backupPath?: string;
  targetPath: string;
}

interface ParsedDirective {
  directive: string;
  args?: string[];
  block?: ParsedDirective[];
}

interface CrossplaneConfig {
  config?: Array<{
    parsed?: ParsedDirective[];
  }>;
}

@Injectable()
export class NginxConfigService {
  private readonly logger = new Logger(NginxConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 通过 crossplane 更新指定 server 的 waf_rules_json 路径
   * @throws Error 当 server_name 未找到或 crossplane 失败时
   */
  async updateServerRulesJson(
    serverName: string,
    rulesFilePath: string,
  ): Promise<UpdateResult> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    // 1) parse
    await execFileAsync(cfg.crossplaneBin, [
      'parse',
      '--single-file',
      '-o',
      jsonPath,
      cfg.nginxConf,
    ]);
    const parsed = JSON.parse(
      await fsp.readFile(jsonPath, 'utf8'),
    ) as CrossplaneConfig;
    const root = parsed?.config?.[0];
    if (!root?.parsed) {
      throw new Error('crossplane parse result missing parsed content');
    }
    const http = root.parsed.find((d) => d.directive === 'http');
    if (!http?.block) {
      throw new Error('nginx.conf missing http block');
    }
    const serverBlocks = http.block.filter((d) => d.directive === 'server');
    const target = serverBlocks.find((s) => {
      const nameDir = (s.block || []).find(
        (d) => d.directive === 'server_name',
      );
      return nameDir?.args?.includes(serverName);
    });
    if (!target) {
      throw new Error(`server ${serverName} not found in nginx.conf`);
    }

    const wafPath = this.toRelativeRulesPath(rulesFilePath, cfg.rulesDir);
    const existing = (target.block || []).find(
      (d) => d.directive === 'waf_rules_json',
    );
    
    if (existing) {
      existing.args = [wafPath];
    } else {
      target.block = target.block || [];
      target.block.push({
        directive: 'waf_rules_json',
        args: [wafPath],
      });
    }

    await fsp.writeFile(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');

    // 2) build to text
    const { stdout } = await execFileAsync(cfg.crossplaneBin, [
      'build',
      '--no-headers',
      '--stdout',
      jsonPath,
    ]);
    const newConf = stdout?.toString() ?? '';

    // 3) backup then write
    const backupPath = await this.backup(cfg.nginxConf, cfg.backupDir);
    await fsp.writeFile(cfg.nginxConf, newConf, 'utf8');
    this.logger.log(
      `nginx.conf updated for server=${serverName}, waf_rules_json=${wafPath}`,
    );

    return { backupPath, targetPath: cfg.nginxConf };
  }

  async updateServerRuntimeDirectives(
    serverName: string,
    directives: {
      waf?: boolean;
      dynamicBlock?: boolean;
      defaultAction?: string; // 'pass' | 'block'
    },
  ): Promise<UpdateResult> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-run-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    // 1) parse
    await execFileAsync(cfg.crossplaneBin, [
      'parse',
      '--single-file',
      '-o',
      jsonPath,
      cfg.nginxConf,
    ]);
    const parsed = JSON.parse(
      await fsp.readFile(jsonPath, 'utf8'),
    ) as CrossplaneConfig;
    
    // Helper to find server block (reuse logic?)
    const root = parsed?.config?.[0];
    if (!root?.parsed) throw new Error('crossplane parse error');
    const http = root.parsed.find((d) => d.directive === 'http');
    if (!http?.block) throw new Error('missing http block');
    
    const serverBlocks = http.block.filter((d) => d.directive === 'server');
    const target = serverBlocks.find((s) => {
      const nameDir = (s.block || []).find(
        (d) => d.directive === 'server_name',
      );
      return nameDir?.args?.includes(serverName);
    });
    if (!target) {
      throw new Error(`server ${serverName} not found`);
    }

    target.block = target.block || [];

    // Helper to set directive
    const setDirective = (name: string, args: string[]) => {
      if (!target.block) return; // TS guard
      const existing = target.block.find((d) => d.directive === name);
      if (existing) {
        existing.args = args;
      } else {
        target.block.push({ directive: name, args });
      }
    };

    // Apply changes
    if (directives.waf !== undefined) {
      setDirective('waf', [directives.waf ? 'on' : 'off']);
    }
    if (directives.dynamicBlock !== undefined) {
      setDirective('waf_dynamic_block_enable', [directives.dynamicBlock ? 'on' : 'off']);
    }
    if (directives.defaultAction !== undefined) {
      // WAF module only accepts: block|log (not pass)
      const action = directives.defaultAction.toUpperCase();
      setDirective('waf_default_action', [action === 'LOG' ? 'LOG' : 'BLOCK']);
    }

    await fsp.writeFile(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');

    // 2) build
    const { stdout } = await execFileAsync(cfg.crossplaneBin, [
      'build',
      '--no-headers',
      '--stdout',
      jsonPath,
    ]);
    const newConf = stdout?.toString() ?? '';

    // 3) backup & write
    const backupPath = await this.backup(cfg.nginxConf, cfg.backupDir);
    await fsp.writeFile(cfg.nginxConf, newConf, 'utf8'); // atomic write usually implied by OS but simple write here
    
    this.logger.log(`nginx.conf runtime directives updated for ${serverName}`);
    return { backupPath, targetPath: cfg.nginxConf };
  }

  async restoreBackup(backupPath?: string, targetPath?: string): Promise<void> {
    if (!backupPath || !targetPath) return;
    try {
      await fsp.copyFile(backupPath, targetPath);
      this.logger.warn(`restored nginx.conf from backup: ${backupPath}`);
    } catch (err) {
      this.logger.error(`restore backup failed: ${(err as Error).message}`);
    }
  }

  async getServerRuntimeDirectives(serverName: string): Promise<{
    waf: boolean;
    dynamicBlock: boolean;
    defaultAction: string;
  }> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-get-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    try {
      await execFileAsync(cfg.crossplaneBin, [
        'parse',
        '--single-file',
        '-o',
        jsonPath,
        cfg.nginxConf,
      ]);
      const parsed = JSON.parse(
        await fsp.readFile(jsonPath, 'utf8'),
      ) as CrossplaneConfig;
      
      const root = parsed?.config?.[0];
      if (!root?.parsed) throw new Error('parse failed');
      const http = root.parsed.find((d) => d.directive === 'http');
      if (!http?.block) throw new Error('missing http block');

      const serverBlocks = http.block.filter((d) => d.directive === 'server');
      const target = serverBlocks.find((s) => {
        const nameDir = (s.block || []).find((d) => d.directive === 'server_name');
        return nameDir?.args?.includes(serverName);
      });

      if (!target) {
        throw new Error(`server ${serverName} not found`);
      }

      // Read directive values
      const getDirectiveValue = (name: string) => {
        const dir = (target.block || []).find((d) => d.directive === name);
        return dir?.args?.[0];
      };

      const wafVal = getDirectiveValue('waf');
      const dynamicBlockVal = getDirectiveValue('waf_dynamic_block_enable');
      const defaultActionVal = getDirectiveValue('waf_default_action');

      return {
        waf: wafVal === 'on',
        dynamicBlock: dynamicBlockVal === 'on',
        defaultAction: (defaultActionVal || 'BLOCK').toLowerCase(),
      };
    } finally {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  async getGlobalRuntimeDirectives(): Promise<{
    trustXff: boolean;
    logLevel: string;
    dynamicBlockScore: number;
    dynamicBlockDuration: string;
    dynamicBlockWindow: string;
  }> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-getg-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    try {
      await execFileAsync(cfg.crossplaneBin, [
        'parse',
        '--single-file',
        '-o',
        jsonPath,
        cfg.nginxConf,
      ]);
      const parsed = JSON.parse(
        await fsp.readFile(jsonPath, 'utf8'),
      ) as CrossplaneConfig;
      
      const root = parsed?.config?.[0];
      if (!root?.parsed) throw new Error('parse failed');
      const http = root.parsed.find((d) => d.directive === 'http');
      if (!http?.block) throw new Error('missing http block');

      const getDirectiveValue = (name: string) => {
        const dir = (http.block || []).find((d) => d.directive === name);
        return dir?.args?.[0];
      };

      const xffVal = getDirectiveValue('waf_trust_xff');
      const logLevelVal = getDirectiveValue('waf_json_log_level');
      const scoreVal = getDirectiveValue('waf_dynamic_block_score_threshold');
      const durationVal = getDirectiveValue('waf_dynamic_block_duration');
      const windowVal = getDirectiveValue('waf_dynamic_block_window_size');

      return {
        trustXff: xffVal === 'on',
        logLevel: logLevelVal || 'INFO',
        dynamicBlockScore: scoreVal ? parseInt(scoreVal, 10) : 60,
        dynamicBlockDuration: durationVal || '30m',
        dynamicBlockWindow: windowVal || '1m',
      };
    } finally {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  async updateGlobalRuntimeDirectives(directives: {
    trustXff?: boolean;
    logLevel?: string;
    dynamicBlockScore?: number;
    dynamicBlockDuration?: string;
    dynamicBlockWindow?: string;
  }): Promise<UpdateResult> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-rung-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    // 1) parse
    await execFileAsync(cfg.crossplaneBin, [
      'parse',
      '--single-file',
      '-o',
      jsonPath,
      cfg.nginxConf,
    ]);
    const parsed = JSON.parse(
      await fsp.readFile(jsonPath, 'utf8'),
    ) as CrossplaneConfig;
    
    const root = parsed?.config?.[0];
    if (!root?.parsed) throw new Error('crossplane parse error');
    const http = root.parsed.find((d) => d.directive === 'http');
    if (!http?.block) throw new Error('missing http block');

    const setDirective = (name: string, args: string[]) => {
      if (!http.block) return;
      const existing = http.block.find((d) => d.directive === name);
      if (existing) {
        existing.args = args;
      } else {
        http.block.push({ directive: name, args });
      }
    };

    if (directives.trustXff !== undefined) {
      setDirective('waf_trust_xff', [directives.trustXff ? 'on' : 'off']);
    }
    if (directives.logLevel !== undefined) {
      setDirective('waf_json_log_level', [directives.logLevel.toLowerCase()]);
    }
    if (directives.dynamicBlockScore !== undefined) {
      setDirective('waf_dynamic_block_score_threshold', [String(directives.dynamicBlockScore)]);
    }
    if (directives.dynamicBlockDuration !== undefined) {
      setDirective('waf_dynamic_block_duration', [directives.dynamicBlockDuration]);
    }
    if (directives.dynamicBlockWindow !== undefined) {
      setDirective('waf_dynamic_block_window_size', [directives.dynamicBlockWindow]);
    }

    await fsp.writeFile(jsonPath, JSON.stringify(parsed, null, 2), 'utf8');

    // 2) build
    const { stdout } = await execFileAsync(cfg.crossplaneBin, [
      'build',
      '--no-headers',
      '--stdout',
      jsonPath,
    ]);
    const newConf = stdout?.toString() ?? '';

    // 3) backup & write
    const backupPath = await this.backup(cfg.nginxConf, cfg.backupDir);
    await fsp.writeFile(cfg.nginxConf, newConf, 'utf8');
    
    this.logger.log(`nginx.conf global directives updated`);
    return { backupPath, targetPath: cfg.nginxConf };
  }



  async listServerNames(): Promise<string[]> {
    const cfg = this.getCfg();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'waf-cp-list-'));
    const jsonPath = path.join(tmpDir, 'nginx.json');

    try {
      await execFileAsync(cfg.crossplaneBin, [
        'parse',
        '--single-file',
        '-o',
        jsonPath,
        cfg.nginxConf,
      ]);
      const parsed = JSON.parse(
        await fsp.readFile(jsonPath, 'utf8'),
      ) as CrossplaneConfig;
      
      const root = parsed?.config?.[0];
      if (!root?.parsed) return [];
      const http = root.parsed.find((d) => d.directive === 'http');
      if (!http?.block) return [];

      const serverNames = http.block
        .filter((d) => d.directive === 'server')
        .flatMap((s) => {
          const nameDir = (s.block || []).find((d) => d.directive === 'server_name');
          return nameDir?.args || [];
        });
      
      return Array.from(new Set(serverNames));
    } catch (e) {
      this.logger.error(`Failed to list servers from nginx.conf: ${e}`);
      return [];
    } finally {
        // cleanup tmp
        try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  private async backup(confPath: string, backupDir: string): Promise<string> {
    await fsp.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
    const backupPath = path.join(backupDir, `nginx.conf.${stamp}.bak`);
    await fsp.copyFile(confPath, backupPath);
    return backupPath;
  }

  private toRelativeRulesPath(rulesFilePath: string, rulesDir: string): string {
    if (rulesFilePath.startsWith(rulesDir)) {
      const rel = path.relative(rulesDir, rulesFilePath);
      return rel.split(path.sep).join('/');
    }
    return rulesFilePath;
  }

  private getCfg(): WafConfig {
    const cfg = this.configService.get<WafConfig>('waf');
    return {
      rulesDir: cfg?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON',
      coreDir:
        cfg?.coreDir ||
        `${cfg?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON'}/core`,
      coreManagedDir:
        cfg?.coreManagedDir ||
        `${cfg?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON'}/managed-core`,
      templateDir:
        cfg?.templateDir ||
        `${cfg?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON'}/template`,
      nginxConf: cfg?.nginxConf || '/usr/local/nginx/conf/nginx.conf',
      nginxBin: cfg?.nginxBin || '/usr/local/nginx/sbin/nginx',
      crossplaneBin: cfg?.crossplaneBin || 'crossplane',
      backupDir: cfg?.backupDir || '/usr/local/nginx/conf/.backup',
    };
  }
}
