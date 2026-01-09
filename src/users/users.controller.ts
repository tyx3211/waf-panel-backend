import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../common/guards/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateUserDto } from './users.dto';
import type { Request } from 'express';

class UserResponse {
  @ApiProperty({ description: '用户 ID', example: 1 })
  id!: number;
  @ApiProperty({ description: '用户名', example: 'admin' })
  username!: string;
  @ApiProperty({ description: '角色', enum: ['admin', 'user'] })
  role!: 'admin' | 'user';
  @ApiProperty({ required: false, description: '显示名称', example: 'Admin' })
  displayName?: string;
  @ApiProperty({ description: '是否内置账号', example: true })
  builtIn!: boolean;
}

@ApiTags('Users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({
    summary: '用户列表（admin 可见）',
    description: '返回所有用户基础信息，仅管理员可访问。',
  })
  @ApiOkResponse({ description: '用户数组', type: [UserResponse] })
  list() {
    return this.auth.listUsers();
  }

  @Post()
  @Roles('admin')
  @ApiOperation({
    summary: '创建用户（admin）',
    description: '创建普通用户或管理员账号，密码会进行哈希存储。',
  })
  @ApiCreatedResponse({ description: '创建后的用户', type: UserResponse })
  create(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({
    summary: '查看用户',
    description: '按用户 ID 查询单个用户信息。',
  })
  @ApiParam({
    name: 'id',
    description: '用户 ID',
    example: 1,
  })
  @ApiOkResponse({ description: '用户', type: UserResponse })
  get(@Param('id') id: string) {
    return this.auth.getUser(Number(id));
  }

  @Delete('me')
  @ApiOperation({
    summary: '自销账号（内置账号不可销）',
    description: '当前用户自销；内置账号禁止删除。',
  })
  @ApiOkResponse({ description: '被删除的用户', type: UserResponse })
  deleteSelf(@Req() req: Request) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('unauthorized');
    }
    return this.auth.deleteSelf(userId);
  }
}
