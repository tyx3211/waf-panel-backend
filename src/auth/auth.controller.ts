import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt.guard';
import { RequestUser } from './decorators/request-user.decorator';
import type { UserPayload } from './auth.service';

class AuthUserDto {
  @ApiProperty({ description: '用户 ID', example: 1 })
  id!: number;

  @ApiProperty({ description: '用户名', example: 'admin' })
  username!: string;

  @ApiProperty({ description: '角色', enum: ['admin', 'user'] })
  role!: 'admin' | 'user';
}

class TokenResponseDto {
  @ApiProperty({ description: 'Access Token（JWT）' })
  accessToken!: string;

  @ApiProperty({ description: 'Refresh Token（JWT）' })
  refreshToken!: string;

  @ApiProperty({ description: 'Access Token 过期时间（如 15m）' })
  expiresIn!: string;

  @ApiProperty({ description: 'Refresh Token 过期时间（如 7d）' })
  refreshExpiresIn!: string;

  @ApiProperty({ description: '用户信息', type: AuthUserDto })
  user!: AuthUserDto;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary:
      '登录获取 access/refresh token（内置 demo 用户：admin/admin、user/user；可通过 env 覆盖）',
    description:
      '返回 access/refresh 双 token 与用户信息，用于后续受保护接口的 Bearer 鉴权。',
  })
  @ApiOkResponse({ description: 'token 信息', type: TokenResponseDto })
  async login(@Body() dto: LoginDto) {
    const payload = await this.auth.validateUser(dto.username, dto.password);
    const { tokens, user } = await this.auth.login(payload);
    return { ...tokens, user };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: '使用 refreshToken 换取新的 access/refresh token',
    description: 'refreshToken 有效时颁发新 token；用于无感续期。',
  })
  @ApiOkResponse({ description: '新的 token 信息', type: TokenResponseDto })
  async refresh(@Body() dto: RefreshDto) {
    const { tokens, user } = await this.auth.refresh(dto.refreshToken);
    return { ...tokens, user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取当前用户信息（需 Bearer Token）',
    description: '返回当前登录用户的基础信息与角色。',
  })
  @ApiOkResponse({ description: '用户信息', type: AuthUserDto })
  me(@RequestUser() user: UserPayload) {
    return user;
  }
}
