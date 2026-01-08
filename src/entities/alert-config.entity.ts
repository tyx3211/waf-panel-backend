import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'alert_config' })
export class AlertConfigEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'text', array: true, default: '{}' })
  emails!: string[];

  @Column({ type: 'jsonb', default: {} })
  thresholds!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  updatedBy?: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
