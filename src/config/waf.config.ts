import { registerAs } from '@nestjs/config';

export interface WafConfig {
  rulesDir: string;
  coreDir: string;
  coreManagedDir: string;
  templateDir: string;
  nginxConf: string;
  nginxBin: string;
  crossplaneBin: string;
  backupDir: string;
}

export default registerAs<WafConfig>('waf', () => ({
  rulesDir: process.env.WAF_RULES_DIR || '/usr/local/nginx/WAF_RULES_JSON',
  coreDir:
    process.env.WAF_CORE_DIR ||
    `${process.env.WAF_RULES_DIR || '/usr/local/nginx/WAF_RULES_JSON'}/core`,
  coreManagedDir:
    process.env.WAF_CORE_MANAGED_DIR ||
    `${process.env.WAF_RULES_DIR || '/usr/local/nginx/WAF_RULES_JSON'}/managed-core`,
  templateDir:
    process.env.WAF_TEMPLATE_DIR ||
    `${process.env.WAF_RULES_DIR || '/usr/local/nginx/WAF_RULES_JSON'}/template`,
  nginxConf: process.env.NGINX_CONF || '/usr/local/nginx/conf/nginx.conf',
  nginxBin: process.env.NGINX_BIN || '/usr/local/nginx/sbin/nginx',
  crossplaneBin: process.env.CROSSPLANE_BIN || 'crossplane',
  backupDir: process.env.NGINX_BACKUP_DIR || '/usr/local/nginx/conf/.backup',
}));
