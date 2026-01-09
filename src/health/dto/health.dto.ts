import { ApiProperty } from '@nestjs/swagger';

export class ComponentStatusDto {
  @ApiProperty({
    description: '组件状态',
    enum: ['up', 'down', 'unconfigured'],
    example: 'up',
  })
  status!: 'up' | 'down' | 'unconfigured';
}

export class SmtpComponentStatusDto extends ComponentStatusDto {
  @ApiProperty({ description: 'SMTP 服务器地址', required: false })
  host?: string;
}

export class LokiComponentStatusDto extends ComponentStatusDto {
  @ApiProperty({ description: 'Loki URL', required: false })
  url?: string;
}

export class HealthComponentsDto {
  @ApiProperty({ description: '数据库状态', type: ComponentStatusDto })
  db!: ComponentStatusDto;

  @ApiProperty({
    description: 'Loki 日志服务状态',
    type: LokiComponentStatusDto,
  })
  loki!: LokiComponentStatusDto;

  @ApiProperty({
    description: 'SMTP 邮件服务状态',
    type: SmtpComponentStatusDto,
  })
  smtp!: SmtpComponentStatusDto;
}

export class HealthCheckResponseDto {
  @ApiProperty({
    description: '整体健康状态',
    enum: ['ok', 'degraded', 'unhealthy'],
    example: 'ok',
  })
  status!: 'ok' | 'degraded' | 'unhealthy';

  @ApiProperty({
    description: '检查时间戳 ISO 格式',
    example: '2026-01-09T19:00:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({ description: '各组件状态', type: HealthComponentsDto })
  components!: HealthComponentsDto;
}
