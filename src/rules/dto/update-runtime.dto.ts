import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateRuntimeDto {
  @ApiPropertyOptional({
    description: '是否启用 WAF（入口开关，true=启用，false=旁路）',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  wafEnabled?: boolean;

  @ApiPropertyOptional({
    description: '是否启用动态封禁（true=打开动态信誉/封禁）',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  dynamicBlockEnabled?: boolean;

  @ApiPropertyOptional({
    description: '默认动作（DENY/BYPASS/ALLOW），空则保持现状',
    example: 'DENY',
  })
  @IsOptional()
  @IsString()
  defaultAction?: string;

  @ApiPropertyOptional({ description: '操作者', example: 'ops-user' })
  @IsOptional()
  @IsString()
  actor?: string;

  @ApiPropertyOptional({
    description: '备注',
    example: '紧急旁路 30 分钟',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
