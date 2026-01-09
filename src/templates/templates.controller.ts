import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  RollbackTemplateDto,
} from './dto/create-template.dto';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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

class TemplateRuleSetVersionResponse {
  @ApiProperty({ description: '版本 ID', example: 12 })
  id!: number;

  @ApiProperty({ description: '模板名称', example: 'ip_whitelist' })
  templateName!: string;

  @ApiProperty({ description: '版本号', example: 3 })
  versionNo!: number;

  @ApiProperty({
    description: '模板规则 JSON',
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

@ApiTags('Templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '列出所有模板最新版本',
    description: '返回模板规则的最新版本，用于前端选择启用。',
  })
  @ApiOkResponse({
    description: '模板列表',
    type: [TemplateRuleSetVersionResponse],
  })
  async listAll() {
    return this.service.list();
  }

  @Get(':templateName/versions')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '查看指定模板的历史版本',
    description: '用于模板版本回溯与回滚。',
  })
  @ApiParam({
    name: 'templateName',
    description: '模板名称',
    example: 'ip_whitelist',
  })
  @ApiOkResponse({
    description: '版本列表',
    type: [TemplateRuleSetVersionResponse],
  })
  async listByName(@Param('templateName') templateName: string) {
    return this.service.list(templateName);
  }

  @Post(':templateName/versions')
  @Roles('admin')
  @ApiOperation({
    summary: '创建模板新版本',
    description: '提交模板规则并生成新版本。',
  })
  @ApiParam({
    name: 'templateName',
    description: '模板名称',
    example: 'ip_whitelist',
  })
  @ApiCreatedResponse({
    description: '新版本信息',
    type: TemplateRuleSetVersionResponse,
  })
  async create(
    @Param('templateName') templateName: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.service.create(
      templateName,
      { meta: { name: templateName }, rules: dto.rules },
      dto.note,
      dto.actor,
    );
  }

  @Post(':templateName/versions/:versionNo/rollback')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary: '回滚模板到指定版本（生成新版本）',
    description: '复制目标版本生成新版本，保留历史。',
  })
  @ApiParam({
    name: 'templateName',
    description: '模板名称',
    example: 'ip_whitelist',
  })
  @ApiParam({
    name: 'versionNo',
    description: '目标版本号',
    example: 2,
  })
  @ApiOkResponse({
    description: '回滚后的新版本',
    type: TemplateRuleSetVersionResponse,
  })
  async rollback(
    @Param('templateName') templateName: string,
    @Param('versionNo') versionNo: string,
    @Body() dto: RollbackTemplateDto,
  ) {
    return this.service.rollback(templateName, Number(versionNo), dto.actor);
  }
}
