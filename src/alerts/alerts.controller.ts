import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { SendAlertDto, UpdateAlertConfigDto } from './alerts.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.decorator';
import type { Request } from 'express';
import type { AlertConfig } from './alerts.service';

class AlertThresholdsDto {
  @ApiProperty({
    required: false,
    description: '拦截率阈值，0-1 之间小数',
    example: 0.5,
  })
  blockRate?: number;

  @ApiProperty({ required: false, description: 'QPS 阈值', example: 200 })
  qps?: number;

  @ApiProperty({
    required: false,
    description: '按攻击类型的计数阈值，key 为攻击类型',
    example: { SQL_INJECTION: 10, XSS: 5 },
    type: Object,
  })
  attackTypeCounts?: Record<string, number>;
}

class AlertConfigResponse {
  @ApiProperty({ description: '是否开启告警', example: true })
  enabled!: boolean;

  @ApiProperty({
    description: '收件人邮箱列表',
    type: [String],
    example: ['ops@example.com'],
  })
  emails!: string[];

  @ApiProperty({ description: '阈值配置', type: AlertThresholdsDto })
  thresholds!: AlertThresholdsDto;

  @ApiProperty({ required: false, description: '最近更新人', example: 'admin' })
  updatedBy?: string;

  @ApiProperty({
    required: false,
    description: '最近更新时间',
    example: '2026-01-03T01:23:45Z',
  })
  updatedAt?: string;
}

class SendAlertResponse {
  @ApiProperty({ description: '是否已发送（需开启且有收件人）' })
  sent!: boolean;
  @ApiProperty({ description: '标题' })
  subject!: string;
  @ApiProperty({ description: '正文' })
  content!: string;
  @ApiProperty({ description: '收件人列表', type: [String] })
  recipients!: string[];
  @ApiProperty({ description: '发送时间 ISO 字符串' })
  sentAt!: string;
  @ApiProperty({
    required: false,
    description: '失败原因（未开启、无收件人或 SMTP 错误）',
  })
  error?: string;
}

@ApiTags('Alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('config')
  @Roles('admin')
  @ApiOperation({
    summary: '获取告警配置',
    description: '读取当前告警开关、收件人列表与阈值配置。',
  })
  @ApiOkResponse({ description: '告警配置', type: AlertConfigResponse })
  getConfig(): Promise<AlertConfig> {
    return this.alerts.getConfig();
  }

  @Put('config')
  @Roles('admin')
  @ApiOperation({
    summary: '更新告警配置',
    description: '更新告警开关、收件人列表与阈值配置，并记录审计。',
  })
  @ApiOkResponse({ description: '更新后的告警配置', type: AlertConfigResponse })
  update(
    @Body() dto: UpdateAlertConfigDto,
    @Req() req: Request,
  ): Promise<AlertConfig> {
    const actor = req.user?.username;
    return this.alerts.updateConfig(dto, actor);
  }

  @Post('send')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary: '手动触发告警（演练/测试）',
    description: '根据当前配置发送告警邮件，写入发送记录与审计。',
  })
  @ApiOkResponse({ description: '发送结果', type: SendAlertResponse })
  send(@Body() dto: SendAlertDto, @Req() req: Request) {
    const actor = req.user?.username;
    return this.alerts.send(dto, actor);
  }
}
