import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddUsersAlerts1700000000001 implements MigrationInterface {
  name = 'AddUsersAlerts1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'username', type: 'varchar', length: '64', isUnique: true },
          { name: 'passwordHash', type: 'varchar', length: '255' },
          { name: 'role', type: 'varchar', length: '16' },
          {
            name: 'displayName',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          { name: 'builtIn', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'alert_config',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'enabled', type: 'boolean', default: true },
          { name: 'emails', type: 'text', isArray: true, default: "'{}'" },
          { name: 'thresholds', type: 'jsonb', default: "'{}'" },
          {
            name: 'updatedBy',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'alert_send_log',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'subject', type: 'varchar', length: '256' },
          { name: 'content', type: 'text', isNullable: true },
          { name: 'sent', type: 'boolean', default: false },
          { name: 'recipients', type: 'text', isArray: true, default: "'{}'" },
          { name: 'error', type: 'varchar', length: '256', isNullable: true },
          { name: 'actor', type: 'varchar', length: '64', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('alert_send_log');
    await queryRunner.dropTable('alert_config');
    await queryRunner.dropTable('users');
  }
}
