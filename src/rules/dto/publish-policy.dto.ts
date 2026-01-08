import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RuleDto } from '../../common/rules/rule.dto';

export class PublishPolicyDto {
  @ApiProperty({
    description: '启用的核心规则集名称列表（一级引用）',
    type: [String],
    example: ['core_sqli_rules'],
  })
  @IsArray()
  @IsString({ each: true })
  enabledCoreRules!: string[];

  @ApiProperty({
    description: '启用的模板名称列表（一级引用）',
    type: [String],
    example: ['ip_whitelist'],
  })
  @IsArray()
  @IsString({ each: true })
  enabledTemplates!: string[];

  @ApiPropertyOptional({
    description:
      '自定义规则数组（按 friendly-waf-json-spec 子集，必填字段：id/target/match/pattern/action）',
    type: [RuleDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules?: RuleDto[];

  @ApiPropertyOptional({
    description: '版本备注',
    example: '上线核心规则+自定义IP黑名单',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: '动态封禁基础得分（policies.dynamicBlock.baseAccessScore）',
    example: 1,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dynamicBlockBaseScore?: number;

  @ApiPropertyOptional({
    description: '仅测试，不落盘/不reload',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: '基线版本号（用于并发冲突校验）',
    minimum: 1,
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  baseVersionId?: number;

  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}
