import { Injectable, Logger } from '@nestjs/common';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '@nestjs/config';
import { WafConfig } from '../config/waf.config';

export interface WritePolicyResult {
  path: string;
}

@Injectable()
export class RulesFilesystemService {
  private readonly logger = new Logger(RulesFilesystemService.name);

  constructor(private readonly configService: ConfigService) {}

  writePolicy(
    serverName: string,
    policyJson: Record<string, unknown>,
  ): WritePolicyResult {
    const config = this.configService.get<WafConfig>('waf');
    const rulesDir = config?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON';
    const targetPath = path.join(rulesDir, 'user', `${serverName}.json`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(policyJson, null, 2), 'utf8');
    this.logger.log(`policy written: ${targetPath}`);
    return { path: targetPath };
  }

  readPolicy(serverName: string): Record<string, unknown> | null {
    const config = this.configService.get<WafConfig>('waf');
    const rulesDir = config?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON';
    const targetPath = path.join(rulesDir, 'user', `${serverName}.json`);
    if (fs.existsSync(targetPath)) {
      try {
        const content = fs.readFileSync(targetPath, 'utf8');
        return JSON.parse(content) as Record<string, unknown>;
      } catch (e) {
        this.logger.warn(`Failed to read/parse policy for ${serverName}: ${e}`);
        return null;
      }
    }
    return null;
  }

  writeTemplate(
    templateName: string,
    content: Record<string, unknown>,
  ): WritePolicyResult {
    const config = this.configService.get<WafConfig>('waf');
    const rulesDir = config?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON';
    const targetPath = path.join(rulesDir, 'template', `${templateName}.json`);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    // DTO from DB just contains rules inside rulesJson.rules usually, but for file we want the full object?
    // In DB: rulesJson IS the full object usually.
    // The previous service `sanitizeTemplateRules` prepares it.
    // Let's assume content is the full JSON to be written.
    fs.writeFileSync(targetPath, JSON.stringify(content, null, 2), 'utf8');
    this.logger.log(`template written: ${targetPath}`);
    return { path: targetPath };
  }

  deleteTemplate(templateName: string): void {
    const config = this.configService.get<WafConfig>('waf');
    const rulesDir = config?.rulesDir || '/usr/local/nginx/WAF_RULES_JSON';
    const targetPath = path.join(rulesDir, 'template', `${templateName}.json`);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      this.logger.log(`template deleted: ${targetPath}`);
    }
  }
}
