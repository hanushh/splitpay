import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

interface InviteStats {
  accepted: number;
  loading: boolean;
  refetch: () => void;
}

const MILESTONES = [1, 5, 10, 25];

export function nextMilestone(accepted: number): number {
  return MILESTONES.find((m) => m > accepted) ?? MILESTONES[MILESTONES.length - 1];
}

export function useInviteStats(): InviteStats {
  const { user } = useAuth();
  const [accepted, setAccepted] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data } = await supabase.rpc('get_invite_stats', {
        p_user_id: user.id,
      });
      const row = Array.isArray(data) ? data[0] : null;
      setAccepted(Number(row?.total_accepted ?? 0));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { accepted, loading, refetch: fetchStats };
}
