import { AsyncLocalStorage } from 'node:async_hooks';
import { UserRole } from '@prisma/client';

export interface RequestContextStore {
  tenantId: string;
  userId: string;
  role: UserRole;
  bypass?: boolean;
}

const als = new AsyncLocalStorage<RequestContextStore>();

export const requestContext = {
  enterWith(store: RequestContextStore): void {
    als.enterWith(store);
  },

  getStore(): RequestContextStore | undefined {
    return als.getStore();
  },

  // `fn` must be awaited *inside* the `als.run` callback, not by the caller after
  // this returns. Prisma's queries are lazy thenables that don't dispatch (and
  // therefore don't invoke the tenant-scoping extension) until `.then()`/`await`
  // is called on them - awaiting outside `als.run`'s synchronous window means the
  // ALS context has already unwound by the time the query actually runs.
  async runUnscoped<T>(fn: () => T | Promise<T>): Promise<T> {
    return als.run({ tenantId: '', userId: '', role: '' as UserRole, bypass: true }, async () =>
      fn(),
    );
  },
};
