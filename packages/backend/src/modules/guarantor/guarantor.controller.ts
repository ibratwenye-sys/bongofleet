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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GuarantorService } from './guarantor.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { UpdateGuarantorDto } from './dto/update-guarantor.dto';

@ApiTags('guarantor')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class GuarantorController {
  constructor(private readonly guarantorService: GuarantorService) {}

  // 'riders/:driverId/guarantors' kept as an alias for one release so an
  // un-updated dashboard or phone build still calling the old path does not
  // break. Drop once nothing still calls it.
  @Post(['drivers/:driverId/guarantors', 'riders/:driverId/guarantors'])
  create(
    @Param('driverId') driverId: string,
    @Body() dto: CreateGuarantorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.guarantorService.create(driverId, dto, actor);
  }

  @Get(['drivers/:driverId/guarantors', 'riders/:driverId/guarantors'])
  list(@Param('driverId') driverId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.guarantorService.list(driverId, actor);
  }

  @Patch('guarantors/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateGuarantorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.guarantorService.update(id, dto, actor);
  }

  @Delete('guarantors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.guarantorService.deactivate(id, actor);
  }
}
