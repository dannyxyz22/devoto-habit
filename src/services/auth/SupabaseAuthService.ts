import { AuthService, AuthSession, User } from './AuthService';
import { supabase } from '@/lib/supabase';

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
                emailRedirectTo: window.location.origin,
            },
        });
        return { error };
    }

    async signInWithGoogle(): Promise<{ error: any }> {
        if (!supabase) {
            return { error: new Error('Supabase client not initialized') };
        }
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
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
