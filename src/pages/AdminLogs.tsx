import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BackLink } from '../components/app/BackLink';

interface ErrorLog {
    id: string;
    user_id: string;
    error_message: string;
    stack_trace: string;
    metadata: any;
    severity: string;
    created_at: string;
}

const AdminLogs: React.FC = () => {
    const [logs, setLogs] = useState<ErrorLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userId, setUserId] = useState<string>('');
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    useEffect(() => {
        fetchUserAndLogs();
    }, []);

    const fetchUserAndLogs = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) setUserId(user.id);

            const { data, error } = await supabase
                .from('error_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;
            setLogs(data || []);
        } catch (err: any) {
            console.error('AdminLogs load error:', err);
            // Expected error if RLS blocks access
            setError(err.message || 'Falha ao carregar logs. Verifique se seu UUID tem permissão.');
        } finally {
            setLoading(false);
        }
    };

    const toggleExpand = (id: string) => {
        setExpandedLogId(expandedLogId === id ? null : id);
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <div className="max-w-4xl mx-auto p-4">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">Logs de Erros (Admin)</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Seu UUID: <code className="bg-gray-200 px-1 py-0.5 rounded select-all">{userId}</code>
                    </p>
                </header>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                        <strong className="font-bold">Acesso Negado/Erro:</strong>
                        <span className="block sm:inline"> {error}</span>
                    </div>
                )}

                <div className="bg-white shadow rounded-lg overflow-hidden">
                    {loading ? (
                        <div className="p-4 text-center text-gray-500">Carregando logs...</div>
                    ) : logs.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">Nenhum log encontrado (ou sem permissão para ver).</div>
                    ) : (
                        <div className="divide-y divide-gray-200">
                            {logs.map((log) => (
                                <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
                                    <div
                                        className="flex justify-between items-start cursor-pointer"
                                        onClick={() => toggleExpand(log.id)}
                                    >
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${log.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                                                    }`}>
                                                    {log.severity.toUpperCase()}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {new Date(log.created_at).toLocaleString()}
                                                </span>
                                            </div>
                                            <h3 className="text-sm font-medium text-gray-900 line-clamp-2">
                                                {log.error_message}
                                            </h3>
                                            {log.metadata?.url && (
                                                <p className="text-xs text-gray-400 mt-1 truncate max-w-md">
                                                    {new URL(log.metadata.url).pathname}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-gray-400">
                                            {expandedLogId === log.id ? '−' : '+'}
                                        </div>
                                    </div>

                                    {expandedLogId === log.id && (
                                        <div className="mt-4 pl-4 border-l-2 border-gray-200 text-xs text-gray-600 space-y-2">
                                            {log.stack_trace && (
                                                <div>
                                                    <p className="font-semibold text-gray-700">Stack Trace:</p>
                                                    <pre className="bg-gray-100 p-2 rounded overflow-x-auto mt-1 whitespace-pre-wrap">
                                                        {log.stack_trace}
                                                    </pre>
                                                </div>
                                            )}
                                            {log.metadata && (
                                                <div>
                                                    <p className="font-semibold text-gray-700">Metadata:</p>
                                                    <pre className="bg-gray-100 p-2 rounded overflow-x-auto mt-1">
                                                        {JSON.stringify(log.metadata, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                            <div>
                                                <p className="font-semibold text-gray-700">User ID:</p>
                                                <code className="text-gray-800">{log.user_id || 'Anonymous'}</code>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="fixed bottom-4 right-4 z-50">
                <BackLink to="/" label="Voltar ao Início" hideIcon={false} className="bg-white/90 backdrop-blur px-4 py-2 shadow-lg rounded-full border border-gray-200" />
            </div>
        </div>
    );
};

export default AdminLogs;
