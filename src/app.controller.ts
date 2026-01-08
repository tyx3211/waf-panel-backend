import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Root')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: '健康回声',
    description: '用于最简存活验证与链路连通性确认。',
  })
  @ApiOkResponse({ description: '简单字符串', schema: { type: 'string' } })
  getHello(): string {
    return this.appService.getHello();
  }
}
