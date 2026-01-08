import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type VersionStatus = 'SUCCESS' | 'FAILED' | 'ROLLED_BACK';

@Entity({ name: 'server_policy_version' })
@Index(['serverName', 'versionNo'], { unique: true })
export class ServerPolicyVersion {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  serverName!: string;

  @Column({ type: 'int' })
  versionNo!: number;

  @Column({ type: 'jsonb' })
  policyJson!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  enabledCoreRules?: string[];

  @Column({ type: 'jsonb', nullable: true })
  enabledTemplates?: string[];

  @Column({ type: 'varchar', length: 32 })
  status!: VersionStatus;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ type: 'text', nullable: true })
  publishLog?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  createdBy?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
