import { Module } from '@nestjs/common';
import { TrackingLinkController } from './tracking-link.controller';
import { TrackingLinkPublicController } from './tracking-link-public.controller';
import { TrackingLinkService } from './tracking-link.service';
import { TrackingLinkPublicService } from './tracking-link-public.service';
import { RolesGuard } from '../../common/guards/roles.guard';

// Stage I2 - two controllers, two very different auth postures (JWT+roles
// vs. genuinely public), one module - same split as Stage SUB1's
// TenantController/TenantBillingController, extended here to a matching
// service split too: TrackingLinkService runs inside the normal tenant-
// scoped request path, TrackingLinkPublicService runs entirely outside it
// (requestContext.runUnscoped) and has no business sharing a class with
// code that assumes a request context exists.
@Module({
  controllers: [TrackingLinkController, TrackingLinkPublicController],
  providers: [TrackingLinkService, TrackingLinkPublicService, RolesGuard],
})
export class TrackingLinkModule {}
