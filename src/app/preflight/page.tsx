import { PreflightForm } from '@/components/preflight-form';

export const dynamic = 'force-dynamic';

export default function PreflightPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">PR Preflight</h1>
        <p className="mt-2 max-w-2xl text-base font-semibold text-muted">
          The review a maintainer gives before they read a line of your code — secrets, diff size,
          missing tests, placeholder commits, a stale branch, house rules — run against your branch
          before you make them do it.
        </p>
        <p className="mt-2 max-w-2xl text-base font-semibold text-muted">
          Blockers are things that get a pull request closed unread. Warnings are things a reviewer
          will comment on. Nothing here is posted anywhere; opening the pull request stays your
          decision.
        </p>
      </header>

      <PreflightForm defaultRepoPath={process.cwd()} />
    </div>
  );
}
