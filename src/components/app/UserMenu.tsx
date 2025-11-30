import React, { useEffect, useState } from 'react';
import { authService, User } from '@/services/auth/SupabaseAuthService';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { LogOut, User as UserIcon, Cloud, Sun, Moon, Monitor, Check } from 'lucide-react';
import { useTheme } from 'next-themes';

export function UserMenu() {
    const [user, setUser] = useState<User | null>(null);
    const navigate = useNavigate();
    const { theme, setTheme } = useTheme();

    useEffect(() => {
        // Initial check
        authService.getUser().then(({ user }) => setUser(user));

        // Subscribe to changes
        const { data: { subscription } } = authService.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleSignOut = async () => {
        await authService.signOut();
        navigate('/');
    };

    // Theme submenu JSX (shared between logged in and not logged in states)
    const themeSubmenu = (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                {theme === 'dark' ? (
                    <Moon className="mr-2 h-4 w-4" />
                ) : theme === 'light' ? (
                    <Sun className="mr-2 h-4 w-4" />
                ) : (
                    <Monitor className="mr-2 h-4 w-4" />
                )}
                <span>Tema</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => setTheme('system')}>
                    <Monitor className="mr-2 h-4 w-4" />
                    <span>Sistema</span>
                    {theme === 'system' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('light')}>
                    <Sun className="mr-2 h-4 w-4" />
                    <span>Claro</span>
                    {theme === 'light' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                    <Moon className="mr-2 h-4 w-4" />
                    <span>Escuro</span>
                    {theme === 'dark' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );

    if (!user) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                        <UserIcon className="h-5 w-5 mr-2" />
                        Entrar
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuItem onClick={() => navigate('/login')}>
                        <UserIcon className="mr-2 h-4 w-4" />
                        <span>Fazer login</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {themeSubmenu}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    const initials = user.email
        ? user.email.substring(0, 2).toUpperCase()
        : 'U';

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={user.user_metadata?.avatar_url} alt={user.email} />
                        <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">Minha Conta</p>
                        <p className="text-xs leading-none text-muted-foreground">
                            {user.email}
                        </p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-green-600">
                    <Cloud className="mr-2 h-4 w-4" />
                    <span>Sincronização Ativa</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {themeSubmenu}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sair</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
