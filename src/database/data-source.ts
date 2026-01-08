import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ServerPolicyVersion } from '../entities/server-policy-version.entity';
import { TemplateRuleSetVersion } from '../entities/template-rule-set-version.entity';
import { CoreRuleSetVersion } from '../entities/core-rule-set-version.entity';
import { OpsAuditLog } from '../entities/ops-audit-log.entity';

const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
const username = process.env.DB_USER || 'postgres';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'waf';
const ssl = process.env.DB_SSL === 'true';

const AppDataSource = new DataSource({
  type: 'postgres',
  host,
  port,
  username,
  password,
  database,
  ssl: ssl ? { rejectUnauthorized: false } : undefined,
  entities: [
    ServerPolicyVersion,
    TemplateRuleSetVersion,
    CoreRuleSetVersion,
    OpsAuditLog,
  ],
  migrations: ['dist/database/migrations/*.js'],
});

export default AppDataSource;
