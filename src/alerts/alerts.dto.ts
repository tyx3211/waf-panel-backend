import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsObject,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AlertThresholds } from './alerts.service';

export class AlertThresholdsDto {
  @ApiPropertyOptional({ description: '总拦截率阈值 (0.0 - 1.0)', example: 0.5 })
  @IsNumber()
  @IsOptional()
  blockRate?: number;

  @ApiPropertyOptional({ description: '总 QPS 阈值', example: 500 })
  @IsNumber()
  @IsOptional()
  qps?: number;

  @ApiPropertyOptional({
    description: '特定攻击类型的拦截计数阈值',
    additionalProperties: { type: 'number' },
    example: { SQL_INJECTION: 50 },
  })
  @IsOptional()
  @IsObject()
  attackTypeCounts?: Record<string, number>;
}

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
    type: AlertThresholdsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AlertThresholdsDto)
  thresholds?: AlertThresholdsDto;
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
