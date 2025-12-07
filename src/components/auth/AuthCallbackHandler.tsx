import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export const AuthCallbackHandler = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const handleAuthCallback = async () => {
            // Check if URL contains access_token (OAuth redirect)
            if (window.location.hash && window.location.hash.includes('access_token')) {
                console.log('AuthCallbackHandler: Detected OAuth hash, processing...', window.location.hash);

                if (!supabase) {
                    console.error('AuthCallbackHandler: Supabase client not initialized');
                    return;
                }

                try {
                    // Parse the hash parameters and explicitly set the session with tokens from URL
                    const hashParams = new URLSearchParams(window.location.hash.substring(1));
                    const access_token = hashParams.get('access_token');
                    const refresh_token = hashParams.get('refresh_token');

                    if (access_token && refresh_token) {
                        console.log('AuthCallbackHandler: Setting session from tokens...');
                        const { data, error } = await supabase.auth.setSession({
                            access_token,
                            refresh_token,
                        });

                        if (error) {
                            console.error('AuthCallbackHandler: Error setting session:', error);
                        } else if (data.session) {
                            console.log('AuthCallbackHandler: Session established successfully', data.session.user.email);
                            // Clear hash from URL for cleaner UX
                            window.history.replaceState(null, '', window.location.pathname);
                            // Navigate to home or library
                            navigate('/');
                        }
                    } else {
                        console.error('AuthCallbackHandler: Missing tokens in hash');
                    }
                } catch (err) {
                    console.error('AuthCallbackHandler: Unexpected error:', err);
                }
            }
        };

        handleAuthCallback();
    }, [navigate]);

    return null; // This component renders nothing
};
