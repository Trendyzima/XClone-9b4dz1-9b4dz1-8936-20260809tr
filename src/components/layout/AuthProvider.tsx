// Identity verification is an account-creation flow, not a login gate.
              // Existing authenticated sessions must be allowed into Testagram.
              // Mobile contact is a required post-sign-in profile field, not an auth
              // identifier. Keep it private in profile_contact_methods and gate the
              // application until the signed-in user has supplied a valid number.
              if (path !== '/profile/complete' && path !== '/verify-identity') {
                const { data: hasMobilePhone, error: mobilePhoneError } = await supabase.rpc('has_my_mobile_phone');
                if (mobilePhoneError) throw mobilePhoneError;
                if (!hasMobilePhone) {
                  window.location.replace('/profile/complete');
                  resolve();
                  return;
                }
              }

              setLoading(false);
              void triggerKeygenForUser(user.id);
              resolve();
            })
            .catch(async (error) => {
              if (!mounted) {
                resolve();
                return;
              }
              const message = error instanceof Error ? error.message : 'Profile provisioning failed';
              setAuthError(message);
              logout();
              setLoading(false);
              try { await supabase.auth.signOut(); } catch { /* best effort */ }
              console.error('[Auth] Session finalization failed:', error);
              resolve();
            });
        }, 0);
      }).finally(() => {
        finalizationInFlight.delete(user.id);
      });

      finalizationInFlight.set(user.id, task);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        clearTestagramSessionLifetime();
        trackTestagramEvent(TestagramEvent.LOGGED_OUT, { auth_event: event });
        clearTestagramSessionLifetime();
        logout();
        setLoading(false);
        return;
      }

      if (!session?.user) {
        if (event === 'INITIAL_SESSION') setLoading(false);
        return;
      }

      // Identity-first onboarding must never admit anonymous Auth sessions into
      // the application. Even if a hosted Auth setting is misconfigured, an
      // anonymous session is not a Testagram account and cannot bypass KYC.
      if (session.user.is_anonymous) {
        void supabase.auth.signOut();
        logout();
        setLoading(false);
        return;
      }

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (event === 'SIGNED_IN') {
          trackTestagramEvent(TestagramEvent.LOGGED_IN, { auth_event: event });
        }
        if (event === 'USER_UPDATED') {
          trackTestagramEvent(TestagramEvent.PROFILE_UPDATED, { source: 'auth_user_updated' });
        }
        hydrateUser(session.user, event === 'SIGNED_IN');
      }
    });

    return () => {
      mounted = false;
      window.clearInterval(lifetimeTimer);
      subscription.unsubscribe();
    };
  }, [login, logout, setLoading, setAuthError, clearAuthError]);

  return <>{children}</>;
}
