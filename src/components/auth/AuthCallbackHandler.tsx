import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export const AuthCallbackHandler = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const handleAuthCallback = async () => {
            // Check if URL contains access_token (OAuth redirect)
            if (window.location.hash && window.location.hash.includes('access_token')) {
                console.log('AuthCallbackHandler: Detected OAuth hash, processing...');

                try {
                    // This call automatically parses the URL hash and sets the session
                    const { data, error } = await supabase.auth.getSession();

                    if (error) {
                        console.error('AuthCallbackHandler: Error processing session:', error);
                    } else if (data.session) {
                        console.log('AuthCallbackHandler: Session established successfully');
                        // Optional: Clear hash from URL for cleaner UX
                        window.history.replaceState(null, '', window.location.pathname);
                        // Navigate to home or library
                        navigate('/');
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
