import { useTranslation } from 'react-i18next';

/**
 * Stage H0f Part 2 - tells an owner, in words he can act on, whether a rider can get
 * himself back into the app.
 *
 * The problem this answers: email is a required field at driver creation, so
 * every rider has an address and nothing distinguishes his real one from one
 * typed to clear the box. The gap is invisible until the worst moment - a
 * rider locked out mid-shift, on the road, with unsent payments queued - and
 * at that point the owner discovers he is the only route.
 *
 * So this is deliberately not a technical badge. "Verified"/"Unverified"
 * would tell an owner something about an address; these say what he will have
 * to do. The only evidence behind it is a completed self-service reset - see
 * User.emailProvenAt - which is why the unproven wording says the address has
 * never been used rather than claiming it is wrong. It may well be fine. It
 * has simply never been shown to work, and that is the honest thing to say.
 */

/** Not exported: nothing outside this file needs the predicate, and keeping
 *  it local means the module exports components only, which is what Fast
 *  Refresh wants. Export it if a caller ever genuinely needs the boolean
 *  rather than the wording. */
function canSelfRecover(emailProvenAt: string | null): boolean {
  return emailProvenAt !== null;
}

/** One short phrase for the Drivers list, where there is no room to explain.
 *  Stage L10 (DESIGN_SWAHILI_UI.md, batch a) - lives in the `drivers`
 *  namespace since it's only ever rendered by DriversPage's Manage Drivers
 *  table; PasswordRecoveryNote below stays untranslated in this batch, it
 *  belongs to DriverDetailPage which is out of scope until batch b. */
export function PasswordRecoveryLabel({ emailProvenAt }: { emailProvenAt: string | null }) {
  const { t } = useTranslation('drivers');
  return canSelfRecover(emailProvenAt) ? (
    <span className="text-gray-600">{t('canResetOwn')}</span>
  ) : (
    <span className="font-medium text-amber-700">{t('onlyYouCanReset')}</span>
  );
}

/** The fuller version for the driver's own page, where the explanation fits.
 *  Stage L10 (DESIGN_SWAHILI_UI.md, batch b) - lives in the `drivers`
 *  namespace, same as PasswordRecoveryLabel above; only DriverDetailPage
 *  renders this component. */
export function PasswordRecoveryNote({ emailProvenAt }: { emailProvenAt: string | null }) {
  const { t } = useTranslation('drivers');
  if (canSelfRecover(emailProvenAt)) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-900">{t('canResetOwnTitle')}</p>
        <p className="mt-1 text-sm text-gray-600">
          {t('canResetOwnBody', { date: emailProvenAt?.slice(0, 10) })}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">{t('onlyYouCanResetTitle')}</p>
      <p className="mt-1 text-sm text-amber-800">{t('onlyYouCanResetBody1')}</p>
      <p className="mt-2 text-sm text-amber-800">{t('onlyYouCanResetBody2')}</p>
    </div>
  );
}
