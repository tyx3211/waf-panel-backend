import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BaseLokiQueryDto {
  @ApiProperty({ description: '时间范围，如 5m/1h/24h', example: '1h' })
  @IsString()
  timeRange!: string;

  @ApiPropertyOptional({
    description: '过滤的 serverName',
    example: 'example.com',
  })
  @IsOptional()
  @IsString()
  server?: string;

  @ApiPropertyOptional({
    description: '最大条数（1-1000）',
    minimum: 1,
    maximum: 1000,
    example: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({
    description: '开始时间戳 (ms)',
    example: 1672531200000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  start?: number;

  @ApiPropertyOptional({
    description: '结束时间戳 (ms)',
    example: 1672532200000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  end?: number;
}

export class WafLogsQueryDto extends BaseLokiQueryDto {
  @ApiPropertyOptional({
    description: '过滤动作（ALLOW/BLOCK 等）',
    example: 'BLOCK',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: '过滤规则 ID', example: '1001' })
  @IsOptional()
  @IsString()
  ruleId?: string;

  @ApiPropertyOptional({ description: '过滤客户端 IP', example: '1.2.3.4' })
  @IsOptional()
  @IsString()
  clientIp?: string;
}

export class GeoModeQueryDto extends BaseLokiQueryDto {
  @ApiProperty({
    description: '模式：visit=访问量，block=拦截量',
    enum: ['visit', 'block'],
  })
  @IsEnum(['visit', 'block'])
  mode!: 'visit' | 'block';
}

// --- 缺失的响应 DTO ---

export class WafStatsResponseDto {
  @ApiProperty()
  summary!: {
    requests: number;
    blocks: number;
    blockRate: number;
    uniqueIps: number;
    attackIps: number;
    dynamicBlocks: number;
    blacklistHits: number;
  };
  @ApiProperty()
  byAttackType!: Array<{ type: string; count: number }>;
  @ApiProperty()
  byAction!: Array<{ action: string; count: number }>;
  @ApiPropertyOptional()
  warnings?: string[];
}

export class AccessStatsResponseDto {
  @ApiProperty()
  summary!: {
    requests: number;
    blocks: number;
    uniqueIps: number;
    status4xx: number;
    status5xx: number;
    qpsAvg: number;
  };
  @ApiProperty()
  byHost!: Array<{ host: string; requests: number; blocks: number }>;
  @ApiProperty()
  byUpstreamStatus!: Array<{ status: string; count: number }>;
  @ApiProperty()
  reqLen!: { avg: number; p95: number; max: number };
  @ApiProperty()
  upRt!: { avg: number; p95: number; max: number };
}

export class AccessTimeseriesResponseDto {
  @ApiProperty()
  intervalSeconds!: number;
  @ApiProperty()
  points!: Array<{
    ts: number;
    requests: number;
    blocks: number;
    latency: number;
  }>;
}

export class GeoStatsResponseDto {
  @ApiProperty()
  mode!: 'visit' | 'block';
  @ApiProperty()
  scope!: 'world' | 'china';
  @ApiProperty()
  heatmap!: Array<{ code: string; count: number }>;
  @ApiProperty()
  top!: Array<{ name: string; count: number }>;
}
