import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: '健康检查',
    description: '用于探测后端与数据库的基础可用性。',
  })
  @ApiOkResponse({
    description: '健康状态',
    schema: { type: 'object', additionalProperties: true },
  })
  async getHealth() {
    return this.healthService.check();
  }
}
