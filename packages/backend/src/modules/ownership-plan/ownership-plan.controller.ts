import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OwnershipPlanService } from './ownership-plan.service';
import { OwnershipPlanGeneratorService } from './ownership-plan-generator.service';
import { OwnershipPlanContractService } from './ownership-plan-contract.service';
import { CreateOwnershipPlanDto } from './dto/create-ownership-plan.dto';
import { UpdateOwnershipPlanDto } from './dto/update-ownership-plan.dto';

// No DELETE - cancelling is status = CANCELLED. A plan with payments against
// it must never vanish.
@Controller('ownership-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OwnershipPlanController {
  constructor(
    private readonly ownershipPlanService: OwnershipPlanService,
    private readonly generatorService: OwnershipPlanGeneratorService,
    private readonly contractService: OwnershipPlanContractService,
  ) {}

  @Post()
  @Roles(UserRole.OWNER)
  create(@Body() dto: CreateOwnershipPlanDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.create(dto, actor);
  }

  // Same code path as the cron (OwnershipPlanGeneratorService.generate), so a
  // missed night is fixable without waiting until tomorrow - and so the
  // idempotency guarantee actually holds regardless of who/what triggers it.
  @Post('generate')
  @Roles(UserRole.OWNER)
  generate(@CurrentUser() actor: AuthenticatedUser) {
    return this.generatorService.runManual(actor);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.list(actor);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.ownershipPlanService.get(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateOwnershipPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ownershipPlanService.update(id, dto, actor);
  }

  // §9. Generating creates a NEW Document row every time - regeneration never
  // overwrites a prior version.
  @Post(':id/contract')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  generateContract(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.contractService.generate(id, actor);
  }

  // OWNER, MANAGER, and the DRIVER on this specific plan - RolesGuard alone
  // can't express "this driver, not any driver", so the access check happens
  // inside OwnershipPlanContractService.getLatest().
  @Get(':id/contract')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.RIDER)
  async downloadContract(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, absolutePath } = await this.contractService.getLatest(id, actor);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.fileName}"`,
    });
    return new StreamableFile(createReadStream(absolutePath));
  }

  @Get(':id/contracts')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  listContracts(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.contractService.listAll(id, actor);
  }
}
