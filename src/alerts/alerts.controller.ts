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
  @ApiOkResponse({ description: '告警配置', type: UpdateAlertConfigDto })
  getConfig() {
    return this.alerts.getConfig();
  }

  @Put('config')
  @Roles('admin')
  @ApiOperation({
    summary: '更新告警配置',
    description: '更新告警开关、收件人列表与阈值配置，并记录审计。',
  })
  @ApiOkResponse({ description: '更新后的告警配置', type: UpdateAlertConfigDto })
  update(
    @Body() dto: UpdateAlertConfigDto,
    @Req() req: Request,
  ) {
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
  @ApiOkResponse({ description: '发送结果' })
  send(@Body() dto: SendAlertDto, @Req() req: Request) {
    const actor = req.user?.username;
    return this.alerts.send(dto, actor);
  }
}
