-- Enable RLS (already enabled in previous migration, but good measure)
alter table public.error_logs enable row level security;

-- Policy to allow specific admin to view logs
create policy "Admin can view error logs"
    on public.error_logs
    for select
    using (auth.uid() = '35308490-c170-4aa9-a691-65c16ae1480d');

-- Policy to allow admin to delete logs (optional, for cleanup button)
create policy "Admin can delete error logs"
    on public.error_logs
    for delete
    using (auth.uid() = '35308490-c170-4aa9-a691-65c16ae1480d');
