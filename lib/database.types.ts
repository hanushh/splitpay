export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      category_keyword_mappings: {
        Row: {
          category: string
          created_at: string
          id: string
          keyword: string
          usage_count: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          keyword: string
          usage_count?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          keyword?: string
          usage_count?: number
        }
        Relationships: []
      }
      expense_splits: {
        Row: {
          amount_cents: number
          expense_id: string
          id: string
          member_id: string
        }
        Insert: {
          amount_cents: number
          expense_id: string
          id?: string
          member_id: string
        }
        Update: {
          amount_cents?: number
          expense_id?: string
          id?: string
          member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_splits_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_splits_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          description: string
          group_id: string
          id: string
          paid_by_member_id: string | null
          receipt_url: string | null
        }
        Insert: {
          amount_cents: number
          category?: string
          created_at?: string
          description: string
          group_id: string
          id?: string
          paid_by_member_id?: string | null
          receipt_url?: string | null
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          description?: string
          group_id?: string
          id?: string
          paid_by_member_id?: string | null
          receipt_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_by_member_id_fkey"
            columns: ["paid_by_member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
        ]
      }
      group_balances: {
        Row: {
          balance_cents: number
          group_id: string
          user_id: string
        }
        Insert: {
          balance_cents?: number
          group_id: string
          user_id: string
        }
        Update: {
          balance_cents?: number
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_balances_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          group_id: string
          id: string
          joined_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          group_id: string
          id?: string
          joined_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          group_id?: string
          id?: string
          joined_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          archived: boolean
          created_at: string
          created_by: string | null
          description: string | null
          icon_name: string | null
          id: string
          image_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          image_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          expires_at: string
          group_id: string | null
          id: string
          invitee_email: string | null
          inviter_id: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          invitee_email?: string | null
          inviter_id: string
          status?: string
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          group_id?: string | null
          id?: string
          invitee_email?: string
          inviter_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          email_hash: string | null
          id: string
          name: string | null
          phone: string | null
          phone_hash: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          email_hash?: string | null
          id: string
          name?: string | null
          phone?: string | null
          phone_hash?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          email_hash?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          phone_hash?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          actor_user_id: string | null
          body: string
          created_at: string
          group_id: string | null
          id: string
          metadata: Json
          push_attempts: number
          push_last_error: string | null
          push_sent_at: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          body: string
          created_at?: string
          group_id?: string | null
          id?: string
          metadata?: Json
          push_attempts?: number
          push_last_error?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string
          created_at?: string
          group_id?: string | null
          id?: string
          metadata?: Json
          push_attempts?: number
          push_last_error?: string | null
          push_sent_at?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_push_tokens: {
        Row: {
          created_at: string
          device_name: string | null
          disabled_at: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          disabled_at?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          disabled_at?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_group_members_by_ids: {
        Args: { p_group_id: string; p_user_ids: string[] }
        Returns: number
      }
      get_friend_balances: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          balance_cents: number
          display_name: string
          user_id: string
        }[]
      }
      get_group_expenses: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: {
          category: string
          created_at: string
          description: string
          expense_id: string
          paid_by_is_user: boolean
          paid_by_name: string
          total_amount_cents: number
          your_split_cents: number
        }[]
      }
      get_group_member_balances: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: {
          avatar_url: string
          balance_cents: number
          display_name: string
          member_id: string
        }[]
      }
      get_user_activity: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          category: string
          created_at: string
          description: string
          expense_id: string
          group_id: string
          group_name: string
          paid_by_avatar: string
          paid_by_is_user: boolean
          paid_by_name: string
          total_amount_cents: number
          your_split_cents: number
        }[]
      }
      increment_keyword_usage: {
        Args: { p_category: string; p_keywords: string[] }
        Returns: undefined
      }
      initialize_demo_data: { Args: { p_user_id: string }; Returns: undefined }
      is_group_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: boolean
      }
      match_contacts: {
        Args: {
          p_email_hashes: string[]
          p_phone_hashes: string[]
          p_phones?: string[]
        }
        Returns: {
          avatar_url: string
          id: string
          name: string
        }[]
      }
      redeem_invitation: {
        Args: { p_token: string; p_user_id: string }
        Returns: {
          group_id_out: string
          group_name_out: string
        }[]
      }
      redeem_invitation_for_current_user: {
        Args: { p_token: string }
        Returns: {
          group_id_out: string
          group_name_out: string
        }[]
      }
      remove_push_token: { Args: { p_token: string }; Returns: undefined }
      upsert_push_token: {
        Args: { p_device_name?: string; p_platform?: string; p_token: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
