import { createClient } from '@supabase/supabase-js' 

const supabaseUrl = 'https://azkuidgaafdozthrzyup.supabase.co' 
const supabaseKey = 'sb_publishable_lYu-AOdj7T-kZex9ahWGcQ_Ot_oRqpp' 

export const supabase = createClient(supabaseUrl, supabaseKey)