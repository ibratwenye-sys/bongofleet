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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { GuarantorService } from './guarantor.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { UpdateGuarantorDto } from './dto/update-guarantor.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class GuarantorController {
  constructor(private readonly guarantorService: GuarantorService) {}

  @Post('riders/:riderId/guarantors')
  create(
    @Param('riderId') riderId: string,
    @Body() dto: CreateGuarantorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.guarantorService.create(riderId, dto, actor);
  }

  @Get('riders/:riderId/guarantors')
  list(@Param('riderId') riderId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.guarantorService.list(riderId, actor);
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
