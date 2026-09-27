import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Plus, X, Edit, Users, Radio } from 'lucide-react';

export function FloatingActionButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  if (!user) return null;

  // Live-stream pages have a persistent chat composer at the bottom.
  // Keep the global FAB out of that interaction zone so it cannot cover
  // the message field/send control on mobile.
  const isLiveStreamPage = location.pathname.startsWith('/stream/');
  const hiddenRoutes = ['/auth', '/messages', '/ai'];
  if (isLiveStreamPage || hiddenRoutes.some(r => location.pathname.startsWith(r))) return null;

  const actions = [
    {
      icon: Edit,
      label: 'Create Post',
      onClick: () => {
        navigate('/');
        setTimeout(() => {
          const composeButton = document.querySelector('[data-compose-trigger]');
          if (composeButton) {
            (composeButton as HTMLElement).click();
          }
        }, 100);
        setIsOpen(false);
      },
      color: 'bg-primary hover:bg-primary/90',
    },
    {
      icon: Users,
      label: 'Create Community',
      onClick: () => {
        navigate('/communities');
        setIsOpen(false);
      },
      color: 'bg-blue-500 hover:bg-blue-600',
    },
    {
      icon: Radio,
      label: 'Start Space',
      onClick: () => {
        navigate('/spaces');
        setIsOpen(false);
      },
      color: 'bg-purple-500 hover:bg-purple-600',
    },
  ];

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Action Menu */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 space-y-3 lg:hidden">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <div
                key={index}
                className="flex items-center space-x-3 animate-slide-in"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <span className="bg-background px-3 py-2 rounded-full shadow-lg text-sm font-semibold whitespace-nowrap">
                  {action.label}
                </span>
                <button
                  onClick={action.onClick}
                  className={`${action.color} text-white p-4 rounded-full shadow-lg transition-transform hover:scale-110`}
                >
                  <Icon className="w-6 h-6" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Main FAB */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-20 right-6 z-50 lg:hidden p-4 rounded-full shadow-lg transition-all ${
          isOpen
            ? 'bg-destructive hover:bg-destructive/90 rotate-45'
            : 'bg-primary hover:bg-primary/90'
        }`}
      >
        {isOpen ? (
          <X className="w-6 h-6 text-primary-foreground" />
        ) : (
          <Plus className="w-6 h-6 text-primary-foreground" />
        )}
      </button>
    </>
  );
}
