import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
