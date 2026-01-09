import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LokiService } from './loki.service';
import {
  GeoModeQueryDto,
  WafLogsQueryDto,
  BaseLokiQueryDto,
} from './dto/log-query.dto';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/guards/roles.decorator';
import {
  AccessStatsResponseDto,
  AccessTimeseriesResponseDto,
  GeoStatsResponseDto,
  LokiLogsResponseDto,
  WafStatsResponseDto,
} from './dto/log-response.dto';

@ApiTags('Loki')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logs/loki')
export class LokiController {
  constructor(private readonly loki: LokiService) {}

  @Get('waf/logs')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '查询 WAF 审计日志（Loki）',
    description: '按时间范围与过滤条件查询审计日志。',
  })
  @ApiOkResponse({
    description: 'Loki 查询结果',
    type: LokiLogsResponseDto,
  })
  async getWafLogs(@Query() q: WafLogsQueryDto): Promise<LokiLogsResponseDto> {
    return this.loki.queryWafLogs(q);
  }

  @Get('waf/stats')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '获取 WAF 统计（Loki 查询结果）',
    description: '返回拦截数、攻击类型分布等统计聚合结果。',
  })
  @ApiOkResponse({
    description: '统计结果',
    type: WafStatsResponseDto,
  })
  async getWafStats(
    @Query() q: BaseLokiQueryDto,
  ): Promise<WafStatsResponseDto> {
    return this.loki.queryWafStats(q);
  }

  @Get('access/stats')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '访问统计（Loki 查询结果）',
    description: '返回 PV/UV/QPS 等访问指标统计。',
  })
  @ApiOkResponse({
    description: '统计结果',
    type: AccessStatsResponseDto,
  })
  async getAccessStats(
    @Query() q: BaseLokiQueryDto,
  ): Promise<AccessStatsResponseDto> {
    return this.loki.queryAccessStats(q);
  }

  @Get('access/timeseries')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '访问时序（Loki 查询结果）',
    description: '返回指定时间范围内的时序折线数据。',
  })
  @ApiOkResponse({
    description: '时序结果',
    type: AccessTimeseriesResponseDto,
  })
  async getAccessTimeseries(
    @Query() q: BaseLokiQueryDto,
  ): Promise<AccessTimeseriesResponseDto> {
    return this.loki.queryAccessTimeseries(q);
  }

  @Get('geo/world')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '世界地图聚合（Loki 查询结果）',
    description: '返回国家级访问/拦截地理聚合。',
  })
  @ApiOkResponse({
    description: '地理聚合结果',
    type: GeoStatsResponseDto,
  })
  async geoWorld(@Query() q: GeoModeQueryDto): Promise<GeoStatsResponseDto> {
    return this.loki.queryGeo(q, 'world');
  }

  @Get('geo/china')
  @Roles('admin', 'user')
  @ApiOperation({
    summary: '中国地图聚合（Loki 查询结果）',
    description: '返回省市级访问/拦截地理聚合。',
  })
  @ApiOkResponse({
    description: '地理聚合结果',
    type: GeoStatsResponseDto,
  })
  async geoChina(@Query() q: GeoModeQueryDto): Promise<GeoStatsResponseDto> {
    return this.loki.queryGeo(q, 'china');
  }
}
