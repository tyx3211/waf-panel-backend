import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { HealthCheckResponseDto } from './dto/health.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: '健康检查',
    description:
      '检查后端与各组件（数据库、Loki、SMTP）的可用性。status: ok=全部正常, degraded=非关键组件异常, unhealthy=关键组件异常',
  })
  @ApiOkResponse({
    description: '健康状态',
    type: HealthCheckResponseDto,
  })
  async getHealth(): Promise<HealthCheckResponseDto> {
    return this.healthService.check();
  }
}
