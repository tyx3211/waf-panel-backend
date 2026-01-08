import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.decorator';

class OpsAuditLogResponse {
  @ApiProperty({ description: '日志 ID', example: 100 })
  id!: number;

  @ApiProperty({
    description: '动作类型',
    example: 'PUBLISH_POLICY',
  })
  actionType!: string;

  @ApiProperty({ description: '目标类型', example: 'server' })
  targetType!: string;

  @ApiPropertyOptional({ description: '目标名称', example: 'example.com' })
  targetName?: string;

  @ApiProperty({
    description: '执行状态',
    enum: ['SUCCESS', 'FAILED'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '操作者', example: 'admin' })
  actor?: string;

  @ApiPropertyOptional({ description: '备注' })
  note?: string;

  @ApiPropertyOptional({
    description: '细节（steps/rollbackSteps 等摘要）',
    type: 'object',
    additionalProperties: true,
  })
  detail?: Record<string, unknown>;

  @ApiProperty({ description: '创建时间（ISO）' })
  createdAt!: string;
}

@ApiTags('Audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('audit/ops')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get('logs')
  @Roles('admin')
  @ApiOperation({
    summary: '查询操作审计日志',
    description: '按时间范围/操作者/动作类型等条件查询审计日志。',
  })
  @ApiQuery({
    name: 'timeRange',
    required: false,
    description: '时间范围，如 24h',
  })
  @ApiQuery({ name: 'actor', required: false, description: '操作者' })
  @ApiQuery({ name: 'actionType', required: false, description: '动作类型' })
  @ApiQuery({ name: 'target', required: false, description: '目标名称' })
  @ApiQuery({ name: 'status', required: false, description: '状态' })
  @ApiQuery({ name: 'limit', required: false, description: '条数，默认50' })
  @ApiOkResponse({
    description: '审计列表',
    type: [OpsAuditLogResponse],
  })
  async list(
    @Query('timeRange') timeRange?: string,
    @Query('actor') actor?: string,
    @Query('actionType') actionType?: string,
    @Query('target') target?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({
      timeRange,
      actor,
      actionType,
      target,
      status,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('logs/:id')
  @Roles('admin')
  @ApiOperation({
    summary: '审计详情',
    description: '返回单条审计日志详情（含 steps/rollbackSteps 摘要）。',
  })
  @ApiParam({
    name: 'id',
    description: '审计日志 ID',
    example: 100,
  })
  @ApiOkResponse({
    description: '审计详情',
    type: OpsAuditLogResponse,
  })
  async detail(@Param('id') id: string) {
    return this.service.detail(Number(id));
  }
}
