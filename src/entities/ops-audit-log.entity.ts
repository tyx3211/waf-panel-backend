import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type OpsActionType =
  | 'PUBLISH_POLICY'
  | 'ROLLBACK_POLICY'
  | 'TOGGLE_WAF'
  | 'TOGGLE_DYNAMIC_BLOCK'
  | 'UPDATE_DEFAULT_ACTION'
  | 'UPDATE_CORE'
  | 'UPDATE_TEMPLATE'
  | 'RESTORE_CORE_FACTORY'
  | 'UPDATE_ALERT_CONFIG'
  | 'UPDATE_GLOBAL_CONFIG'
  | 'SEND_ALERT';

export type OpsStatus = 'SUCCESS' | 'FAILED';

@Entity({ name: 'ops_audit_log' })
export class OpsAuditLog {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 64 })
  actionType!: OpsActionType;

  @Column({ type: 'varchar', length: 32 })
  targetType!: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  targetName?: string;

  @Column({ type: 'varchar', length: 64 })
  status!: OpsStatus;

  @Column({ type: 'varchar', length: 128, nullable: true })
  actor?: string;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
