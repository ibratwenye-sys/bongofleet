import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GpsService } from './gps.service';
import { RecordPhoneFixesDto } from './dto/record-phone-fixes.dto';

// Stage I1 - phone reporting only (§4). POST /gps/device (box ingestion,
// §5) is a separate later stage; the live map, health/tamper alerts and
// public tracking links (§6-8) read GpsLocation but write nothing here.
@ApiTags('gps')
@ApiBearerAuth()
@Controller('gps')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GpsController {
  constructor(private readonly gpsService: GpsService) {}

  @Post('phone')
  @Roles(UserRole.RIDER)
  recordPhoneFixes(@Body() dto: RecordPhoneFixesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.gpsService.recordPhoneFixes(dto, actor);
  }
}
