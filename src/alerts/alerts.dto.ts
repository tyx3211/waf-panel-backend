import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsObject,
} from 'class-validator';
import type { AlertThresholds } from './alerts.service';

export class UpdateAlertConfigDto {
  @ApiPropertyOptional({ description: '告警开关', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: '收件人邮箱列表',
    type: [String],
    example: ['ops@example.com'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @ApiPropertyOptional({
    description: '触发阈值（拦截率/QPS/攻击类型计数）',
    type: Object,
    example: {
      blockRate: 0.5,
      qps: 200,
      attackTypeCounts: { SQL_INJECTION: 10 },
    },
  })
  @IsOptional()
  @IsObject()
  thresholds?: AlertThresholds;
}

export class SendAlertDto {
  @ApiProperty({ description: '告警标题', example: '演练告警：高拦截率' })
  @IsString()
  subject!: string;

  @ApiPropertyOptional({
    description: '告警内容',
    example: '近5分钟拦截率 > 50%',
  })
  @IsOptional()
  @IsString()
  content?: string;
}
