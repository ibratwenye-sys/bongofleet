import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TrackingLinkPublicService } from './tracking-link-public.service';

/**
 * Stage I2 (§8) - the first genuinely unauthenticated route in this
 * codebase. Deliberately NO @UseGuards at all: not JwtAuthGuard (there is
 * no session), not RolesGuard (there is no role), and NOT @AllowWhenLocked
 * either - that decorator opts a JWT-authenticated route out of the
 * tenant-lock check, a different problem from having no auth in the first
 * place. The public/track prefix keeps this off /tracking-links entirely
 * rather than living as an unguarded route on that controller.
 *
 * Rate-limited by PUBLIC_TRACK_IP_THROTTLE (throttle.constants.ts /
 * throttler-options.factory.ts) - abuse hygiene, not the actual security
 * boundary, which is the token's own 32-byte CSPRNG entropy.
 */
@ApiTags('tracking-link-public')
@Controller('public/track')
export class TrackingLinkPublicController {
  constructor(private readonly trackingLinkPublicService: TrackingLinkPublicService) {}

  @Get(':token')
  @Header('X-Robots-Tag', 'noindex')
  getByToken(@Param('token') token: string) {
    return this.trackingLinkPublicService.getByToken(token);
  }
}
