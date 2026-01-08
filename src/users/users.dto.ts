import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'alice' })
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @MinLength(3)
  password!: string;

  @ApiProperty({ description: '角色', enum: ['admin', 'user'] })
  @IsIn(['admin', 'user'])
  role!: 'admin' | 'user';

  @ApiPropertyOptional({ description: '显示名称', example: 'Alice' })
  @IsOptional()
  @IsString()
  displayName?: string;
}
