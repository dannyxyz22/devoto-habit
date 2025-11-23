export interface User {
    id: string;
    email?: string;
    user_metadata?: {
        [key: string]: any;
    };
}

export interface AuthSession {
    user: User | null;
    access_token: string | null;
}

export interface AuthService {
    /**
     * Sign in with email and password
     */
    signIn(email: string): Promise<{ error: any }>;

    /**
     * Sign in with Google OAuth
     */
    signInWithGoogle(): Promise<{ error: any }>;

    /**
     * Sign out the current user
     */
    signOut(): Promise<{ error: any }>;

    /**
     * Get the current session
     */
    getSession(): Promise<{ session: AuthSession | null; error: any }>;

    /**
     * Get the current user
     */
    getUser(): Promise<{ user: User | null; error: any }>;

    /**
     * Subscribe to auth state changes
     */
    onAuthStateChange(callback: (event: string, session: AuthSession | null) => void): {
        data: { subscription: { unsubscribe: () => void } };
    };
}
