import { Body, Controller, Get, Patch, Put, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GpsProviderConfigService } from './gps-provider-config.service';
import { UpsertGpsProviderConfigDto } from './dto/upsert-gps-provider-config.dto';

@ApiTags('gps-provider-config')
@ApiBearerAuth()
@Controller('gps-provider-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER)
export class GpsProviderConfigController {
  constructor(private readonly service: GpsProviderConfigService) {}

  // @Res() (non-passthrough) - Nest's own return-value handler treats a
  // controller returning `null`/`undefined` as "send no body at all", which
  // a client then sees as an empty response, not a JSON `null` (verified
  // against this exact route: `null` from the service arrived at the
  // client as `{}`, not `null`, until this was made explicit). res.json(v)
  // always serializes `v` for real, including `null`.
  @Get()
  async get(@CurrentUser() actor: AuthenticatedUser, @Res() res: Response): Promise<void> {
    const config = await this.service.get(actor);
    res.status(200).json(config);
  }

  @Put()
  upsert(@Body() dto: UpsertGpsProviderConfigDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.upsert(dto, actor);
  }

  @Patch('deactivate')
  deactivate(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.deactivate(actor);
  }
}
