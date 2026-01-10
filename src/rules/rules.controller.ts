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
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
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

class UpdateGlobalConfigDto {
  @ApiPropertyOptional({ description: 'Trust XFF (on/off->boolean)' })
  @IsBoolean()
  @IsOptional()
  trustXff?: boolean;

  @ApiPropertyOptional({ description: 'JSON Log Level' })
  @IsString()
  @IsOptional()
  logLevel?: string;

  @ApiPropertyOptional({ description: 'Dynamic Block Score Threshold' })
  @IsNumber()
  @IsOptional()
  dynamicBlockScore?: number;

  @ApiPropertyOptional({ description: 'Dynamic Block Duration (e.g. 30m)' })
  @IsString()
  @IsOptional()
  dynamicBlockDuration?: string;

  @ApiPropertyOptional({ description: 'Dynamic Block Window Size (e.g. 1m)' })
  @IsString()
  @IsOptional()
  dynamicBlockWindow?: string;

  @ApiPropertyOptional({ description: '变更备注' })
  @IsString()
  @IsOptional()
  note?: string;

  // Actor injected by controller usually, but here manual for simplicity
  @IsString()
  @IsOptional()
  actor?: string;
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

  @Get('global/nginx-params')
  @Roles('admin')
  @ApiOperation({ summary: '获取全局 Nginx WAF 参数 (http级)', description: 'Trust XFF, Log Level, Dynamic Block Score' })
  @ApiOkResponse({ type: UpdateGlobalConfigDto })
  async getGlobalConfig() {
    return this.publishService.getGlobalConfig();
  }

  @Put('global/nginx-params')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({ summary: '更新全局 Nginx WAF 参数', description: '修改 http 块内的 WAF 指令并 reload' })
  async updateGlobalConfig(@Body() dto: UpdateGlobalConfigDto) {
    return this.publishService.updateGlobalConfig(dto);
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



  @Get(':serverName/runtime')
  @Roles('admin')
  // ... (existing getRuntime content)
  @ApiOperation({
    summary: '获取当前运行态配置（直接从 nginx.conf 读取）',
    description: '通过 Crossplane 解析 nginx.conf，返回指定站点的 WAF 运行态开关状态。',
  })
  @ApiParam({
    name: 'serverName',
    description: '站点名称（nginx server_name）',
    example: 'example1.com',
  })
  async getRuntime(@Param('serverName') serverName: string) {
    return this.publishService.getRuntime(serverName);
  }
}


