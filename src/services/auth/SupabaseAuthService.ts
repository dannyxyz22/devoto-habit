import { AuthService, AuthSession, User } from './AuthService';
import { supabase } from '@/lib/supabase';
import { Capacitor } from '@capacitor/core';

// Resolve the correct redirect target for OAuth depending on platform.
// On Android/iOS we want to deep-link back into the app instead of opening the browser.
const getRedirectTo = () => {
    const platform = Capacitor.getPlatform?.();
    const isNative = (Capacitor.isNativePlatform?.() === true) || platform === 'android' || platform === 'ios';
    const target = isNative ? 'ignisverbi://auth/callback' : window.location.origin;
    console.log('[SupabaseAuthService] redirectTo', { platform, isNative, target });
    return target;
};

class SupabaseAuthServiceImpl implements AuthService {
    private static instance: SupabaseAuthServiceImpl;

    private constructor() { }

    public static getInstance(): SupabaseAuthServiceImpl {
        if (!SupabaseAuthServiceImpl.instance) {
            SupabaseAuthServiceImpl.instance = new SupabaseAuthServiceImpl();
        }
        return SupabaseAuthServiceImpl.instance;
    }

    async signIn(email: string): Promise<{ error: any }> {
        if (!supabase) {
            return { error: new Error('Supabase client not initialized') };
        }
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                // Set this to your app's redirect URL
                emailRedirectTo: getRedirectTo(),
            },
        });
        return { error };
    }

    async signInWithGoogle(): Promise<{ error: any }> {
        if (!supabase) {
            return { error: new Error('Supabase client not initialized') };
        }
        console.log('[SupabaseAuthService] signInWithGoogle');
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: getRedirectTo(),
            },
        });
        return { error };
    }

    async signOut(): Promise<{ error: any }> {
        if (!supabase) {
            return { error: new Error('Supabase client not initialized') };
        }
        const { error } = await supabase.auth.signOut();
        return { error };
    }

    async getSession(): Promise<{ session: AuthSession | null; error: any }> {
        if (!supabase) {
            return { session: null, error: new Error('Supabase client not initialized') };
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) return { session: null, error };

        return {
            session: data.session ? {
                user: data.session.user as User,
                access_token: data.session.access_token
            } : null,
            error: null
        };
    }

    async getUser(): Promise<{ user: User | null; error: any }> {
        if (!supabase) {
            return { user: null, error: new Error('Supabase client not initialized') };
        }
        const { data, error } = await supabase.auth.getUser();
        if (error) return { user: null, error };

        return {
            user: data.user as User,
            error: null
        };
    }

    onAuthStateChange(callback: (event: string, session: AuthSession | null) => void) {
        if (!supabase) {
            console.warn('Supabase client not initialized, auth state changes will not be monitored');
            return { data: { subscription: { unsubscribe: () => {} } } };
        }
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
            const authSession = session ? {
                user: session.user as User,
                access_token: session.access_token
            } : null;
            callback(event, authSession);
        });

        return { data };
    }
}

export const authService = SupabaseAuthServiceImpl.getInstance();
export type { User };
