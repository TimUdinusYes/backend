import { SupabaseClient } from '@supabase/supabase-js';
export declare function getSupabase(): SupabaseClient;
export declare const supabase: {
    readonly client: SupabaseClient<any, "public", "public", any, any>;
};
