import { useFollow } from '@/hooks/useFollow';

export function FollowButton({ acct }: { acct: string }) {
  const { state, follow } = useFollow(acct);

  return (
    <button
      onClick={() => follow(acct)}
      className="px-3 py-1 rounded border"
      disabled={state === 'pending' || state === 'following'}
      aria-pressed={state === 'following'}
    >
      {state === 'following' ? 'Following' : state === 'pending' ? 'Pending…' : 'Follow'}
    </button>
  );
}
