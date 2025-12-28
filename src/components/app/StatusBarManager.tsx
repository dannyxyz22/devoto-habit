import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * StatusBarManager handles the appearance of the native status bar on Android/iOS.
 * It syncs the status bar style (Light/Dark) and background color with the app's current theme.
 */
export const StatusBarManager = () => {
    const { resolvedTheme } = useTheme();

    const isNative = Capacitor.isNativePlatform();

    useEffect(() => {
        if (!isNative) return;

        const updateStatusBar = async () => {
            try {
                if (resolvedTheme === 'dark') {
                    // Dark Theme: Status bar should have Light text (Style.Dark)
                    await StatusBar.setStyle({ style: Style.Dark });
                    // Background color for dark theme (matching --background: 220 15% 10%)
                    await StatusBar.setBackgroundColor({ color: '#16191D' });
                } else {
                    // Light Theme: Status bar should have Dark text (Style.Light)
                    await StatusBar.setStyle({ style: Style.Light });
                    // Background color for light theme (matching --background: 40 20% 97%)
                    await StatusBar.setBackgroundColor({ color: '#F9F8F6' });
                }
            } catch (err) {
                console.error('Failed to update status bar:', err);
            }
        };

        updateStatusBar();
    }, [resolvedTheme, isNative]);

    return null; // This component doesn't render anything
};

export default StatusBarManager;
