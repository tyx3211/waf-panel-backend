import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Put,
  Get,
  UseGuards,
} from '@nestjs/common';
import { PublishPolicyDto } from './dto/publish-policy.dto';
import { PolicyPublishService } from './policy-publish.service';
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
import { UpdateRuntimeDto } from './dto/update-runtime.dto';

class PipelineStepResultDto {
  @ApiProperty({
    description: '步骤标识',
    enum: [
      'composePolicy',
      'writePolicyFile',
      'updateNginxConf',
      'nginxTest',
      'nginxReload',
      'restoreNginxConf',
    ],
  })
  key!: string;

  @ApiProperty({
    description: '步骤状态',
    enum: ['SUCCESS', 'WARN', 'FAILED', 'SKIPPED', 'PENDING'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '提示/摘要信息' })
  message?: string;

  @ApiPropertyOptional({ description: '标准输出' })
  stdout?: string;

  @ApiPropertyOptional({ description: '标准错误' })
  stderr?: string;
}

class PublishPolicyResponseDto {
  @ApiProperty({
    description: '发布状态',
    enum: ['SUCCESS', 'FAILED'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '新版本号（失败时可能为空）' })
  version?: number;

  @ApiProperty({ description: '是否为 dryRun', example: false })
  dryRun!: boolean;

  @ApiProperty({ description: '发布日志摘要（含步骤输出）' })
  publishLog!: string;

  @ApiProperty({ description: '执行步骤', type: [PipelineStepResultDto] })
  steps!: PipelineStepResultDto[];

  @ApiProperty({
    description: '回滚步骤（若有）',
    type: [PipelineStepResultDto],
  })
  rollbackSteps!: PipelineStepResultDto[];

  @ApiPropertyOptional({ description: '失败原因（仅失败时）' })
  error?: string;
}

class RuntimeUpdateResponseDto {
  @ApiProperty({
    description: '发布状态',
    enum: ['SUCCESS', 'FAILED'],
  })
  status!: string;

  @ApiPropertyOptional({ description: '新版本号（失败时可能为空）' })
  version?: number;

  @ApiProperty({ description: '发布日志摘要（含步骤输出）' })
  publishLog!: string;

  @ApiProperty({ description: '执行步骤', type: [PipelineStepResultDto] })
  steps!: PipelineStepResultDto[];

  @ApiProperty({
    description: '回滚步骤（若有）',
    type: [PipelineStepResultDto],
  })
  rollbackSteps!: PipelineStepResultDto[];

  @ApiPropertyOptional({ description: '失败原因（仅失败时）' })
  error?: string;
}

@ApiTags('ServerPolicy')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('servers')
export class RulesController {
  constructor(private readonly publishService: PolicyPublishService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: '列出所有纳管的站点 (serverName)' })
  @ApiOkResponse({ description: 'Server Names', type: [String] })
  async listServers() {
    return this.publishService.listAllServers();
  }

  @Post(':serverName/publish')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary:
      '下发并创建新策略版本（生成规则文件 → 更新 nginx.conf → 校验 → reload）',
    description:
      '组合策略 JSON 并写入规则文件，更新 nginx.conf 后执行 `nginx -t -q` 与 reload；失败会回滚并返回步骤日志。',
  })
  @ApiParam({
    name: 'serverName',
    description: '站点名称（nginx server_name）',
    example: 'example1.com',
  })
  @ApiOkResponse({
    description: '发布结果（结构化 steps 与 publishLog）',
    type: PublishPolicyResponseDto,
  })
  async publish(
    @Param('serverName') serverName: string,
    @Body() dto: PublishPolicyDto,
  ) {
    return this.publishService.publish(serverName, dto);
  }

  @Put(':serverName/runtime')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({
    summary:
      '修改运行态开关（wafEnabled/dynamicBlock/defaultAction），带锁与失败回滚',
    description:
      '基于最新策略生成新版本并更新 nginx.conf，失败时回滚；返回结构化步骤输出。',
  })
  @ApiParam({
    name: 'serverName',
    description: '站点名称（nginx server_name）',
    example: 'example1.com',
  })
  @ApiOkResponse({
    description: '运行态更新结果（steps/rollbackSteps）',
    type: RuntimeUpdateResponseDto,
  })
  async updateRuntime(
    @Param('serverName') serverName: string,
    @Body() dto: UpdateRuntimeDto,
  ) {
    return this.publishService.updateRuntime(serverName, dto);
  }
}
