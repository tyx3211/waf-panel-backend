import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { type VersionStatus } from './server-policy-version.entity';

@Entity({ name: 'core_rule_set_version' })
@Index(['coreName', 'versionNo'], { unique: true })
export class CoreRuleSetVersion {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  coreName!: string;

  @Column({ type: 'int' })
  versionNo!: number;

  @Column({ type: 'jsonb' })
  rulesJson!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 32 })
  status!: VersionStatus;

  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  createdBy?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
