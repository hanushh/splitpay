import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { normalizePhone } from '@/lib/phone';
import { supabase } from '@/lib/supabase';

export { normalizePhone };

export interface MatchedFriend {
  userId: string;
  name: string;
  avatarUrl: string | null;
  balanceCents: number;
  balanceStatus: 'owed' | 'owes' | 'settled' | 'no_groups';
}

export interface UnmatchedContact {
  name: string;
  phoneNumbers: string[];
  emails: string[];
}

export interface UseFriendsResult {
  matched: MatchedFriend[];
  unmatched: UnmatchedContact[];
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  refetch: () => Promise<void>;
}


async function hashValue(value: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value.toLowerCase().trim()
  );
}

export function useFriends(): UseFriendsResult {
  const { user } = useAuth();
  const [matched, setMatched] = useState<MatchedFriend[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== Contacts.PermissionStatus.GRANTED) {
      setPermissionDenied(true);
      setLoading(false);
      return;
    }

    try {
      const { data: contacts } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      const emailSet = new Set<string>();
      const phoneSet = new Set<string>(); // normalized plain phones

      for (const contact of contacts) {
        for (const e of contact.emails ?? []) {
          const norm = e.email?.toLowerCase().trim();
          if (norm) emailSet.add(norm);
        }
        for (const p of contact.phoneNumbers ?? []) {
          const norm = normalizePhone(p.number ?? '');
          if (norm) phoneSet.add(norm);
        }
      }

      if (emailSet.size === 0 && phoneSet.size === 0) {
        const allUnmatched: UnmatchedContact[] = contacts
          .filter((c) => c.name)
          .map((c) => ({
            name: c.name!,
            phoneNumbers: (c.phoneNumbers ?? []).map((p) => p.number ?? '').filter(Boolean),
            emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setMatched([]);
        setUnmatched(allUnmatched);
        setLoading(false);
        return;
      }

      // Hash emails for backwards-compat matching; phones sent as plain text.
      const emailHashes = await Promise.all(Array.from(emailSet).map(hashValue));
      const plainPhones = Array.from(phoneSet);

      const { data: matchedProfiles, error: matchErr } = await supabase.rpc('match_contacts', {
        p_email_hashes: emailHashes,
        p_phone_hashes: [],   // phone_hash column no longer used
        p_phones: plainPhones,
      });

      if (matchErr) throw new Error(matchErr.message);

      const [
        { data: balanceRows, error: balanceErr },
        { data: groupFriendRows, error: groupFriendErr },
      ] = await Promise.all([
        supabase.rpc('get_friend_balances', { p_user_id: user.id }),
        supabase.rpc('get_group_friends', { p_user_id: user.id }),
      ]);

      if (balanceErr) throw new Error(balanceErr.message);
      if (groupFriendErr) throw new Error(groupFriendErr.message);

      const balanceByUserId = new Map<string, { balance_cents: number }>();
      for (const row of (balanceRows as { user_id: string; balance_cents: number }[] ?? [])) {
        if (row.user_id) balanceByUserId.set(row.user_id, { balance_cents: Number(row.balance_cents) });
      }

      // Start with contact-matched profiles, then merge in group co-members not already present
      const profileMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
      for (const p of (matchedProfiles as { id: string; name: string; avatar_url: string | null }[] ?? [])) {
        profileMap.set(p.id, p);
      }
      for (const gf of (groupFriendRows as { user_id: string; name: string; avatar_url: string | null }[] ?? [])) {
        if (gf.user_id && !profileMap.has(gf.user_id)) {
          profileMap.set(gf.user_id, { id: gf.user_id, name: gf.name, avatar_url: gf.avatar_url });
        }
      }

      const matchedFriends: MatchedFriend[] = Array.from(profileMap.values()).map((profile) => {
        const balanceRow = balanceByUserId.get(profile.id);
        const balanceCents = balanceRow?.balance_cents ?? 0;
        let balanceStatus: MatchedFriend['balanceStatus'];
        if (!balanceRow) {
          balanceStatus = 'no_groups';
        } else if (balanceCents > 0) {
          balanceStatus = 'owed';
        } else if (balanceCents < 0) {
          balanceStatus = 'owes';
        } else {
          balanceStatus = 'settled';
        }
        return { userId: profile.id, name: profile.name, avatarUrl: profile.avatar_url, balanceCents, balanceStatus };
      }).sort((a, b) => Math.abs(b.balanceCents) - Math.abs(a.balanceCents));

      const matchedProfileNames = new Set(
        matchedFriends.map((f) => f.name.toLowerCase().trim())
      );

      const finalUnmatched: UnmatchedContact[] = contacts
        .filter((c) => c.name && !matchedProfileNames.has(c.name.toLowerCase().trim()))
        .map((c) => ({
          name: c.name!,
          phoneNumbers: (c.phoneNumbers ?? []).map((p) => p.number ?? '').filter(Boolean),
          emails: (c.emails ?? []).map((e) => e.email ?? '').filter(Boolean),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setMatched(matchedFriends);
      setUnmatched(finalUnmatched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { matched, unmatched, loading, error, permissionDenied, refetch };
}
