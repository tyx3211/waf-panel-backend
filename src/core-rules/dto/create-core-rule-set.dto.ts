import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RuleDto } from '../../common/rules/rule.dto';

export class CreateCoreRuleSetDto {
  @ApiProperty({ description: '核心规则集名称', example: 'core_sqli_rules' })
  @IsString()
  coreName!: string;

  @ApiProperty({
    description: '规则列表（friendly JSON 结构）',
    type: [RuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules!: RuleDto[];

  @ApiPropertyOptional({ description: '备注', example: '补充 SQLi 规则' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}

export class RollbackCoreRuleSetDto {
  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}
