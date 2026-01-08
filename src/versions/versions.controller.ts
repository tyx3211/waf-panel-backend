import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PolicyVersionService } from './policy-version.service';
import { ServerPolicyVersion } from '../entities/server-policy-version.entity';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.decorator';
import { IsOptional, IsString } from 'class-validator';

class RollbackPolicyDto {
  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}

class ServerPolicyVersionResponse {
  @ApiProperty({ description: '版本 ID', example: 12 })
  id!: number;

  @ApiProperty({ description: '站点名称', example: 'example.com' })
  serverName!: string;

  @ApiProperty({ description: '版本号', example: 3 })
  versionNo!: number;

  @ApiProperty({
    description: '策略 JSON（包含 meta/extends/rules 等）',
    type: 'object',
    additionalProperties: true,
  })
  policyJson!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: '启用的 core 规则集名称',
    type: [String],
  })
  enabledCoreRules?: string[];

  @ApiPropertyOptional({
    description: '启用的模板名称',
    type: [String],
  })
  enabledTemplates?: string[];

  @ApiProperty({
    description: '状态',
    enum: ['SUCCESS', 'FAILED', 'ROLLED_BACK'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '备注' })
  note?: string;

  @ApiPropertyOptional({ description: '发布日志摘要' })
  publishLog?: string;

  @ApiPropertyOptional({ description: '创建人', example: 'admin' })
  createdBy?: string;

  @ApiProperty({ description: '创建时间（ISO）' })
  createdAt!: string;

  @ApiProperty({ description: '更新时间（ISO）' })
  updatedAt!: string;
}

@ApiTags('ServerPolicy')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('servers')
export class VersionsController {
  constructor(private readonly service: PolicyVersionService) {}

  @Get(':serverName/versions')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '查看站点策略版本列表',
    description: '按站点名称列出历史版本，便于对比与回滚。',
  })
  @ApiParam({
    name: 'serverName',
    description: '站点名称（nginx server_name）',
    example: 'example1.com',
  })
  @ApiOkResponse({
    description: '版本列表',
    type: [ServerPolicyVersionResponse],
  })
  async list(
    @Param('serverName') serverName: string,
  ): Promise<ServerPolicyVersion[]> {
    return this.service.list(serverName);
  }

  @Post(':serverName/versions/:versionNo/rollback')
  @Roles('admin')
  @ApiOperation({
    summary: '回滚到指定策略版本（生成新版本）',
    description: '复制目标版本生成新版本，并记录审计日志。',
  })
  @ApiParam({
    name: 'serverName',
    description: '站点名称（nginx server_name）',
    example: 'example1.com',
  })
  @ApiParam({
    name: 'versionNo',
    description: '目标版本号',
    example: 2,
  })
  @ApiOkResponse({
    description: '回滚后的新版本',
    type: ServerPolicyVersionResponse,
  })
  async rollback(
    @Param('serverName') serverName: string,
    @Param('versionNo') versionNo: string,
    @Body() dto: RollbackPolicyDto,
  ) {
    return this.service.rollback(serverName, Number(versionNo), dto.actor);
  }
}
