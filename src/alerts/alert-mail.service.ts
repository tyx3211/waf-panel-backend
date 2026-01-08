import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { type Transporter } from 'nodemailer';
import { SmtpConfig } from '../config/smtp.config';

export interface MailSendResult {
  sent: boolean;
  error?: string;
}

@Injectable()
export class AlertMailService {
  private readonly logger = new Logger(AlertMailService.name);
  private transporter: Transporter | null = null;
  private cfg: SmtpConfig | null = null;

  constructor(private readonly configService: ConfigService) {
    this.cfg = this.configService.get<SmtpConfig>('smtp') ?? null;
    if (this.cfg?.enabled && this.cfg.host) {
      this.transporter = nodemailer.createTransport({
        host: this.cfg.host,
        port: this.cfg.port,
        secure: this.cfg.secure,
        auth:
          this.cfg.user && this.cfg.pass
            ? { user: this.cfg.user, pass: this.cfg.pass }
            : undefined,
        tls: { rejectUnauthorized: this.cfg.rejectUnauthorized },
      });
    }
  }

  async send(
    recipients: string[],
    subject: string,
    content?: string,
  ): Promise<MailSendResult> {
    if (!this.cfg?.enabled) {
      return { sent: false, error: 'SMTP 未启用' };
    }
    if (!this.transporter || !this.cfg.host) {
      return { sent: false, error: 'SMTP 配置缺失' };
    }
    if (!recipients.length) {
      return { sent: false, error: '收件人为空' };
    }
    const from = this.cfg.from || this.cfg.user || 'waf@example.local';
    try {
      await this.transporter.sendMail({
        from,
        to: recipients.join(','),
        subject,
        text: content ?? '',
      });
      return { sent: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SMTP 发送失败';
      this.logger.error(`smtp send failed: ${message}`);
      return { sent: false, error: message };
    }
  }
}
