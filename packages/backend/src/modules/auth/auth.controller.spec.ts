import { Test } from '@nestjs/testing';
import { DriverType, TenantStatus, Theme, UserRole } from '@prisma/client';
import { AuthController } from './auth.controller';
import { PasswordResetService } from './password-reset.service';
import { SignupVerificationService } from './signup-verification.service';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let service: {
    signup: jest.Mock;
    login: jest.Mock;
    refreshToken: jest.Mock;
    logout: jest.Mock;
    getDriverType: jest.Mock;
    getTheme: jest.Mock;
    updateTheme: jest.Mock;
  };
  let signupVerificationService: {
    sendCode: jest.Mock;
    confirmCode: jest.Mock;
    resendCode: jest.Mock;
  };

  const tokenPair = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };

  beforeEach(async () => {
    service = {
      signup: jest.fn().mockResolvedValue(tokenPair),
      login: jest.fn().mockResolvedValue(tokenPair),
      refreshToken: jest.fn().mockResolvedValue(tokenPair),
      logout: jest.fn().mockResolvedValue(undefined),
      getDriverType: jest.fn().mockResolvedValue(null),
      getTheme: jest.fn().mockResolvedValue(null),
      updateTheme: jest.fn().mockResolvedValue('LIGHT'),
    };
    signupVerificationService = {
      sendCode: jest.fn().mockResolvedValue(undefined),
      confirmCode: jest.fn().mockResolvedValue(undefined),
      resendCode: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        // Stage H0f - the controller now also fronts the password-reset
        // flow; this spec covers the delegation of the original routes, so
        // a stub is enough here. The reset routes are covered end to end in
        // test/password-reset.e2e-spec.ts, where the Redis and mail
        // behaviour they depend on is real.
        {
          provide: PasswordResetService,
          useValue: { requestReset: jest.fn(), confirmReset: jest.fn() },
        },
        // Stage S1 - same reasoning: covered end to end in
        // test/signup-verification.e2e-spec.ts.
        { provide: SignupVerificationService, useValue: signupVerificationService },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  it('signup delegates to AuthService.signup, sends a verification code, and returns tokens', async () => {
    const dto = {
      email: 'a@b.com',
      password: 'password123',
      companyName: 'Acme',
      firstName: 'A',
      lastName: 'B',
      phone: '+254700000000',
    };
    await expect(controller.signup(dto)).resolves.toBe(tokenPair);
    expect(service.signup).toHaveBeenCalledWith(dto);
    expect(signupVerificationService.sendCode).toHaveBeenCalledWith(dto.email);
  });

  it('login delegates to AuthService.login', async () => {
    const dto = { email: 'a@b.com', password: 'password123' };
    await expect(controller.login(dto)).resolves.toBe(tokenPair);
    expect(service.login).toHaveBeenCalledWith(dto);
  });

  it('refresh delegates to AuthService.refreshToken with the raw token', async () => {
    await expect(controller.refresh({ refreshToken: 'r' })).resolves.toBe(tokenPair);
    expect(service.refreshToken).toHaveBeenCalledWith('r');
  });

  it('me maps the authenticated user to a UserResponseDto, driverType null for a non-driver role', async () => {
    const user = {
      userId: 'u1',
      tenantId: 't1',
      role: UserRole.OWNER,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      jti: 'jti-1',
      tenantStatus: TenantStatus.ACTIVE,
      trialEndsAt: null,
      billingExemptAt: null,
    };

    const result = await controller.me(user);

    expect(service.getDriverType).toHaveBeenCalledWith(user);
    expect(service.getTheme).toHaveBeenCalledWith(user);
    expect(result).toEqual({
      id: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      role: UserRole.OWNER,
      firstName: 'A',
      lastName: 'B',
      tenantStatus: TenantStatus.ACTIVE,
      trialEndsAt: null,
      driverType: null,
      theme: null,
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('me carries a RIDER driver type through to the response', async () => {
    const user = {
      userId: 'u2',
      tenantId: 't1',
      role: UserRole.RIDER,
      email: 'rider@b.com',
      firstName: 'R',
      lastName: 'Ider',
      jti: 'jti-2',
      tenantStatus: TenantStatus.ACTIVE,
      trialEndsAt: null,
      billingExemptAt: null,
    };
    service.getDriverType.mockResolvedValueOnce(DriverType.TRUCK_DRIVER);

    const result = await controller.me(user);

    expect(result.driverType).toBe(DriverType.TRUCK_DRIVER);
  });

  it('updateMe delegates to AuthService.updateTheme and returns the saved theme', async () => {
    const user = {
      userId: 'u1',
      tenantId: 't1',
      role: UserRole.OWNER,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      jti: 'jti-1',
      tenantStatus: TenantStatus.ACTIVE,
      trialEndsAt: null,
      billingExemptAt: null,
    };
    service.updateTheme.mockResolvedValueOnce(Theme.LIGHT);

    const result = await controller.updateMe(user, { theme: Theme.LIGHT });

    expect(service.updateTheme).toHaveBeenCalledWith(user, Theme.LIGHT);
    expect(result).toEqual({ theme: Theme.LIGHT });
  });

  it('logout delegates to AuthService.logout with userId and jti', async () => {
    const user = {
      userId: 'u1',
      tenantId: 't1',
      role: UserRole.OWNER,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      jti: 'jti-1',
      tenantStatus: TenantStatus.ACTIVE,
      trialEndsAt: null,
      billingExemptAt: null,
    };

    await controller.logout(user);

    expect(service.logout).toHaveBeenCalledWith('u1', 'jti-1');
  });
});
