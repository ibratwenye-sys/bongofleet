import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PasswordResetChannel } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './auth.types';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  // Stage H0 - rate limiting lives in throttler-options.factory.ts
  // ('signup-identifier'), keyed the same way as login: IP + identifier.
  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<TokenResponseDto> {
    return this.authService.signup(dto);
  }

  // Stage H0 - rate limiting for this route lives in
  // common/throttle/throttler-options.factory.ts ('login-identifier' and
  // 'login-ip'), keyed by handler reference, not a decorator here.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    return this.authService.login(dto);
  }

  // Stage H0 - rate limiting lives in throttler-options.factory.ts
  // ('refresh'), keyed on the refresh token's own user, not this route.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<TokenResponseDto> {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): UserResponseDto {
    return UserResponseDto.fromProfile(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user.userId, user.jti);
  }

  /**
   * Stage H0f - unauthenticated by necessity: the caller is someone who
   * cannot log in. Rate limiting lives in throttler-options.factory.ts
   * ('password-reset-identifier', IP-blind so a rider cannot be mail-bombed
   * from many hosts, and 'password-reset-ip' as the enumeration backstop).
   *
   * 202, and the same 202, for every input. Whether the address belongs to
   * anyone is not the caller's business, and an endpoint that answers
   * differently is an account enumerator. Nothing about the result is
   * returned, including whether mail was actually sent.
   */
  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto): Promise<{ message: string }> {
    await this.passwordResetService.requestReset(dto.email, PasswordResetChannel.EMAIL);
    return {
      message: 'If that address belongs to an account, a reset code is on its way to it.',
    };
  }

  /**
   * Stage H0f - the code is checked here, not a link. Rate limiting is
   * 'password-reset-confirm-ip'; the real guard is the per-code attempt
   * budget in Redis, which destroys a code after a few wrong tries.
   */
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto): Promise<void> {
    await this.passwordResetService.confirmReset(dto.email, dto.code, dto.newPassword);
  }
}
