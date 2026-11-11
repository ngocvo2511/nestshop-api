import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles, RolesGuard } from './roles.guard';

@Roles('ADMIN')
class Probe {
  @Roles('STAFF', 'ADMIN')
  staff(this: void) {}
  admin(this: void) {}
}

describe('role metadata and authenticated authority', () => {
  it.each([
    ['CUSTOMER', 'admin', false],
    ['STAFF', 'admin', false],
    ['ADMIN', 'admin', true],
    ['CUSTOMER', 'staff', false],
    ['STAFF', 'staff', true],
    ['ADMIN', 'staff', true],
  ] as const)('%s can access %s: %s', (role, method, allowed) => {
    const context = {
      getHandler: () => Probe.prototype[method],
      getClass: () => Probe,
      switchToHttp: () => ({ getRequest: () => ({ identity: { role } }) }),
    } as unknown as ExecutionContext;
    const check = () => new RolesGuard(new Reflector()).canActivate(context);
    if (allowed) expect(check()).toBe(true);
    else expect(check).toThrow('Access denied');
  });
  it('requires authenticated identity even if no role metadata', () => {
    const context = {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => new RolesGuard(new Reflector()).canActivate(context)).toThrow(
      'Authentication required or invalid credentials',
    );
  });
});
