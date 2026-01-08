import { Injectable, Logger } from '@nestjs/common';
import { ExecFileException, execFile } from 'child_process';
import { promisify } from 'util';
import { ConfigService } from '@nestjs/config';
import { WafConfig } from '../config/waf.config';

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class NginxCommandService {
  private readonly logger = new Logger(NginxCommandService.name);

  constructor(private readonly configService: ConfigService) {}

  async testConfig(): Promise<CommandResult> {
    const { nginxBin, nginxConf } = this.getConfig();
    return this.run([nginxBin, '-t', '-q', '-c', nginxConf]);
  }

  async reload(): Promise<CommandResult> {
    const { nginxBin, nginxConf } = this.getConfig();
    return this.run([nginxBin, '-s', 'reload', '-c', nginxConf]);
  }

  private async run(args: string[]): Promise<CommandResult> {
    const [cmd, ...rest] = args;
    try {
      const { stdout, stderr } = await execFileAsync(cmd, rest, {
        windowsHide: true,
      });
      return {
        stdout: stdout?.toString() ?? '',
        stderr: stderr?.toString() ?? '',
      };
    } catch (err) {
      const e = err as ExecFileException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      const stdout = e?.stdout ? e.stdout.toString() : '';
      const stderr = e?.stderr ? e.stderr.toString() : '';
      this.logger.error(`command failed: ${cmd} ${rest.join(' ')} | ${stderr}`);
      const wrapped = new Error(
        `cmd failed: ${cmd} ${rest.join(' ')} | ${stderr || stdout}`,
      );
      (wrapped as Error & { stdout?: string; stderr?: string }).stdout = stdout;
      (wrapped as Error & { stderr?: string }).stderr = stderr;
      throw wrapped;
    }
  }

  private getConfig(): { nginxBin: string; nginxConf: string } {
    const cfg = this.configService.get<WafConfig>('waf');
    return {
      nginxBin: cfg?.nginxBin || '/usr/local/nginx/sbin/nginx',
      nginxConf: cfg?.nginxConf || '/usr/local/nginx/conf/nginx.conf',
    };
  }
}
