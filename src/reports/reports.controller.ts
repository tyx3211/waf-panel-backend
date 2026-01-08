import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
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
  getReport() {
    return this.reports.getSummary();
  }

  @Get('waf/export')
  @Roles('admin', 'user')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="waf-report.pdf"')
  @ApiOperation({
    summary: '导出防护报告 PDF',
    description: '导出当前报告摘要的 PDF 文件。',
  })
  @ApiOkResponse({
    description: 'PDF 文件',
    schema: { type: 'string', format: 'binary' },
  })
  async exportPdf(@Res() res: Response) {
    const summary = await this.reports.getSummary();
    const buf = this.reports.getPdfBuffer(summary);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  }
}
