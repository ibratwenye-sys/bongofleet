import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DriverService } from './driver.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { ListDriversQueryDto } from './dto/list-drivers-query.dto';
import { SearchDriversQueryDto } from './dto/search-drivers-query.dto';
import { ResetDriverPasswordDto } from './dto/reset-driver-password.dto';
import { PasswordResetService } from '../auth/password-reset.service';

// 'riders' kept as an alias for one release so an un-updated dashboard or
// phone build still calling the old path does not break. Drop once nothing
// still calls /riders.
@Controller(['drivers', 'riders'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class DriverController {
  constructor(
    private readonly driverService: DriverService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post()
  create(@Body() dto: CreateDriverDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.driverService.create(dto, actor);
  }

  @Get()
  list(@Query() query: ListDriversQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.driverService.list(query, actor);
  }

  // Must stay ahead of `:id` below - Nest matches routes in declaration
  // order, and "search" would otherwise be swallowed as an :id value.
  //
  // Explicit @Roles here even though the class-level one above already
  // covers it (getAllAndOverride falls back to class metadata when a
  // handler has none - RolesGuard already 403s a RIDER on this route
  // without this line). Written anyway, matching the excusal endpoints'
  // per-method style: this returns names, phone numbers, and plates for
  // every driver in the fleet, and that shouldn't depend on nobody ever
  // adding a handler-level @Roles to a sibling method that shadows the
  // class-level fallback out from under this one.
  @Get('search')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  search(@Query() query: SearchDriversQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.driverService.search(query, actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.driverService.get(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDriverDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.driverService.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.driverService.deactivate(id, actor);
  }

  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.driverService.reactivate(id, actor);
  }

  /**
   * Stage H0f - OWNER only, narrowing this class's OWNER|MANAGER default.
   * Whoever can set a rider's password can sign in as that rider and record
   * payments as him; this product exists to reduce that kind of fraud, so
   * the capability sits with the person who carries the loss rather than
   * with everyone who can edit a driver record.
   *
   * Widening it to MANAGER later is one value added to the @Roles list on
   * the line below. This comment exists so that stays a decision someone
   * makes, rather than something that drifts.
   *
   * Cross-tenant ids return 404 rather than 403 - see the service; a 403
   * would confirm the id is real.
   */
  @Patch(':id/password')
  @Roles(UserRole.OWNER)
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetDriverPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.passwordResetService.resetDriverPasswordAsOwner(id, dto.newPassword, actor);
  }
}
