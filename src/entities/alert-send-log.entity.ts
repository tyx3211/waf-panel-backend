import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'alert_send_log' })
export class AlertSendLog {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'boolean', default: false })
  sent!: boolean;

  @Column({ type: 'text', array: true, default: '{}' })
  recipients!: string[];

  @Column({ type: 'varchar', length: 256, nullable: true })
  error?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  actor?: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
