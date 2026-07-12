import { Prisma } from '@prisma/client';
import { requestContext } from '../../common/context/request-context';

const EXCLUDED_MODELS = new Set(['Tenant']);

const SCOPED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

export const tenantScopingExtension = Prisma.defineExtension({
  name: 'tenant-scoping',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || EXCLUDED_MODELS.has(model) || !SCOPED_OPERATIONS.has(operation)) {
          return query(args);
        }

        const store = requestContext.getStore();

        if (!store) {
          throw new Error(`Tenant context missing for ${model}.${operation}`);
        }

        if (store.bypass) {
          return query(args);
        }

        return query({
          ...args,
          where: { ...(args as { where?: object }).where, tenantId: store.tenantId },
        });
      },
    },
  },
});
