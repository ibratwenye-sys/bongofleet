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

/** One short phrase for the Drivers list, where there is no room to explain. */
export function PasswordRecoveryLabel({ emailProvenAt }: { emailProvenAt: string | null }) {
  return canSelfRecover(emailProvenAt) ? (
    <span className="text-gray-600">Can reset his own</span>
  ) : (
    <span className="font-medium text-amber-700">Only you can reset</span>
  );
}

/** The fuller version for the driver's own page, where the explanation fits. */
export function PasswordRecoveryNote({ emailProvenAt }: { emailProvenAt: string | null }) {
  if (canSelfRecover(emailProvenAt)) {
    return (
      <div className="rounded border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-900">He can reset his own password</p>
        <p className="mt-1 text-sm text-gray-600">
          He has received a reset code at this email address and used it (
          {emailProvenAt?.slice(0, 10)}), so the address reaches him. If he is locked out he can
          recover on his own.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Only you can reset his password</p>
      <p className="mt-1 text-sm text-amber-800">
        This email address has never been used to receive a reset code, so there is no evidence it
        reaches him. If he is locked out, he cannot recover on his own - you will have to set a new
        password for him and tell him what it is.
      </p>
      <p className="mt-2 text-sm text-amber-800">
        If the address is wrong, correcting it does not change this on its own: it counts once he
        has used a code sent to it.
      </p>
    </div>
  );
}
