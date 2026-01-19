-- Create error_logs table
create table if not exists public.error_logs (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id),
    error_message text not null,
    stack_trace text,
    metadata jsonb default '{}'::jsonb,
    severity text default 'error',
    created_at timestamptz default now()
);

-- Enable RLS
alter table public.error_logs enable row level security;

-- Policies
create policy "Anyone can insert error logs"
    on public.error_logs
    for insert
    with check (true);

-- Only service role can read (devs via dashboard)
-- No select policy for public/authenticated users

-- Function to cleanup old logs (Retention: 60 days)
-- Runs on insert with 5% probability to avoid performance overhead on every write
create or replace function public.cleanup_old_error_logs()
returns trigger as $$
begin
    if (random() < 0.05) then
        delete from public.error_logs
        where created_at < now() - interval '60 days';
    end if;
    return new;
end;
$$ language plpgsql;

-- Trigger for cleanup
create trigger on_error_log_insert
    after insert on public.error_logs
    for each row
    execute procedure public.cleanup_old_error_logs();
