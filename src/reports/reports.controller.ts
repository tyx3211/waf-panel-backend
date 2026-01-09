import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.decorator';
import { WafReportSummaryDto } from './dto/waf-report.dto';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('waf')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '获取防护报告（JSON 摘要）',
    description: '返回防护报告摘要数据，用于前端图表渲染。',
  })
  @ApiOkResponse({ description: '报告摘要', type: WafReportSummaryDto })
  @ApiQuery({ name: 'timeRange', required: false, description: '24h, 7d' })
  getReport(@Query('timeRange') timeRange?: string) {
    return this.reports.getSummary(timeRange);
  }
}
