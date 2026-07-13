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

  // True nesting via `als.run`, as opposed to `enterWith`. Use this to wrap the
  // *entire* remainder of a request's handling (see RequestContextInterceptor) -
  // `enterWith`'s "persists for the rest of the current execution" guarantee is
  // weaker than it sounds once Nest's own internal RxJS-based pipeline is in the
  // mix between a guard and the controller/service/Prisma call it's meant to
  // protect; `run` sidesteps that by making the nesting explicit and synchronous.
  run<T>(store: RequestContextStore, fn: () => T): T {
    return als.run(store, fn);
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
