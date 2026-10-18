import { reportError } from './errorReport';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import type { UserClaims, UserDoc } from '@plainspeak/shared';
import { auth, db } from './firebase';
import { api } from './api';
import { claimsFrom, resolveAuthStatus, type AuthStatus } from './authStatus';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  claims: UserClaims | null;
  userDoc: UserDoc | null;
  error: string | null;
  signOut: () => Promise<void>;
  clearNotInvited: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<UserClaims | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null | undefined>(undefined);
  const [notInvited, setNotInvited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claimingFor = useRef<string | null>(null);

  // Track the signed-in user and their role/program claims.
  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u);
        setClaims(u ? claimsFrom((await u.getIdTokenResult()).claims) : null);
        setAuthReady(true);
      }),
    [],
  );

  // Signed in without claims: ask the server to apply the invite.
  useEffect(() => {
    if (!user || claims || claimingFor.current === user.uid) return;
    claimingFor.current = user.uid;
    api
      .claimInvite()
      .then(async ({ data }) => {
        if (data.status === 'not_invited') {
          setNotInvited(true);
          await fbSignOut(auth);
        } else {
          await user.getIdToken(true); // pick up new claims
        }
      })
      .catch((e: unknown) => {
        // Details go to our error log, never on screen.
        reportError('claimInvite', e);
        setError('We couldn’t finish setting up your account. Please try again.');
      })
      .finally(() => {
        claimingFor.current = null;
      });
  }, [user, claims]);

  // Live user doc (consent status, display name).
  useEffect(() => {
    if (!user || !claims) {
      setUserDoc(undefined);
      return;
    }
    return onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => setUserDoc(snap.exists() ? (snap.data() as UserDoc) : null),
      () => setUserDoc(null),
    );
  }, [user, claims]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: resolveAuthStatus({ authReady, signedIn: !!user, notInvited, claims, userDoc }),
      user,
      claims,
      userDoc: userDoc ?? null,
      error,
      signOut: () => fbSignOut(auth),
      clearNotInvited: () => setNotInvited(false),
    }),
    [authReady, user, notInvited, claims, userDoc, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
