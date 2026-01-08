import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { RuleDto } from '../../common/rules/rule.dto';

export class CreateTemplateDto {
  @ApiProperty({ description: '模板名称', example: 'ip_whitelist' })
  @IsString()
  templateName!: string;

  @ApiProperty({
    description: '规则列表（friendly JSON 结构）',
    type: [RuleDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules!: RuleDto[];

  @ApiPropertyOptional({ description: '备注', example: '自定义 IP 白名单模板' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}

export class RollbackTemplateDto {
  @ApiPropertyOptional({ description: '操作者', example: 'alice' })
  @IsOptional()
  @IsString()
  actor?: string;
}
