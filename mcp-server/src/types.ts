export interface Group {
  id: string;
  name: string;
  description: string | null;
  icon_name: string | null;
  archived: boolean;
  created_at: string;
  created_by: string | null;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  joined_at: string;
}

export interface GroupBalance {
  group_id: string;
  user_id: string;
  balance_cents: number;
  currency_code: string;
}

export interface GroupExpense {
  expense_id: string;
  description: string;
  total_amount_cents: number;
  category: string;
  created_at: string;
  paid_by_name: string;
  paid_by_is_user: boolean;
  your_split_cents: number;
  currency_code: string;
}

export interface MemberBalance {
  member_id: string;
  display_name: string | null;
  avatar_url: string | null;
  balance_cents: number;
  currency_code: string;
}

export interface FriendBalance {
  friend_user_id: string;
  friend_name: string | null;
  friend_avatar: string | null;
  balance_cents: number;
  currency_code: string;
}

export interface ActivityItem {
  expense_id: string;
  group_id: string;
  group_name: string;
  description: string;
  total_amount_cents: number;
  category: string;
  created_at: string;
  paid_by_name: string;
  paid_by_avatar: string | null;
  paid_by_is_user: boolean;
  your_split_cents: number;
  currency_code: string;
}

export interface AppUser {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}
