import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PasswordResetChannel } from '@prisma/client';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { SignupVerificationService } from './signup-verification.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AllowWhenLocked } from './decorators/allow-when-locked.decorator';
import { AuthenticatedUser, AuthenticatedUserWithTenantLock } from './auth.types';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { ConfirmSignupVerificationDto } from './dto/confirm-signup-verification.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordResetService: PasswordResetService,
    private readonly signupVerificationService: SignupVerificationService,
  ) {}

  // Stage H0 - rate limiting lives in throttler-options.factory.ts
  // ('signup-identifier'), keyed the same way as login: IP + identifier.
  //
  // Stage S1 - AuthService.signup creates the tenant PENDING_VERIFICATION
  // (schema default) and still returns a token pair, same as always: the
  // tenant is locked everywhere except @AllowWhenLocked routes regardless,
  // so the owner can hold this token and use it to check /auth/me, verify,
  // or resend a code, without a second login after signing up.
  @Post('signup')
  async signup(@Body() dto: SignupDto): Promise<TokenResponseDto> {
    const tokens = await this.authService.signup(dto);
    await this.signupVerificationService.sendCode(dto.email);
    return tokens;
  }

  /**
   * Stage S1 Part 2. Authenticated by the token signup just issued - see
   * SignupVerificationService.confirmCode for why that removes the need for
   * password-reset's "identical response whether the account exists"
   * handling: the caller has already proven which tenant it's asking about.
   */
  @Post('signup/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @AllowWhenLocked()
  async verifySignup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmSignupVerificationDto,
  ): Promise<void> {
    await this.signupVerificationService.confirmCode(user.tenantId, dto.code);
  }

  /** Stage S1 Part 2 - a code expires in 30 minutes; this is the way out of
   *  "I didn't get it in time" that doesn't involve waiting out the
   *  abandoned-signup cleanup window and signing up again. */
  @Post('signup/resend-code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @AllowWhenLocked()
  async resendSignupCode(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.signupVerificationService.resendCode(user.tenantId);
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

  // Stage S1 - allow-listed regardless of tenant lock: a locked owner (or
  // rider) has to be able to see WHY, and the dashboard has to be able to
  // ask. See jwt-auth.guard.ts.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowWhenLocked()
  me(@CurrentUser() user: AuthenticatedUserWithTenantLock): UserResponseDto {
    return UserResponseDto.fromProfile(user);
  }

  // Stage S1 - allow-listed: leaving must always work, locked or not.
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @AllowWhenLocked()
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
