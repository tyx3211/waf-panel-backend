import 'dotenv/config';
import { DataSource } from 'typeorm';
import { InitSchema1700000000000 } from '../migrations/1700000000000-init-schema';
import { AddUsersAlerts1700000000001 } from '../migrations/1700000000001-add-users-alerts';
import { ServerPolicyVersion } from '../../entities/server-policy-version.entity';
import { TemplateRuleSetVersion } from '../../entities/template-rule-set-version.entity';
import { CoreRuleSetVersion } from '../../entities/core-rule-set-version.entity';
import { OpsAuditLog } from '../../entities/ops-audit-log.entity';
import { User } from '../../entities/user.entity';
import { AlertConfigEntity } from '../../entities/alert-config.entity';
import { AlertSendLog } from '../../entities/alert-send-log.entity';

const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
const username = process.env.DB_USER || 'postgres';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'waf';
const ssl = process.env.DB_SSL === 'true';

describe('DB integration (migrations + repository)', () => {
  const schema =
    process.env.DB_TEST_SCHEMA || `waf_test_${Date.now().toString(36)}`;
  let dataSource: DataSource;

  beforeAll(async () => {
    jest.setTimeout(20_000);
    dataSource = new DataSource({
      type: 'postgres',
      host,
      port,
      username,
      password,
      database,
      schema,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      entities: [
        ServerPolicyVersion,
        TemplateRuleSetVersion,
        CoreRuleSetVersion,
        OpsAuditLog,
        User,
        AlertConfigEntity,
        AlertSendLog,
      ],
      synchronize: false,
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`create schema if not exists "${schema}"`);
    await runner.query(`set search_path to "${schema}"`);
    await new InitSchema1700000000000().up(runner);
    await new AddUsersAlerts1700000000001().up(runner);
    await runner.release();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`drop schema if exists "${schema}" cascade`);
      await dataSource.destroy();
    }
  });

  it('should create tables and allow repository read/write', async () => {
    const tables = [
      'server_policy_version',
      'core_rule_set_version',
      'template_rule_set_version',
      'ops_audit_log',
      'users',
      'alert_config',
      'alert_send_log',
    ];
    for (const t of tables) {
      const rows = await dataSource.query(
        'select table_schema from information_schema.tables where table_schema = $1 and table_name = $2',
        [schema, t],
      );
      expect(rows.length).toBeGreaterThan(0);
    }

    const userRepo = dataSource.getRepository(User);
    const user = userRepo.create({
      username: 'it_user',
      passwordHash: 'hash',
      role: 'admin',
      displayName: 'Integration User',
      builtIn: false,
    });
    await userRepo.save(user);
    const found = await userRepo.findOne({ where: { username: 'it_user' } });
    expect(found?.username).toBe('it_user');

    const configRepo = dataSource.getRepository(AlertConfigEntity);
    await configRepo.save(
      configRepo.create({
        enabled: true,
        emails: ['ops@example.com'],
        thresholds: { blockRate: 0.5 },
        updatedBy: 'tester',
      }),
    );
    const cfg = await configRepo.findOne({ where: {} });
    expect(cfg?.emails[0]).toBe('ops@example.com');

    const policyRepo = dataSource.getRepository(ServerPolicyVersion);
    await policyRepo.save(
      policyRepo.create({
        serverName: 'example1.com',
        versionNo: 1,
        policyJson: { rules: [] },
        status: 'SUCCESS',
      }),
    );
    const policy = await policyRepo.findOne({
      where: { serverName: 'example1.com', versionNo: 1 },
    });
    expect(policy?.status).toBe('SUCCESS');
  });
});
