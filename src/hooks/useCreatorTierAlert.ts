import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities } from '@/services/backendClient';
import { toast } from 'sonner';

interface Milestone {
  key: string;
  threshold: number;
  tier: string;
  emoji: string;
  color: string;
  title: string;
  body: string;
}

const MILESTONES: Milestone[] = [
  {
    key: 'bronze_500',
    threshold: 500,
    tier: 'bronze',
    emoji: '🥉',
    color: '#cd7f32',
    title: '🥉 Bronze Creator Unlocked!',
    body: 'You just hit 500 followers! Content creation is now fully unlocked. You qualify for monetization, ad revenue, and the Creator Leaderboard.',
  },
  {
    key: 'silver_5000',
    threshold: 5000,
    tier: 'silver',
    emoji: '🥈',
    color: '#c0c0c0',
    title: '🥈 Silver Creator Status!',
    body: 'Amazing — 5,000 followers! You\'re now a Silver Creator with priority feed placement, enhanced analytics, and higher revenue share rates.',
  },
  {
    key: 'gold_50000',
    threshold: 50000,
    tier: 'gold',
    emoji: '🥇',
    color: '#ffd700',
    title: '🥇 Gold Creator — Elite Status!',
    body: 'Incredible! 50,000 followers makes you a Gold Creator — the top tier. You unlock dedicated creator support, featured placement, and maximum revenue splits.',
  },
];

// Simple CSS confetti effect injected into DOM
function launchConfetti(color: string) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(container);

  for (let i = 0; i < 80; i++) {
    const particle = document.createElement('div');
    const size = 8 + Math.random() * 12;
    const colors = [color, '#fff', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];
    const c = colors[Math.floor(Math.random() * colors.length)];
    particle.style.cssText = `
      position:absolute;
      width:${size}px;height:${size}px;
      background:${c};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      left:${Math.random() * 100}%;
      top:-20px;
      opacity:1;
      transform:rotate(${Math.random() * 360}deg);
      animation:confetti-fall ${1.5 + Math.random() * 1.5}s ${Math.random() * 0.5}s ease-in forwards;
    `;
    container.appendChild(particle);
  }

  // Inject keyframes once
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `
      @keyframes confetti-fall {
        0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
        80%  { opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => container.remove(), 3500);
}

export function useCreatorTierAlert() {
  const { user } = useAuth();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!user || checkedRef.current) return;
    checkedRef.current = true;

    const check = async () => {
      try {
        // The Backend owns follower thresholds, deduplication and inbox writes.
        const result = await backendCapabilities.call<{ unlocked: Array<{ key: string }> }>(
          'testagram.creator.milestones.check',
          {},
        );
        const unlocked = new Set((result.unlocked ?? []).map((item) => item.key));
        for (const milestone of MILESTONES) {
          if (!unlocked.has(milestone.key)) continue;
          launchConfetti(milestone.color);
          toast.success(milestone.title, {
            description: `You've reached ${milestone.threshold.toLocaleString()} followers!`,
            duration: 8000,
          });
        }
      } catch (error) {
        console.debug('[creator milestones] Backend API unavailable', error);
      }
    };

    // Delay check slightly so auth session is fully hydrated
    setTimeout(check, 2000);
  }, [user?.id]);
}
