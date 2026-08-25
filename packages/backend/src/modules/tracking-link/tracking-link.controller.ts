import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TrackingLinkService } from './tracking-link.service';
import { CreateTrackingLinkDto } from './dto/create-tracking-link.dto';

// Stage I2 - same role pair as PaymentAccountController: creating/revoking a
// shareable link is an operational action, not owner-only like Stage SUB1's
// billing page.
@ApiTags('tracking-link')
@ApiBearerAuth()
@Controller('tracking-links')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class TrackingLinkController {
  constructor(private readonly trackingLinkService: TrackingLinkService) {}

  @Post()
  create(@Body() dto: CreateTrackingLinkDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.trackingLinkService.create(dto, actor);
  }

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.trackingLinkService.list(actor);
  }

  @Patch(':id/revoke')
  revoke(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.trackingLinkService.revoke(id, actor);
  }
}
