import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CoreRulesService } from './core-rules.service';
import {
  CreateCoreRuleSetDto,
  RollbackCoreRuleSetDto,
} from './dto/create-core-rule-set.dto';
import { FACTORY_VERSION_NO } from '../common/rules/consts';
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

class CoreRuleSetVersionResponse {
  @ApiProperty({ description: '版本 ID', example: 12 })
  id!: number;

  @ApiProperty({ description: '核心规则集名称', example: 'core_sqli_rules' })
  coreName!: string;

  @ApiProperty({ description: '版本号', example: 3 })
  versionNo!: number;

  @ApiProperty({
    description: '核心规则 JSON',
    type: 'object',
    additionalProperties: true,
  })
  rulesJson!: Record<string, unknown>;

  @ApiProperty({
    description: '状态',
    enum: ['SUCCESS', 'FAILED', 'ROLLED_BACK'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '备注' })
  note?: string;

  @ApiPropertyOptional({ description: '创建人', example: 'admin' })
  createdBy?: string;

  @ApiProperty({ description: '创建时间（ISO）' })
  createdAt!: string;

  @ApiProperty({ description: '更新时间（ISO）' })
  updatedAt!: string;
}

@ApiTags('CoreRules')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('core-rules')
export class CoreRulesController {
  constructor(private readonly service: CoreRulesService) {}

  @Get()
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '列出所有核心规则集最新版本',
    description: '返回各核心规则集的最新版本，用于前端初始化展示。',
  })
  @ApiOkResponse({
    description: '核心规则集列表',
    type: [CoreRuleSetVersionResponse],
  })
  async listAll() {
    return this.service.list();
  }

  @Get(':coreName/versions')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '查看指定核心规则集的历史版本',
    description: '用于版本历史查询与回滚选择。',
  })
  @ApiParam({
    name: 'coreName',
    description: '核心规则集名称',
    example: 'core_sqli_rules',
  })
  @ApiOkResponse({
    description: '版本列表',
    type: [CoreRuleSetVersionResponse],
  })
  async listByName(@Param('coreName') coreName: string) {
    return this.service.list(coreName);
  }

  @Post(':coreName/versions')
  @Roles('admin')
  @ApiOperation({
    summary: '创建核心规则集新版本',
    description: '提交规则内容并生成新版本（从 v1.1 起可编辑）。',
  })
  @ApiParam({
    name: 'coreName',
    description: '核心规则集名称',
    example: 'core_sqli_rules',
  })
  @ApiOkResponse({
    description: '新版本信息',
    type: CoreRuleSetVersionResponse,
  })
  async create(
    @Param('coreName') coreName: string,
    @Body() dto: CreateCoreRuleSetDto,
  ) {
    return this.service.create(
      coreName,
      { meta: { name: coreName }, rules: dto.rules },
      dto.note,
      dto.actor,
    );
  }

  @Post(':coreName/versions/:versionNo/rollback')
  @Roles('admin')
  @ApiOperation({
    summary: '回滚核心规则集到指定版本（生成新版本）',
    description: '复制目标版本生成新版本，保留历史。',
  })
  @ApiParam({
    name: 'coreName',
    description: '核心规则集名称',
    example: 'core_sqli_rules',
  })
  @ApiParam({
    name: 'versionNo',
    description: '目标版本号',
    example: 2,
  })
  @ApiOkResponse({
    description: '回滚后的新版本',
    type: CoreRuleSetVersionResponse,
  })
  async rollback(
    @Param('coreName') coreName: string,
    @Param('versionNo') versionNo: string,
    @Body() dto: RollbackCoreRuleSetDto,
  ) {
    return this.service.rollback(coreName, Number(versionNo), dto.actor);
  }

  @Post(':coreName/restore-factory')
  @Roles('admin')
  @ApiOperation({
    summary: '恢复核心规则集到出厂版本 v1.0',
    description: '按出厂基线回滚并生成新版本。',
  })
  @ApiParam({
    name: 'coreName',
    description: '核心规则集名称',
    example: 'core_sqli_rules',
  })
  @ApiOkResponse({
    description: '回滚后的新版本（出厂）',
    type: CoreRuleSetVersionResponse,
  })
  async restoreFactory(
    @Param('coreName') coreName: string,
    @Body() dto: RollbackCoreRuleSetDto,
  ) {
    return this.service.rollback(coreName, FACTORY_VERSION_NO, dto.actor);
  }
}
