import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface TenantSummary {
  id: string;
  name: string;
  contactEmail: string | null;
}

/**
 * Who gets a tenant's alert emails: every active OWNER user, plus the tenant
 * contact email if set. Deduplicated, lowercased. Must be called inside the
 * tenant's request context so the user query stays tenant-scoped.
 */
export async function resolveOwnerRecipients(
  prisma: PrismaService,
  tenant: TenantSummary,
): Promise<string[]> {
  const owners = await prisma.client.user.findMany({
    where: { role: UserRole.OWNER, isActive: true },
    select: { email: true },
  });

  const emails = new Set<string>();
  for (const owner of owners) {
    emails.add(owner.email.trim().toLowerCase());
  }
  if (tenant.contactEmail) {
    emails.add(tenant.contactEmail.trim().toLowerCase());
  }
  emails.delete('');
  return [...emails];
}
