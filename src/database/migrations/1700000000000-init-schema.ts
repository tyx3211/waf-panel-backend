import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      create table if not exists server_policy_version (
        id serial primary key,
        "serverName" varchar(128) not null,
        "versionNo" int not null,
        "policyJson" jsonb not null,
        "enabledCoreRules" jsonb,
        "enabledTemplates" jsonb,
        status varchar(32) not null,
        note text,
        "publishLog" text,
        "createdBy" varchar(128),
        "createdAt" timestamptz not null default now(),
        "updatedAt" timestamptz not null default now(),
        constraint uq_server_policy_version unique ("serverName", "versionNo")
      );
    `);

    await queryRunner.query(`
      create table if not exists template_rule_set_version (
        id serial primary key,
        "templateName" varchar(128) not null,
        "versionNo" int not null,
        "rulesJson" jsonb not null,
        status varchar(32) not null,
        note text,
        "createdBy" varchar(128),
        "createdAt" timestamptz not null default now(),
        "updatedAt" timestamptz not null default now(),
        constraint uq_template_rule_set_version unique ("templateName", "versionNo")
      );
    `);

    await queryRunner.query(`
      create table if not exists core_rule_set_version (
        id serial primary key,
        "coreName" varchar(128) not null,
        "versionNo" int not null,
        "rulesJson" jsonb not null,
        status varchar(32) not null,
        note text,
        "createdBy" varchar(128),
        "createdAt" timestamptz not null default now(),
        "updatedAt" timestamptz not null default now(),
        constraint uq_core_rule_set_version unique ("coreName", "versionNo")
      );
    `);

    await queryRunner.query(`
      create table if not exists ops_audit_log (
        id serial primary key,
        "actionType" varchar(64) not null,
        "targetType" varchar(32) not null,
        "targetName" varchar(256),
        status varchar(64) not null,
        actor varchar(128),
        note text,
        detail jsonb,
        "createdAt" timestamptz not null default now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('drop table if exists ops_audit_log;');
    await queryRunner.query('drop table if exists core_rule_set_version;');
    await queryRunner.query('drop table if exists template_rule_set_version;');
    await queryRunner.query('drop table if exists server_policy_version;');
  }
}
