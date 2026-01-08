import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  RULE_ACTIONS,
  RULE_MATCHES,
  RULE_TARGETS,
  type RuleAction,
  type RuleMatch,
  type RuleTarget,
} from './rule-schema';
import { IsStringOrStringArray } from '../validators/string-or-string-array.validator';

export class RuleDto {
  @ApiProperty({
    description: '规则 ID（整数）',
    example: 1001,
  })
  @Type(() => Number)
  @IsInt()
  id!: number;

  @ApiProperty({
    description: '匹配目标（可为单个或数组）',
    example: 'URI',
    enum: RULE_TARGETS,
  })
  @IsStringOrStringArray([...RULE_TARGETS])
  target!: RuleTarget | RuleTarget[];

  @ApiProperty({
    description: '匹配方式',
    example: 'CONTAINS',
    enum: RULE_MATCHES,
  })
  @IsIn(RULE_MATCHES)
  match!: RuleMatch;

  @ApiProperty({
    description: '匹配模式（可为单个或数组）',
    example: '/admin',
  })
  @IsStringOrStringArray()
  pattern!: string | string[];

  @ApiProperty({
    description: '动作',
    example: 'DENY',
    enum: RULE_ACTIONS,
  })
  @IsIn(RULE_ACTIONS)
  action!: RuleAction;

  @ApiPropertyOptional({
    description: '扣分（>=0，仅动态信誉场景使用）',
    example: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  score?: number;

  @ApiPropertyOptional({
    description: '忽略大小写',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  caseless?: boolean;

  @ApiPropertyOptional({
    description: '取反（negate）',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  negate?: boolean;

  @ApiPropertyOptional({
    description: '当 target=HEADER 时必填，指定 header 名称',
    example: 'User-Agent',
  })
  @IsOptional()
  @IsString()
  headerName?: string;

  @ApiPropertyOptional({
    description: '规则标签（用于攻击类型归类）',
    type: [String],
    example: ['sqli'],
  })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];
}
